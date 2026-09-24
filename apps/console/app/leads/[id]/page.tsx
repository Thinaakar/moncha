import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@moncha/db';
import { getServerAuth } from '@/lib/auth';
import { statusChip, websiteLabel } from '@/lib/ui';
import { WebsiteCheckButton } from './website-check-button';

export default async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const auth = await getServerAuth();
  if (!auth) notFound();
  const { id } = await params;
  const lead = await prisma.lead.findFirst({
    where: { id, tenantId: auth.tenantId },
    include: { company: { include: { website: true, sourceRecords: true } } },
  });
  if (!lead) return notFound();

  const website = lead.company.website;
  const websiteStatus = websiteLabel(website?.reachable, Boolean(website));

  return (
    <main>
      <div className="page-head">
        <div>
          <p className="muted" style={{ margin: 0 }}>
            <Link href="/leads">← Leads</Link>
          </p>
          <h1>{lead.company.name}</h1>
          <p>
            <span className={statusChip(lead.status)}>{lead.status}</span>
          </p>
        </div>
        <Link href="/discover" className="btn btn-secondary">
          Discover more
        </Link>
      </div>

      <div className="detail-grid">
        <div className="card">
          <h2>Company</h2>
          <div className="kv">
            <div className="kv-row">
              <span>Domain</span>
              <span>{lead.company.domain || '—'}</span>
            </div>
            <div className="kv-row">
              <span>Location</span>
              <span>
                {[lead.company.city, lead.company.country].filter(Boolean).join(', ') || '—'}
              </span>
            </div>
            <div className="kv-row">
              <span>Phone</span>
              <span>{lead.company.phone || '—'}</span>
            </div>
            <div className="kv-row">
              <span>Address</span>
              <span>{lead.company.address || '—'}</span>
            </div>
            <div className="kv-row">
              <span>Created</span>
              <span>{lead.createdAt.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Website</h2>
          {website ? (
            <div className="kv">
              <div className="kv-row">
                <span>Status</span>
                <span className={statusChip(websiteStatus)}>{websiteStatus}</span>
              </div>
              <div className="kv-row">
                <span>URL</span>
                <span className="mono">{website.finalUrl || website.url}</span>
              </div>
              <div className="kv-row">
                <span>HTTP</span>
                <span>{website.httpStatus ?? '—'}</span>
              </div>
              <div className="kv-row">
                <span>Title</span>
                <span>{website.title || '—'}</span>
              </div>
              <div className="kv-row">
                <span>Checked</span>
                <span>{website.lastCheckedAt?.toLocaleString() || '—'}</span>
              </div>
            </div>
          ) : (
            <p className="muted">Not checked yet.</p>
          )}
          <div style={{ marginTop: 16 }}>
            <WebsiteCheckButton leadId={lead.id} />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Source provenance</h2>
        {lead.company.sourceRecords.length === 0 ? (
          <p className="muted">No source records.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>External ID</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {lead.company.sourceRecords.map((source) => (
                  <tr key={source.id}>
                    <td>
                      <span className="chip chip-blue">{source.source}</span>
                    </td>
                    <td className="mono">{source.externalId || '—'}</td>
                    <td>{source.createdAt.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
