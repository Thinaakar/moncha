import Link from 'next/link';
import { prisma } from '@moncha/db';
import { getServerAuth } from '@/lib/auth';

export default async function Home() {
  const auth = await getServerAuth();
  if (!auth) {
    return (
      <main>
        <section className="hero-panel">
          <h1>MonCha Lead Engine</h1>
          <p>Sign in to run auto discovery and review system-sourced leads.</p>
          <div className="hero-actions">
            <Link href="/login" className="btn btn-ghost">
              Sign in
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const tenantId = auth.tenantId;
  const [discovered, withWebsite, noWebsite, failedJobs, recentJobs] = await Promise.all([
    prisma.lead.count({ where: { tenantId, status: 'discovered' } }),
    prisma.website.count({ where: { tenantId, reachable: true } }),
    prisma.company.count({ where: { tenantId, website: null } }),
    prisma.jobRun.count({ where: { tenantId, status: 'failed' } }),
    prisma.jobRun.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ]);

  return (
    <main>
      <section className="hero-panel">
        <h1>Find companies. Review leads.</h1>
        <p>
          Phase 1 primary loop: Discover with Google Places → normalize &amp; dedupe → Neon → website
          check → dashboard review.
        </p>
        <div className="hero-actions">
          <Link href="/discover" className="btn btn-ghost">
            Start Discover
          </Link>
          <Link href="/leads" className="btn btn-ghost">
            View leads
          </Link>
        </div>
      </section>

      <div className="grid">
        {[
          ['Discovered', discovered],
          ['With website', withWebsite],
          ['No website', noWebsite],
          ['Failed jobs', failedJobs],
        ].map(([label, value]) => (
          <div className="stat-card" key={String(label)}>
            <div className="label">{label}</div>
            <div className="stat">{value}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="page-head" style={{ marginBottom: 8 }}>
          <div>
            <h2 style={{ margin: 0 }}>Recent jobs</h2>
            <p className="muted">Latest discovery and import runs for this tenant.</p>
          </div>
          <Link href="/jobs" className="btn-secondary btn">
            All jobs
          </Link>
        </div>
        {recentJobs.length === 0 ? (
          <div className="empty">No jobs yet. Run Discover to create the first one.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.type}</td>
                    <td>
                      <span className={`chip chip-${job.status === 'done' ? 'green' : job.status === 'failed' ? 'red' : job.status === 'running' ? 'blue' : 'amber'}`}>
                        {job.status}
                      </span>
                    </td>
                    <td>{job.createdAt.toLocaleString()}</td>
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
