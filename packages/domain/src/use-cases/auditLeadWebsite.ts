import { DEFAULT_AUDIT_CONFIG, type AuditConfig } from '../config/audit';
import type {
  AuditLogRepo,
  EvidenceStore,
  HostAuditCacheRepo,
  LeadRepo,
  Logger,
  ReviewTaskRepo,
  WebsiteAuditRepo,
  WebsiteAuditor,
  WebsiteAuditResult,
  WebsiteRepo,
} from '../ports';
import { qualifyLead } from '../qualification';

export type AuditLeadWebsiteDeps = {
  auditor: WebsiteAuditor;
  websites: WebsiteRepo;
  leads: LeadRepo;
  audits: WebsiteAuditRepo;
  reviewTasks: ReviewTaskRepo;
  auditLogs: AuditLogRepo;
  evidenceStore?: EvidenceStore;
  hostCache?: HostAuditCacheRepo;
  logger?: Logger;
  config?: AuditConfig;
};

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function stripArtifacts(result: WebsiteAuditResult): WebsiteAuditResult {
  const { artifacts: _a, ...rest } = result;
  return rest;
}

async function persistArtifacts(
  evidenceStore: EvidenceStore,
  tenantId: string,
  auditId: string,
  result: WebsiteAuditResult,
): Promise<WebsiteAuditResult['evidence']> {
  const evidence = [...result.evidence];
  const artifacts = result.artifacts;
  if (!artifacts) return evidence;

  if (artifacts.screenshot?.length) {
    const existing = evidence.find((e) => e.type === 'screenshot');
    const contentHash = existing?.contentHash ?? `shot-${artifacts.screenshot.byteLength}`;
    const { objectUri } = await evidenceStore.put({
      tenantId,
      auditId,
      kind: 'screenshot',
      bytes: artifacts.screenshot,
      contentHash,
      retentionClass: 'website_snapshot_90d',
    });
    const idx = evidence.findIndex((e) => e.type === 'screenshot');
    if (idx >= 0) {
      evidence[idx] = { ...evidence[idx]!, objectUri, contentHash };
    } else {
      evidence.push({
        type: 'screenshot',
        objectUri,
        contentHash,
        excerpt: 'homepage screenshot',
        sourcePage: result.finalUrl,
      });
    }
  }

  if (artifacts.renderedDom) {
    const contentHash = result.contentHash ?? `dom-${artifacts.renderedDom.length}`;
    const { objectUri } = await evidenceStore.put({
      tenantId,
      auditId,
      kind: 'dom',
      bytes: artifacts.renderedDom,
      contentHash,
      retentionClass: 'website_snapshot_90d',
    });
    evidence.push({
      type: 'page_excerpt',
      excerpt: 'rendered DOM snapshot',
      objectUri,
      contentHash,
      sourcePage: result.finalUrl,
    });
  }

  return evidence;
}

/**
 * Loads the lead website, runs WebsiteAuditor, persists an immutable audit,
 * and updates Lead + Website pointers in one transactional apply via repos.
 */
export async function auditLeadWebsite(
  deps: AuditLeadWebsiteDeps,
  input: { tenantId: string; leadId: string; force?: boolean },
) {
  const config = deps.config ?? DEFAULT_AUDIT_CONFIG;
  const lead = await deps.leads.get(input.tenantId, input.leadId);
  if (!lead) throw new Error('Lead not found');

  const website = lead.company.website ?? (await deps.websites.getByCompany(input.tenantId, lead.companyId));
  if (!website?.url) {
    const outcome = qualifyLead(
      {
        websiteStatus: 'MISSING',
        verdict: 'NOT_APPLICABLE',
        confidence: 1,
      },
      config,
    );
    await deps.leads.applyQualification(input.tenantId, lead.id, {
      queue: outcome.queue,
      assistantVerdict: 'NOT_APPLICABLE',
      assistantVendor: null,
      qualificationReason: outcome.reason,
      expectedVersion: lead.version,
    });
    return { queue: outcome.queue, verdict: 'NOT_APPLICABLE' as const, auditId: null };
  }

  // Re-audit policy: skip if the latest audit used the current classifier and is younger than
  // reauditAfterDays. A classifier bump or an operator re-check (force) always re-audits.
  const latest = input.force ? null : await deps.audits.latestForLead(input.tenantId, lead.id);
  if (latest && latest.classifierVersion === config.classifierVersion) {
    const ageMs = Date.now() - latest.auditedAt.getTime();
    const maxAgeMs = config.reauditAfterDays * 24 * 60 * 60 * 1000;
    if (ageMs < maxAgeMs) {
      deps.logger?.info('audit_skipped_fresh', {
        tenantId: input.tenantId,
        leadId: lead.id,
        auditId: latest.id,
      });
      return { queue: lead.queue, verdict: latest.verdict, auditId: latest.id, skipped: true };
    }
  }

  const host = hostFromUrl(website.url);
  let result: WebsiteAuditResult | undefined;
  let fromCache = false;

  if (host && deps.hostCache) {
    const cached = await deps.hostCache.get(input.tenantId, host, config.classifierVersion);
    if (cached) {
      const cacheAgeMs = Date.now() - cached.auditedAt.getTime();
      const maxAgeMs = config.reauditAfterDays * 24 * 60 * 60 * 1000;
      if (cacheAgeMs < maxAgeMs) {
        result = {
          ...cached.result,
          auditedAt: new Date(),
          evidence: [
            ...(cached.result.evidence ?? []),
            {
              type: 'page_excerpt',
              excerpt: `host_cache_hit:${host}`,
              sourcePage: website.url,
            },
          ],
        };
        fromCache = true;
        deps.logger?.info('website_audit_host_cache_hit', {
          tenantId: input.tenantId,
          leadId: lead.id,
          host,
        });
      }
    }
  }

  if (!result) {
    deps.logger?.info('website_audit_started', {
      tenantId: input.tenantId,
      leadId: lead.id,
      url: website.url,
    });

    result = await deps.auditor.audit({
      tenantId: input.tenantId,
      leadId: lead.id,
      url: website.url,
    });
  }

  // Persist screenshot/DOM before insert so evidence rows carry objectUri.
  let evidence = result.evidence;
  if (deps.evidenceStore && result.artifacts) {
    const provisionalId = `lead-${lead.id}`;
    evidence = await persistArtifacts(deps.evidenceStore, input.tenantId, provisionalId, result);
  }

  const persistable = stripArtifacts({ ...result, evidence });

  const audit = await deps.audits.create({
    tenantId: input.tenantId,
    websiteId: website.id,
    leadId: lead.id,
    result: persistable,
  });

  // Re-store under real audit id when we used provisional path (best-effort second write).
  if (deps.evidenceStore && result.artifacts) {
    await persistArtifacts(deps.evidenceStore, input.tenantId, audit.id, result).catch(() => undefined);
  }

  if (host && deps.hostCache && !fromCache && result.renderRan) {
    await deps.hostCache
      .put({
        tenantId: input.tenantId,
        host,
        classifierVersion: config.classifierVersion,
        result: persistable,
      })
      .catch((error) => {
        deps.logger?.error('host_cache_put_failed', {
          host,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }

  let outcome = qualifyLead(
    {
      websiteStatus: result.websiteStatus,
      verdict: result.verdict,
      confidence: result.confidence,
    },
    config,
  );

  if (result.method === 'llm' && result.verdict === 'NO_ASSISTANT' && !config.llmCanQualify) {
    outcome = {
      queue: 'NEEDS_REVIEW',
      needsReviewTask: true,
      reason: 'llm_no_assistant_pending_precision',
    };
  }

  await deps.websites.applyAuditPointers(input.tenantId, website.id, {
    status: result.websiteStatus,
    canonicalUrl: result.canonicalUrl ?? null,
    language: result.language ?? null,
    finalUrl: result.finalUrl ?? null,
    httpStatus: result.httpStatus ?? null,
    title: result.title ?? null,
    latestAuditId: audit.id,
    lastCheckedAt: result.auditedAt,
  });

  const updated = await deps.leads.applyQualification(input.tenantId, lead.id, {
    queue: outcome.queue,
    assistantVerdict: result.verdict,
    assistantVendor: result.vendor ?? null,
    qualificationReason: outcome.reason,
    latestAuditId: audit.id,
    expectedVersion: lead.version,
  });

  if (!updated) {
    throw new Error('Lead version conflict while applying qualification');
  }

  await deps.auditLogs.append({
    tenantId: input.tenantId,
    leadId: lead.id,
    entityType: 'Lead',
    entityId: lead.id,
    action: 'qualification_changed',
    after: {
      queue: outcome.queue,
      verdict: result.verdict,
      vendor: result.vendor,
      auditId: audit.id,
      reason: outcome.reason,
      fromCache,
    },
  });

  if (outcome.needsReviewTask) {
    await deps.reviewTasks.open({
      tenantId: input.tenantId,
      leadId: lead.id,
      auditId: audit.id,
      reason: outcome.reason,
    });
  }

  deps.logger?.info('website_audit_finished', {
    tenantId: input.tenantId,
    leadId: lead.id,
    auditId: audit.id,
    queue: outcome.queue,
    verdict: result.verdict,
    method: result.method,
    fromCache,
  });

  return { queue: outcome.queue, verdict: result.verdict, auditId: audit.id, skipped: false };
}
