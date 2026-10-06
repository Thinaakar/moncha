import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { JobTimeline } from '@/components/job-timeline';
import { PageHeader } from '@/components/page-header';
import { getServerAuth } from '@/lib/auth';
import { failedJobAction, jobTypeLabel } from '@/lib/ui';
import { DailySchedule } from './daily-schedule';

const DESCRIPTION = 'Pick countries and times. Discover runs them every day in Singapore time (SGT).';

function jobDetail(result: unknown) {
  if (!result || typeof result !== 'object') return undefined;
  const r = result as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof r.found === 'number') parts.push(`${r.found} found`);
  if (typeof r.created === 'number') parts.push(`${r.created} saved`);
  if (typeof r.duplicates === 'number' && r.duplicates > 0) parts.push(`${r.duplicates} already saved`);
  return parts.join(' · ') || undefined;
}

export default async function Jobs() {
  const auth = await getServerAuth();
  if (!auth || !process.env.DATABASE_URL) {
    return (
      <main>
        <PageHeader title="Jobs" description={DESCRIPTION} />
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
      <PageHeader
        title="Jobs"
        description={DESCRIPTION}
        action={
          <Link href="/discover" className="btn">
            New Discover job
          </Link>
        }
      />

      <DailySchedule />

      <div className="card">
        <h2>Job history</h2>
        {jobs.length === 0 ? (
          <EmptyState title="No jobs yet">Run Discover or import a CSV to create the first job.</EmptyState>
        ) : (
          <JobTimeline
            jobs={jobs.map((job) => ({
              id: job.id,
              title: jobTypeLabel(job.type),
              when: `${job.createdAt.toLocaleString()}${job.finishedAt ? ` · finished ${job.finishedAt.toLocaleTimeString()}` : ''}`,
              status: job.status,
              detail: jobDetail(job.result),
              error: job.lastError,
              action: job.status === 'failed' ? failedJobAction(job.type) : undefined,
            }))}
          />
        )}
      </div>
    </main>
  );
}
