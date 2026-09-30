import Link from 'next/link';
import { formatStatus, locationText, statusChip } from '@/lib/ui';

export type LeadRow = {
  id: string;
  name: string;
  domain: string | null;
  city: string | null;
  country: string | null;
  queue: string;
  website: string;
  created: string;
};

export function LeadsTable({ rows, viewHref }: { rows: LeadRow[]; viewHref?: (id: string) => string }) {
  return (
    <div className="table-wrap">
      <table className="table leads-table">
        <thead>
          <tr>
            <th>Company</th>
            <th>Queue</th>
            <th>Website</th>
            <th>Location</th>
            <th>Created</th>
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
                    <span className="lead-domain">{lead.domain || 'No website'}</span>
                  </div>
                </div>
              </td>
              <td>
                <span className={statusChip(lead.queue)}>{formatStatus(lead.queue)}</span>
              </td>
              <td>
                <span className={statusChip(lead.website)}>{formatStatus(lead.website)}</span>
              </td>
              <td>{locationText(lead.city, lead.country)}</td>
              <td className="nowrap">{lead.created}</td>
              <td className="table-action">
                <Link href={viewHref ? viewHref(lead.id) : `/leads/${lead.id}`} className="btn btn-secondary btn-sm">
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
