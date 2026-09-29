import Link from 'next/link';
import { SampleLeadsTable } from '@/app/leads/sample-table';
import { getServerAuth } from '@/lib/auth';
import { DUMMY_LEADS } from '@/lib/dummy-leads';
import { omitChatbotSites } from '@/lib/flags';

export default async function Home() {
  const auth = await getServerAuth();
  if (!auth || !process.env.DATABASE_URL) {
    return (
      <main>
        <section className="hero-panel">
          <h1>MonCha Lead Engine</h1>
          <p>Sign in to run auto discovery and review system-sourced leads.</p>
          <div className="hero-actions">
            <Link href="/leads" className="btn btn-ghost">
              View sample leads
            </Link>
            <Link href="/login" className="btn btn-ghost">
              Sign in
            </Link>
          </div>
        </section>
        <div className="card">
          <div className="page-head" style={{ marginBottom: 8 }}>
            <div>
              <h2 style={{ margin: 0 }}>Sample leads</h2>
              <p className="muted">{DUMMY_LEADS.length} companies shown without a database.</p>
            </div>
            <Link href="/leads" className="btn-secondary btn">
              All leads
            </Link>
          </div>
          <SampleLeadsTable />
        </div>
      </main>
    );
  }

  const { prisma } = await import('@moncha/db');
  const omitChatbots = omitChatbotSites();
  const tenantId = auth.tenantId;
  const [pendingAudit, qualified, needsReview, hasAssistant, noWebsite, failedJobs, recentJobs] =
    await Promise.all([
      prisma.lead.count({ where: { tenantId, queue: 'PENDING_AUDIT' } }),
      prisma.lead.count({ where: { tenantId, queue: 'QUALIFIED' } }),
      prisma.lead.count({ where: { tenantId, queue: 'NEEDS_REVIEW' } }),
      prisma.lead.count({ where: { tenantId, queue: 'HAS_ASSISTANT' } }),
      prisma.lead.count({ where: { tenantId, queue: 'NO_WEBSITE' } }),
      prisma.jobRun.count({ where: { tenantId, status: 'failed' } }),
      prisma.jobRun.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

  const stats: Array<[string, number]> = [
    ['Pending audit', pendingAudit],
    ['Qualified', qualified],
    ['Needs review', needsReview],
    ...(omitChatbots ? [] : ([['Has assistant', hasAssistant]] as Array<[string, number]>)),
    ['No website', noWebsite],
    ['Failed jobs', failedJobs],
  ];

  return (
    <main>
      <section className="hero-panel">
        <h1>Find companies. Review leads.</h1>
        <p>
          Discover → Neon → website audit → Qualified (active site, no assistant).
          {omitChatbots ? ' Chatbot sites are omitted (OMIT_CHATBOT_SITES=true).' : ''}
        </p>
        <div className="hero-actions">
          <Link href="/discover" className="btn btn-ghost">
            Start Discover
          </Link>
          <Link href="/leads?queue=QUALIFIED" className="btn btn-ghost">
            View qualified
          </Link>
        </div>
      </section>

      <div className="grid">
        {stats.map(([label, value]) => (
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
                      <span
                        className={`chip chip-${job.status === 'done' ? 'green' : job.status === 'failed' ? 'red' : job.status === 'running' ? 'blue' : 'amber'}`}
                      >
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
