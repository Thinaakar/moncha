import Link from 'next/link';
import { DUMMY_LEADS } from '@/lib/dummy-leads';
import { statusChip, websiteLabel } from '@/lib/ui';

export function SampleLeadsTable() {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Company</th>
            <th>Domain</th>
            <th>Country</th>
            <th>Queue</th>
            <th>Website</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {DUMMY_LEADS.map((lead) => {
            const website = websiteLabel(lead.websiteStatus, Boolean(lead.domain || lead.websiteStatus));
            return (
              <tr key={lead.id}>
                <td>
                  <Link href={`/leads/${lead.id}`}>{lead.name}</Link>
                </td>
                <td>{lead.domain || '—'}</td>
                <td>{lead.country || '—'}</td>
                <td>
                  <span className={statusChip(lead.queue)}>{lead.queue}</span>
                </td>
                <td>
                  <span className={statusChip(website)}>{website}</span>
                </td>
                <td>{lead.createdAt}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
