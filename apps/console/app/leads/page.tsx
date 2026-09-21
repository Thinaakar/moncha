import Link from 'next/link';
import { prisma } from '@moncha/db';
import { getServerAuth } from '@/lib/auth';

export default async function Leads() {
  const auth = await getServerAuth();
  if (!auth) {
    return (
      <main>
        <h1>Leads</h1>
        <div className="card">
          <p>
            Sign in to view leads. <a href="/login">Login</a>
          </p>
        </div>
      </main>
    );
  }

  const leads = await prisma.lead.findMany({
    where: { tenantId: auth.tenantId },
    include: { company: { include: { website: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return (
    <main>
      <h1>Leads</h1>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Domain</th>
              <th>Country</th>
              <th>Status</th>
              <th>Website</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <td>
                  <Link href={`/leads/${l.id}`}>{l.company.name}</Link>
                </td>
                <td>{l.company.domain || '—'}</td>
                <td>{l.company.country || '—'}</td>
                <td>{l.status}</td>
                <td>
                  {l.company.website?.reachable
                    ? 'reachable'
                    : l.company.website
                      ? 'failed'
                      : 'unchecked'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
