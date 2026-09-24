import type { CompanyRepo, DiscoverySource, JobRepo, LeadRepo, Logger, WebsiteRepo } from '../ports';
import { canTransitionJob } from '../ports';
import type { AuditConfig } from '../config/audit';
import { discoverCompanies } from './discoverCompanies';

export async function runPlacesDiscoveryJob(
  deps: {
    jobs: JobRepo;
    source: DiscoverySource;
    companies: CompanyRepo;
    leads: LeadRepo;
    websites?: WebsiteRepo;
    logger?: Logger;
    config?: AuditConfig;
  },
  input: { jobId: string; tenantId: string; country: string; city: string; keyword: string },
) {
  const job = await deps.jobs.get(input.tenantId, input.jobId);
  if (!job) throw new Error('Job not found');
  if (job.status === 'done') {
    deps.logger?.info('discovery_skipped_idempotent', { jobId: input.jobId, status: job.status });
    return job.result;
  }
  if (job.status === 'pending') {
    if (!canTransitionJob(job.status, 'running')) {
      throw new Error(`Invalid job transition from ${job.status} to running`);
    }
    await deps.jobs.update(input.tenantId, input.jobId, {
      status: 'running',
      startedAt: new Date(),
      lastError: null,
    });
  }

  deps.logger?.info('discovery_started', {
    jobId: input.jobId,
    tenantId: input.tenantId,
    country: input.country,
    city: input.city,
    keyword: input.keyword,
  });

  try {
    const discovered = await discoverCompanies(
      { ...deps, websites: deps.websites, jobs: deps.jobs, config: deps.config },
      input,
    );

    const result = {
      found: discovered.found,
      created: discovered.created,
      duplicates: discovered.duplicates,
      skipped: discovered.skipped,
      auditsEnqueued: discovered.auditsEnqueued,
      noWebsite: discovered.noWebsite,
    };

    await deps.jobs.update(input.tenantId, input.jobId, {
      status: 'done',
      finishedAt: new Date(),
      result,
    });
    deps.logger?.info('job_completed', { jobId: input.jobId, type: 'places_discovery', ...result });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.jobs.update(input.tenantId, input.jobId, {
      status: 'failed',
      lastError: message,
      finishedAt: new Date(),
    });
    deps.logger?.error('job_failed', { jobId: input.jobId, type: 'places_discovery', message });
    throw error;
  }
}
