import type { JobRepo, Logger, WebsiteChecker, WebsiteRepo } from '../ports';
import { canTransitionJob } from '../ports';
import { checkWebsite } from './checkWebsite';

export async function runWebsiteCheckJob(
  deps: { jobs: JobRepo; websites: WebsiteRepo; checker: WebsiteChecker; logger?: Logger },
  input: { jobId: string; tenantId: string; companyId: string; url: string },
) {
  const job = await deps.jobs.get(input.tenantId, input.jobId);
  if (!job) throw new Error('Job not found');
  if (job.status === 'done' || job.status === 'running') {
    return job.resultJson ?? { status: job.status };
  }
  if (!canTransitionJob(job.status, 'running')) {
    throw new Error(`Invalid job transition from ${job.status} to running`);
  }

  await deps.jobs.update(input.tenantId, input.jobId, { status: 'running', startedAt: new Date(), error: null });
  try {
    const result = await checkWebsite(deps, input);
    await deps.jobs.update(input.tenantId, input.jobId, {
      status: 'done',
      finishedAt: new Date(),
      resultJson: result,
    });
    deps.logger?.info('job_completed', { jobId: input.jobId, type: 'website_check', reachable: result.reachable });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.jobs.update(input.tenantId, input.jobId, {
      status: 'failed',
      error: message,
      finishedAt: new Date(),
    });
    deps.logger?.error('job_failed', { jobId: input.jobId, type: 'website_check', message });
    throw error;
  }
}
