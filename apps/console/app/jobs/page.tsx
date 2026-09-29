import Link from 'next/link';
import { getServerAuth } from '@/lib/auth';
import { statusChip } from '@/lib/ui';
import { DailySchedule } from './daily-schedule';

export default async function Jobs() {
  const auth = await getServerAuth();
  if (!auth || !process.env.DATABASE_URL) {
    return (
      <main>
        <div className="page-head">
          <div>
            <h1>Jobs</h1>
            <p>A country can run at more than one Malaysia time. Each time repeats every day.</p>
          </div>
        </div>
        <DailySchedule />
      </main>
    );
  }

  const { prisma } = await import('@moncha/db');
  const jobs = await prisma.jobRun.findMany({
    where: { tenantId: auth.tenantId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Jobs</h1>
          <p>A country can run at more than one Malaysia time. Each time repeats every day.</p>
        </div>
        <Link href="/discover" className="btn">
          New Discover job
        </Link>
      </div>

      <DailySchedule />

      <div className="card">
        {jobs.length === 0 ? (
          <div className="empty">No jobs yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Finished</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="mono">{job.id}</td>
                    <td>{job.type}</td>
                    <td>
                      <span className={statusChip(job.status)}>{job.status}</span>
                    </td>
                    <td>{job.createdAt.toLocaleString()}</td>
                    <td>{job.finishedAt?.toLocaleString() || '—'}</td>
                    <td>{job.lastError || '—'}</td>
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
