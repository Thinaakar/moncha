import Link from 'next/link';
import { prisma } from '@moncha/db';
import { getServerAuth } from '@/lib/auth';
import { statusChip, websiteLabel } from '@/lib/ui';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Leads({ searchParams }: { searchParams: SearchParams }) {
  const auth = await getServerAuth();
  if (!auth) {
    return (
      <main>
        <div className="page-head">
          <div>
            <h1>Leads</h1>
            <p>Sign in to review discovered companies.</p>
          </div>
        </div>
        <div className="card">
          <p>
            Authentication required. <Link href="/login">Login</Link>
          </p>
        </div>
      </main>
    );
  }

  const params = await searchParams;
  const search = (first(params.search) || '').trim();
  const country = (first(params.country) || '').trim();
  const status = (first(params.status) || '').trim();
  const page = Math.max(1, Number(first(params.page) || 1) || 1);
  const pageSize = 25;

  const where = {
    tenantId: auth.tenantId,
    ...(status === 'discovered' || status === 'review' || status === 'rejected'
      ? { status: status as 'discovered' | 'review' | 'rejected' }
      : {}),
    company: {
      ...(country ? { country: { equals: country, mode: 'insensitive' as const } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { domain: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
  };

  const [total, leads, countries] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      include: { company: { include: { website: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.company.findMany({
      where: { tenantId: auth.tenantId, country: { not: null } },
      select: { country: true },
      distinct: ['country'],
      orderBy: { country: 'asc' },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Leads</h1>
          <p>
            {total} lead{total === 1 ? '' : 's'} from auto discovery and fallbacks.
          </p>
        </div>
        <Link href="/discover" className="btn">
          Discover more
        </Link>
      </div>

      <div className="card">
        <form className="filters" method="get">
          <input name="search" placeholder="Search company or domain" defaultValue={search} />
          <select name="country" defaultValue={country}>
            <option value="">All countries</option>
            {countries.map((c) => (
              <option key={c.country || 'x'} value={c.country || ''}>
                {c.country}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={status}>
            <option value="">All statuses</option>
            <option value="discovered">discovered</option>
            <option value="review">review</option>
            <option value="rejected">rejected</option>
          </select>
          <button type="submit">Filter</button>
        </form>

        {leads.length === 0 ? (
          <div className="empty">No leads match these filters. Run Discover to fetch companies.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Domain</th>
                  <th>Country</th>
                  <th>Status</th>
                  <th>Website</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const website = websiteLabel(
                    lead.company.website?.reachable,
                    Boolean(lead.company.website),
                  );
                  return (
                    <tr key={lead.id}>
                      <td>
                        <Link href={`/leads/${lead.id}`}>{lead.company.name}</Link>
                      </td>
                      <td>{lead.company.domain || '—'}</td>
                      <td>{lead.company.country || '—'}</td>
                      <td>
                        <span className={statusChip(lead.status)}>{lead.status}</span>
                      </td>
                      <td>
                        <span className={statusChip(website)}>{website}</span>
                      </td>
                      <td>{lead.createdAt.toLocaleDateString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, gap: 10 }}>
          <span className="muted">
            Page {page} of {totalPages}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {page > 1 && (
              <Link
                className="btn btn-secondary"
                href={`/leads?${new URLSearchParams({
                  ...(search ? { search } : {}),
                  ...(country ? { country } : {}),
                  ...(status ? { status } : {}),
                  page: String(page - 1),
                }).toString()}`}
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                className="btn btn-secondary"
                href={`/leads?${new URLSearchParams({
                  ...(search ? { search } : {}),
                  ...(country ? { country } : {}),
                  ...(status ? { status } : {}),
                  page: String(page + 1),
                }).toString()}`}
              >
                Next
              </Link>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
