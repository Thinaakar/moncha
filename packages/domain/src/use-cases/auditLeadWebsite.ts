import { DEFAULT_AUDIT_CONFIG, type AuditConfig } from '../config/audit';
import type {
  AuditLogRepo,
  LeadRepo,
  Logger,
  ReviewTaskRepo,
  WebsiteAuditRepo,
  WebsiteAuditor,
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
  logger?: Logger;
  config?: AuditConfig;
};

/**
 * Loads the lead website, runs WebsiteAuditor, persists an immutable audit,
 * and updates Lead + Website pointers in one transactional apply via repos.
 */
export async function auditLeadWebsite(
  deps: AuditLeadWebsiteDeps,
  input: { tenantId: string; leadId: string },
) {
  const config = deps.config ?? DEFAULT_AUDIT_CONFIG;
  const lead = await deps.leads.get(input.tenantId, input.leadId);
  if (!lead) throw new Error('Lead not found');

  const website = lead.company.website ?? (await deps.websites.getByCompany(input.tenantId, lead.companyId));
  if (!website?.url) {
    const outcome = qualifyLead({
      websiteStatus: 'MISSING',
      verdict: 'NOT_APPLICABLE',
      confidence: 1,
    }, config);
    await deps.leads.applyQualification(input.tenantId, lead.id, {
      queue: outcome.queue,
      assistantVerdict: 'NOT_APPLICABLE',
      assistantVendor: null,
      qualificationReason: outcome.reason,
      expectedVersion: lead.version,
    });
    return { queue: outcome.queue, verdict: 'NOT_APPLICABLE' as const, auditId: null };
  }

  // Re-audit policy: skip if latest audit younger than reauditAfterDays (caller may force via new job).
  const latest = await deps.audits.latestForLead(input.tenantId, lead.id);
  if (latest) {
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

  deps.logger?.info('website_audit_started', {
    tenantId: input.tenantId,
    leadId: lead.id,
    url: website.url,
  });

  const result = await deps.auditor.audit({
    tenantId: input.tenantId,
    leadId: lead.id,
    url: website.url,
  });

  const audit = await deps.audits.create({
    tenantId: input.tenantId,
    websiteId: website.id,
    leadId: lead.id,
    result,
  });

  let outcome = qualifyLead(
    {
      websiteStatus: result.websiteStatus,
      verdict: result.verdict,
      confidence: result.confidence,
    },
    config,
  );

  // LLM "no" with canQualify false was encoded by caller as UNCERTAIN or NO_ASSISTANT;
  // if verdict is NO_ASSISTANT but confidence path already handled — for llmCanQualify=false
  // the auditor should emit UNCERTAIN or we force NEEDS_REVIEW when failureReason is llm_*.
  if (
    result.method === 'llm' &&
    result.verdict === 'NO_ASSISTANT' &&
    !config.llmCanQualify
  ) {
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
  });

  return { queue: outcome.queue, verdict: result.verdict, auditId: audit.id, skipped: false };
}
