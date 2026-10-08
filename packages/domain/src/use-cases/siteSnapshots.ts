import type { JobRunRecord, LeadListItem, LeadRepo, SiteSnapshotRecord, SiteSnapshotRepo } from '../ports';

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
  const raw = website?.url || website?.finalUrl || (lead.company.domain ? `https://${lead.company.domain}` : null);
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
  });
  return { ...created, deduped: false };
}
