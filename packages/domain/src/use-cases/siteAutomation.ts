import type {
  Logger,
  SiteAutomationCrawlRecord,
  SiteAutomationRepo,
  SiteAutomationSettingsRecord,
  SiteSnapshotRepo,
} from '../ports';
import { SITE_SNAPSHOT_MAX_ATTEMPTS, siteUrlFrom } from './siteSnapshots';

export const SITE_AUTOMATION_DEFAULT_CAP = 20;
export const SITE_AUTOMATION_MAX_CAP = 500;
/** How long a finished crawl waits for its website audits before copies are queued anyway. */
export const SITE_AUTOMATION_AUDIT_WAIT_MS = 3 * 60 * 60_000;
/** After this, audits still pending no longer keep a crawl open. */
export const SITE_AUTOMATION_FOLLOW_MS = 24 * 60 * 60_000;
/** Crawls that finished longer ago than this are never picked up. */
export const SITE_AUTOMATION_LOOKBACK_MS = 7 * 24 * 60 * 60_000;

export class SiteAutomationError extends Error {
  constructor(readonly code: 'validation_error', message: string) {
    super(message);
    this.name = 'SiteAutomationError';
  }
}

export function siteAutoCopyDedupeKey(leadId: string): string {
  return `site_snapshot:auto:${leadId}`;
}

export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function nextUtcMidnight(now: Date): Date {
  return new Date(utcDayStart(now).getTime() + 24 * 60 * 60_000);
}

type SweepDeps = {
  automation: SiteAutomationRepo;
  snapshots: SiteSnapshotRepo;
  logger?: Logger;
  now?: () => Date;
};

export type SiteAutomationSweepResult = {
  tenantId: string;
  tracked: number;
  crawls: number;
  queued: number;
  carriedOver: number;
  remainingToday: number;
};

/**
 * Queues website copies for the qualified leads of finished country crawls.
 *
 * A crawl is picked up once it is done (or failed) and finished after automation was turned on.
 * It waits until every website audit it started has finished, or SITE_AUTOMATION_AUDIT_WAIT_MS
 * has passed. Then its qualified leads that never had a copy are queued oldest first, up to the
 * day's remaining automatic allowance. Leads over the allowance carry over to the next UTC day.
 * Crawls are served oldest first, so the queue stays first in, first out across crawls.
 */
export async function sweepSiteAutomation(
  deps: SweepDeps,
  settings: SiteAutomationSettingsRecord,
): Promise<SiteAutomationSweepResult> {
  const now = deps.now?.() ?? new Date();
  const { tenantId } = settings;
  const empty = { tenantId, tracked: 0, crawls: 0, queued: 0, carriedOver: 0, remainingToday: 0 };
  if (!settings.enabled || !settings.enabledAt) return empty;

  const since = new Date(Math.max(settings.enabledAt.getTime(), now.getTime() - SITE_AUTOMATION_LOOKBACK_MS));
  const tracked = await deps.automation.trackFinishedCrawls(tenantId, since);
  const open = await deps.automation.listOpenCrawls(tenantId);
  if (open.length === 0) return { ...empty, tracked };

  const usedToday = await deps.automation.countAutoSince(tenantId, utcDayStart(now));
  let remaining = Math.max(0, settings.dailyCap - usedToday);
  let queuedTotal = 0;
  let carriedTotal = 0;

  for (const crawl of open) {
    const outcome = await sweepCrawl(deps, crawl, now, remaining);
    remaining -= outcome.queued;
    queuedTotal += outcome.queued;
    carriedTotal += outcome.carriedOver;
  }

  if (queuedTotal > 0 || tracked > 0) {
    deps.logger?.info('site_automation.sweep', {
      tenantId,
      tracked,
      crawls: open.length,
      queued: queuedTotal,
      carriedOver: carriedTotal,
      remainingToday: remaining,
    });
  }
  return { tenantId, tracked, crawls: open.length, queued: queuedTotal, carriedOver: carriedTotal, remainingToday: remaining };
}

async function sweepCrawl(
  deps: SweepDeps,
  crawl: SiteAutomationCrawlRecord,
  now: Date,
  allowance: number,
): Promise<{ queued: number; carriedOver: number }> {
  const { tenantId, crawlJobId } = crawl;
  const audits = await deps.automation.auditCounts(tenantId, crawlJobId);
  const age = now.getTime() - crawl.crawlFinishedAt.getTime();

  if (audits.pending > 0 && age < SITE_AUTOMATION_AUDIT_WAIT_MS) {
    await deps.automation.updateCrawl(crawlJobId, {
      status: 'waiting_audits',
      auditsTotal: audits.total,
      auditsPending: audits.pending,
      lastCheckedAt: now,
    });
    return { queued: 0, carriedOver: 0 };
  }

  const candidates = (await deps.automation.candidates(tenantId, crawlJobId))
    .map((c) => ({ leadId: c.leadId, url: siteUrlFrom({ url: c.websiteUrl, finalUrl: c.websiteFinalUrl, domain: c.domain }) }))
    .filter((c): c is { leadId: string; url: string } => c.url !== null);

  let queued = 0;
  for (const candidate of candidates) {
    if (queued >= allowance) break;
    try {
      await deps.snapshots.createWithJob({
        tenantId,
        leadId: candidate.leadId,
        sourceUrl: candidate.url,
        maxAttempts: SITE_SNAPSHOT_MAX_ATTEMPTS,
        origin: 'auto',
        crawlJobId,
        dedupeKey: siteAutoCopyDedupeKey(candidate.leadId),
      });
      queued += 1;
    } catch (error) {
      // Another worker queued this lead first (dedupe key), or the lead was deleted.
      deps.logger?.error('site_automation.queue_failed', {
        tenantId,
        crawlJobId,
        leadId: candidate.leadId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const carriedOver = Math.max(0, candidates.length - queued);
  const auditsSettled = audits.pending === 0 || age >= SITE_AUTOMATION_FOLLOW_MS;
  const complete = carriedOver === 0 && auditsSettled;
  const queuedSoFar = crawl.queued + queued;
  await deps.automation.updateCrawl(crawlJobId, {
    status: complete ? 'complete' : 'queuing',
    auditsTotal: audits.total,
    auditsPending: audits.pending,
    qualified: queuedSoFar + carriedOver,
    queued: queuedSoFar,
    carriedOver,
    lastCheckedAt: now,
    completedAt: complete ? now : null,
  });
  return { queued, carriedOver };
}

/** Runs the sweep for every tenant with automation turned on. One tenant's failure does not stop the others. */
export async function sweepAllSiteAutomation(deps: SweepDeps): Promise<SiteAutomationSweepResult[]> {
  const results: SiteAutomationSweepResult[] = [];
  for (const settings of await deps.automation.listEnabled()) {
    try {
      results.push(await sweepSiteAutomation(deps, settings));
    } catch (error) {
      deps.logger?.error('site_automation.sweep_failed', {
        tenantId: settings.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export type SiteAutomationStatus = {
  settings: SiteAutomationSettingsRecord;
  today: { day: string; used: number; cap: number; remaining: number; resetsAt: Date };
  /** Qualified leads from open crawls still waiting for daily allowance. */
  carriedOver: number;
  /** Crawls whose audits are still running. */
  waitingCrawls: number;
};

export async function getSiteAutomationStatus(
  deps: { automation: SiteAutomationRepo; now?: () => Date },
  input: { tenantId: string },
): Promise<SiteAutomationStatus> {
  const now = deps.now?.() ?? new Date();
  const [settings, used, open] = await Promise.all([
    deps.automation.getSettings(input.tenantId),
    deps.automation.countAutoSince(input.tenantId, utcDayStart(now)),
    deps.automation.listOpenCrawls(input.tenantId),
  ]);
  return {
    settings,
    today: {
      day: now.toISOString().slice(0, 10),
      used,
      cap: settings.dailyCap,
      remaining: Math.max(0, settings.dailyCap - used),
      resetsAt: nextUtcMidnight(now),
    },
    carriedOver: open.reduce((sum, c) => sum + c.carriedOver, 0),
    waitingCrawls: open.filter((c) => c.status === 'waiting_audits').length,
  };
}

export async function updateSiteAutomationSettings(
  deps: { automation: SiteAutomationRepo; now?: () => Date },
  input: { tenantId: string; enabled?: boolean; dailyCap?: number; updatedBy?: string | null },
): Promise<SiteAutomationSettingsRecord> {
  if (input.dailyCap !== undefined) {
    if (!Number.isInteger(input.dailyCap) || input.dailyCap < 0 || input.dailyCap > SITE_AUTOMATION_MAX_CAP) {
      throw new SiteAutomationError('validation_error', `Daily cap must be a whole number from 0 to ${SITE_AUTOMATION_MAX_CAP}`);
    }
  }
  return deps.automation.saveSettings(
    input.tenantId,
    { enabled: input.enabled, dailyCap: input.dailyCap, updatedBy: input.updatedBy },
    deps.now?.() ?? new Date(),
  );
}
