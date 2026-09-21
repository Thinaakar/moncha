import { prisma } from '@moncha/db';
import { getServerAuth } from '@/lib/auth';

export default async function Home() {
  const auth = await getServerAuth();
  if (!auth) {
    return (
      <main>
        <h1>Dashboard</h1>
        <div className="card">
          <p>
            Sign in to view tenant leads. <a href="/login">Login</a>
          </p>
        </div>
      </main>
    );
  }

  const tenantId = auth.tenantId;
  const [discovered, withWebsite, noWebsite, failedJobs] = await Promise.all([
    prisma.lead.count({ where: { tenantId, status: 'discovered' } }),
    prisma.website.count({ where: { tenantId, reachable: true } }),
    prisma.company.count({ where: { tenantId, website: null } }),
    prisma.jobRun.count({ where: { tenantId, status: 'failed' } }),
  ]);

  return (
    <main>
      <h1>Dashboard</h1>
      <div className="grid">
        {[
          ['Discovered', discovered],
          ['With website', withWebsite],
          ['No website', noWebsite],
          ['Failed jobs', failedJobs],
        ].map(([k, v]) => (
          <div className="card" key={String(k)}>
            <div>{k}</div>
            <div className="stat">{v}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <h2>Phase 1</h2>
        <p>Primary workflow: auto Discover → save → website signal → review.</p>
      </div>
    </main>
  );
}
