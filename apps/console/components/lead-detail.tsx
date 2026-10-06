import Link from 'next/link';
import type { ReactNode } from 'react';
import type { LeadDetail } from '@/lib/leads';
import { formatStatus, locationText, statusChip } from '@/lib/ui';
import { WebsiteCheckButton } from './website-check-button';

export function LeadChips({ lead }: { lead: LeadDetail }) {
  return (
    <span className="chip-row">
      <span className={statusChip(lead.queue)}>{formatStatus(lead.queue)}</span>
      {lead.verdict ? <span className={statusChip(lead.verdict)}>{formatStatus(lead.verdict)}</span> : null}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv-row">
      <span>{label}</span>
      <span>{children}</span>
    </div>
  );
}

export function LeadDetailBody({ lead, variant }: { lead: LeadDetail; variant: 'page' | 'panel' }) {
  const section = variant === 'page' ? 'card lead-section' : 'lead-section';
  const { website } = lead;

  return (
    <div className={`lead-detail lead-detail-${variant}`}>
      <section className={section}>
        <h2>Company</h2>
        <div className="kv">
          <Row label="Domain">{lead.domain || '—'}</Row>
          <Row label="Phone">{lead.phone || '—'}</Row>
          <Row label="Address">{lead.address || '—'}</Row>
          <Row label="Location">{locationText(lead.city, lead.country)}</Row>
          {lead.vendor ? <Row label="Vendor">{lead.vendor}</Row> : null}
          <Row label="Created">{lead.created}</Row>
        </div>
      </section>

      <section className={section}>
        <h2>Website check</h2>
        <div className="kv">
          <Row label="Status">
            <span className={statusChip(website.status)}>{formatStatus(website.status)}</span>
          </Row>
          <Row label="Link">
            {website.url ? (
              <a href={website.url} target="_blank" rel="noreferrer" className="mono">
                {website.url}
              </a>
            ) : (
              '—'
            )}
          </Row>
          {website.httpStatus != null ? <Row label="HTTP">{website.httpStatus}</Row> : null}
          {website.title ? <Row label="Title">{website.title}</Row> : null}
          <Row label="Checked">{website.checkedAt || 'Not yet'}</Row>
        </div>
        <WebsiteCheckButton leadId={lead.id} disabled={!lead.live} />
      </section>

      <section className={`${section} lead-section-wide`}>
        <h2>Timeline</h2>
        <ol className="lead-timeline">
          {lead.timeline.map((entry, index) => (
            <li key={`${entry.label}-${index}`} className={entry.when ? undefined : 'is-current'}>
              <span className="lead-timeline-dot" aria-hidden="true" />
              <div>
                <strong>{entry.label}</strong>
                {entry.when ? <span>{entry.when}</span> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function LeadDrawer({ lead, closeHref }: { lead: LeadDetail; closeHref: string }) {
  return (
    <>
      <Link href={closeHref} className="drawer-backdrop" aria-label="Close details" scroll={false} />
      <aside className="drawer" aria-label={`${lead.name} details`}>
        <div className="drawer-head">
          <div>
            <h2>{lead.name}</h2>
            <LeadChips lead={lead} />
          </div>
          <Link href={closeHref} className="drawer-close" aria-label="Close details" scroll={false}>
            ×
          </Link>
        </div>
        <div className="drawer-body">
          <LeadDetailBody lead={lead} variant="panel" />
        </div>
        <div className="drawer-foot">
          <Link href={`/leads/${lead.id}`} className="btn btn-secondary">
            Open full page
          </Link>
        </div>
      </aside>
    </>
  );
}
