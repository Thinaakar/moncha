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
/** Leads queued per crawl per sweep; a bigger crawl stays open and the rest follow on the next sweep. */
export const SITE_AUTOMATION_BATCH = 1000;
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
};

/**
 * Queues website copies for the qualified leads of finished country crawls.
 *
 * A crawl is picked up once it is done (or failed) and finished after automation was turned on.
 * It waits until every website audit it started has finished, or SITE_AUTOMATION_AUDIT_WAIT_MS
 * has passed. Then its qualified leads that never had a copy are queued, oldest first, until today's
 * `dailyCap` of automatic copies (UTC day) is used; the rest stay with their crawl for the next day.
 * Crawls are served oldest first, so the queue stays first in, first out across crawls.
 */
export async function sweepSiteAutomation(
  deps: SweepDeps,
  settings: SiteAutomationSettingsRecord,
): Promise<SiteAutomationSweepResult> {
  const now = deps.now?.() ?? new Date();
  const { tenantId } = settings;
  const empty = { tenantId, tracked: 0, crawls: 0, queued: 0 };
  if (!settings.enabled || !settings.enabledAt) return empty;

  const since = new Date(Math.max(settings.enabledAt.getTime(), now.getTime() - SITE_AUTOMATION_LOOKBACK_MS));
  const tracked = await deps.automation.trackFinishedCrawls(tenantId, since);
  const open = await deps.automation.listOpenCrawls(tenantId);
  if (open.length === 0) return { ...empty, tracked };

  const usedToday = await deps.automation.countAutoSince(tenantId, utcDayStart(now));
  let room = Math.max(0, settings.dailyCap - usedToday);
  let queuedTotal = 0;
  for (const crawl of open) {
    const queued = await sweepCrawl(deps, crawl, now, room);
    queuedTotal += queued;
    room -= queued;
  }

  if (queuedTotal > 0 || tracked > 0) {
    deps.logger?.info('site_automation.sweep', { tenantId, tracked, crawls: open.length, queued: queuedTotal, roomLeft: room });
  }
  return { tenantId, tracked, crawls: open.length, queued: queuedTotal };
}

async function sweepCrawl(deps: SweepDeps, crawl: SiteAutomationCrawlRecord, now: Date, room: number): Promise<number> {
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
    return 0;
  }

  if (room <= 0) {
    await deps.automation.updateCrawl(crawlJobId, {
      status: 'queuing',
      auditsTotal: audits.total,
      auditsPending: audits.pending,
      lastCheckedAt: now,
    });
    return 0;
  }

  const found = await deps.automation.candidates(tenantId, crawlJobId, SITE_AUTOMATION_BATCH);
  const usable = found
    .map((c) => ({ leadId: c.leadId, url: siteUrlFrom({ url: c.websiteUrl, finalUrl: c.websiteFinalUrl, domain: c.domain }) }))
    .filter((c): c is { leadId: string; url: string } => c.url !== null);
  const candidates = usable.slice(0, room);

  let queued = 0;
  for (const candidate of candidates) {
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

  const moreWaiting = found.length >= SITE_AUTOMATION_BATCH || usable.length > candidates.length;
  const auditsSettled = audits.pending === 0 || age >= SITE_AUTOMATION_FOLLOW_MS;
  const complete = !moreWaiting && auditsSettled;
  const queuedSoFar = crawl.queued + queued;
  await deps.automation.updateCrawl(crawlJobId, {
    status: complete ? 'complete' : 'queuing',
    auditsTotal: audits.total,
    auditsPending: audits.pending,
    qualified: queuedSoFar,
    queued: queuedSoFar,
    carriedOver: usable.length - candidates.length,
    lastCheckedAt: now,
    completedAt: complete ? now : null,
  });
  return queued;
}

/** Runs the sweep for each tenant given. One tenant's failure does not stop the others. */
export async function sweepAllSiteAutomation(
  deps: SweepDeps,
  tenants: SiteAutomationSettingsRecord[],
): Promise<SiteAutomationSweepResult[]> {
  const results: SiteAutomationSweepResult[] = [];
  for (const settings of tenants) {
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
  /** `used` = automatic copies queued today (UTC); the sweep stops at `cap`. */
  today: { day: string; used: number; cap: number; remaining: number; resetsAt: Date };
  /** Qualified leads held back by the daily cap, queued on a later day. */
  carriedOver: number;
  /** Crawls whose audits are still running. */
  waitingCrawls: number;
};

/** `settings` overrides the stored copy automation settings (the crawl settings drive automation). */
export async function getSiteAutomationStatus(
  deps: { automation: SiteAutomationRepo; now?: () => Date },
  input: { tenantId: string; settings?: SiteAutomationSettingsRecord },
): Promise<SiteAutomationStatus> {
  const now = deps.now?.() ?? new Date();
  const [settings, used, open] = await Promise.all([
    input.settings ?? deps.automation.getSettings(input.tenantId),
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
