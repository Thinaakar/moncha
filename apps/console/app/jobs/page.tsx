import { prisma } from '@moncha/db';
import { getServerAuth } from '@/lib/auth';

export default async function Jobs() {
  const auth = await getServerAuth();
  if (!auth) {
    return (
      <main>
        <h1>Jobs</h1>
        <div className="card">
          <p>
            Sign in to view jobs. <a href="/login">Login</a>
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
      <h1>Jobs</h1>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Type</th>
              <th>Status</th>
              <th>Created</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>{j.id}</td>
                <td>{j.type}</td>
                <td>{j.status}</td>
                <td>{j.createdAt.toISOString()}</td>
                <td>{j.error || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
