import type {
  JobRunRecord,
  LeadListItem,
  LeadRepo,
  SiteQueueEntry,
  SiteSnapshotRecord,
  SiteSnapshotRepo,
} from '../ports';

export const SITE_SNAPSHOT_MAX_ATTEMPTS = 2;

export class SiteSnapshotRequestError extends Error {
  constructor(readonly code: 'lead_not_found' | 'no_website') {
    super(code);
    this.name = 'SiteSnapshotRequestError';
  }
}

/** The URL a website copy starts from: the lead's website record, else its company domain. */
export function siteUrlForLead(lead: LeadListItem): string | null {
  const website = lead.company.website;
  return siteUrlFrom({ url: website?.url, finalUrl: website?.finalUrl, domain: lead.company.domain });
}

export function siteUrlFrom(input: { url?: string | null; finalUrl?: string | null; domain?: string | null }): string | null {
  const raw = input.url || input.finalUrl || (input.domain ? `https://${input.domain}` : null);
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
}

/**
 * Queues one website copy for a lead. A pending or running copy for the same lead is returned
 * instead of starting a second one.
 */
export async function queueSiteSnapshot(
  deps: { leads: LeadRepo; snapshots: SiteSnapshotRepo },
  input: { tenantId: string; leadId: string },
): Promise<{ snapshot: SiteSnapshotRecord; job: JobRunRecord | null; deduped: boolean }> {
  const lead = await deps.leads.get(input.tenantId, input.leadId);
  if (!lead) throw new SiteSnapshotRequestError('lead_not_found');
  const url = siteUrlForLead(lead);
  if (!url) throw new SiteSnapshotRequestError('no_website');

  const open = await deps.snapshots.findOpenForLead(input.tenantId, input.leadId);
  if (open) return { snapshot: open, job: null, deduped: true };

  const created = await deps.snapshots.createWithJob({
    tenantId: input.tenantId,
    leadId: input.leadId,
    sourceUrl: url,
    maxAttempts: SITE_SNAPSHOT_MAX_ATTEMPTS,
    origin: 'manual',
  });
  return { ...created, deduped: false };
}

export type SiteQueueItem = SiteQueueEntry & {
  /** 1-based place in line among copies that have not started; null while running. */
  position: number | null;
  /** When the copy is expected to start (waiting) or finish (running). */
  estimatedAt: Date;
  /** Pending copy that already failed once and waits for its retry time. */
  retrying: boolean;
};

export type SiteQueueView = {
  running: SiteQueueItem[];
  waiting: SiteQueueItem[];
  averageRunMs: number;
  /** True when the average comes from finished copies rather than the default. */
  measured: boolean;
};

export const DEFAULT_SITE_RUN_MS = 120_000;

/**
 * The website copy queue in claim order with a start estimate for each waiting copy.
 * The worker makes one copy at a time, so each estimate starts where the previous one ends.
 */
export async function getSiteQueue(
  deps: { snapshots: SiteSnapshotRepo; now?: () => Date },
  input: { tenantId: string },
): Promise<SiteQueueView> {
  const now = deps.now?.() ?? new Date();
  const [entries, measuredMs] = await Promise.all([
    deps.snapshots.queue(input.tenantId),
    deps.snapshots.averageRunMs(input.tenantId, 20),
  ]);
  const averageRunMs = measuredMs ?? DEFAULT_SITE_RUN_MS;

  const running: SiteQueueItem[] = [];
  const waiting: SiteQueueItem[] = [];
  let freeAt = now.getTime();
  for (const entry of entries) {
    if (entry.status !== 'running') continue;
    const started = (entry.job?.lockedAt ?? entry.job?.startedAt ?? entry.createdAt).getTime();
    const finish = Math.max(now.getTime(), started + averageRunMs);
    freeAt = Math.max(freeAt, finish);
    running.push({ ...entry, position: null, estimatedAt: new Date(finish), retrying: false });
  }
  for (const entry of entries) {
    if (entry.status === 'running') continue;
    const runAfter = entry.job?.runAfter.getTime() ?? now.getTime();
    const start = Math.max(freeAt, runAfter);
    freeAt = start + averageRunMs;
    waiting.push({
      ...entry,
      position: waiting.length + 1,
      estimatedAt: new Date(start),
      retrying: (entry.job?.attempts ?? 0) > 0,
    });
  }
  return { running, waiting, averageRunMs, measured: measuredMs !== null };
}

export class SiteCancelError extends Error {
  constructor(readonly code: 'not_found' | 'not_pending') {
    super(code);
    this.name = 'SiteCancelError';
  }
}

/** Cancels a copy that is still waiting in the queue. Running copies cannot be cancelled. */
export async function cancelSiteSnapshot(
  deps: { snapshots: SiteSnapshotRepo; now?: () => Date },
  input: { tenantId: string; id: string },
): Promise<{ cancelled: true }> {
  const result = await deps.snapshots.cancel(input.tenantId, input.id, deps.now?.() ?? new Date());
  if (result !== 'cancelled') throw new SiteCancelError(result);
  return { cancelled: true };
}
