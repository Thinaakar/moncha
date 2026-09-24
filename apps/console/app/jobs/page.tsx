import Link from 'next/link';
import { prisma } from '@moncha/db';
import { getServerAuth } from '@/lib/auth';
import { statusChip } from '@/lib/ui';

export default async function Jobs() {
  const auth = await getServerAuth();
  if (!auth) {
    return (
      <main>
        <div className="page-head">
          <div>
            <h1>Jobs</h1>
            <p>Sign in to view discovery and import history.</p>
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
          <p>Auto discovery and CSV import runs with pending / running / done / failed.</p>
        </div>
        <Link href="/discover" className="btn">
          New Discover job
        </Link>
      </div>

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
                    <td>{job.error || '—'}</td>
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
