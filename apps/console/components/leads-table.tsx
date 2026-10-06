import Link from 'next/link';
import { Icon } from '@/components/icon';
import { countryCode, formatStatus, locationText, statusChip, timeAgo } from '@/lib/ui';

export type LeadRow = {
  id: string;
  name: string;
  domain: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  queue: string;
  website: string;
  createdAt: string;
};

export type CheckState = 'busy' | 'queued' | 'error';

type ViewProps = {
  rows: LeadRow[];
  checks: Record<string, CheckState | undefined>;
  onRecheck: (lead: LeadRow) => void;
};

function SiteLink({ domain }: { domain: string | null }) {
  if (!domain) return <span className="lead-domain">No website</span>;
  return (
    <a className="lead-domain lead-site" href={`https://${domain}`} target="_blank" rel="noreferrer">
      {domain}
      <Icon name="external" size={12} />
    </a>
  );
}

function CountryBadge({ lead }: { lead: LeadRow }) {
  const code = countryCode(lead.country);
  if (!code) return <span className="muted-dash">—</span>;
  return (
    <span className="country-badge" title={locationText(lead.city, lead.country)}>
      {code}
    </span>
  );
}

function RecheckButton({ lead, state, onRecheck }: { lead: LeadRow; state?: CheckState; onRecheck: (lead: LeadRow) => void }) {
  const title = !lead.domain
    ? 'No website to check'
    : state === 'queued'
      ? 'Website check queued'
      : state === 'error'
        ? 'Could not queue the check. Try again'
        : 'Re-check website';
  return (
    <button
      type="button"
      className={`icon-button${state === 'busy' ? ' is-spinning' : ''}${state === 'queued' ? ' is-done' : ''}${state === 'error' ? ' is-error' : ''}`}
      title={title}
      aria-label={title}
      disabled={!lead.domain || state === 'busy'}
      onClick={() => onRecheck(lead)}
    >
      <Icon name={state === 'queued' ? 'check' : 'refresh'} size={16} />
    </button>
  );
}

function Chip({ status }: { status: string }) {
  return (
    <span className={statusChip(status)}>
      <i className="chip-dot" aria-hidden="true" />
      {formatStatus(status)}
    </span>
  );
}

export function LeadsTable({ rows, checks, onRecheck }: ViewProps) {
  return (
    <div className="table-wrap">
      <table className="table leads-table">
        <thead>
          <tr>
            <th>Company</th>
            <th>Status</th>
            <th>Website</th>
            <th>Country</th>
            <th>Added</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((lead) => (
            <tr key={lead.id}>
              <td>
                <div className="lead-cell">
                  <span className="lead-avatar" aria-hidden="true">
                    {lead.name.charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <Link href={`/leads/${lead.id}`}>{lead.name}</Link>
                    <SiteLink domain={lead.domain} />
                  </div>
                </div>
              </td>
              <td>
                <Chip status={lead.queue} />
              </td>
              <td>
                <Chip status={lead.website} />
              </td>
              <td>
                <CountryBadge lead={lead} />
              </td>
              <td className="nowrap" title={new Date(lead.createdAt).toLocaleString()}>
                {timeAgo(lead.createdAt)}
              </td>
              <td className="table-action">
                <div className="row-actions">
                  <RecheckButton lead={lead} state={checks[lead.id]} onRecheck={onRecheck} />
                  <Link href={`/leads/${lead.id}`} className="btn btn-secondary btn-sm">
                    View →
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LeadCards({ rows, checks, onRecheck }: ViewProps) {
  return (
    <div className="lead-cards">
      {rows.map((lead) => (
        <article className="lead-card" key={lead.id}>
          <div className="lead-card-head">
            <span className="lead-avatar" aria-hidden="true">
              {lead.name.charAt(0).toUpperCase()}
            </span>
            <div>
              <Link href={`/leads/${lead.id}`}>{lead.name}</Link>
              <span className="lead-domain">{locationText(lead.city, lead.country)}</span>
            </div>
            <CountryBadge lead={lead} />
          </div>
          <div className="lead-card-chips">
            <Chip status={lead.queue} />
            <Chip status={lead.website} />
          </div>
          <div className="lead-card-lines">
            <span>
              <Icon name="globe" size={14} />
              <SiteLink domain={lead.domain} />
            </span>
            <span>
              <Icon name="info" size={14} />
              <span className="lead-domain">{lead.phone || 'No phone'}</span>
            </span>
          </div>
          <div className="lead-card-foot">
            <span className="lead-domain" title={new Date(lead.createdAt).toLocaleString()}>
              Added {timeAgo(lead.createdAt)}
            </span>
            <div className="row-actions">
              <RecheckButton lead={lead} state={checks[lead.id]} onRecheck={onRecheck} />
              <Link href={`/leads/${lead.id}`} className="btn btn-secondary btn-sm">
                View →
              </Link>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
