import type { CompanyRepo, DiscoverySource, JobRepo, LeadRepo, Logger, WebsiteChecker, WebsiteRepo } from '../ports';
import { canTransitionJob } from '../ports';
import { checkWebsite } from './checkWebsite';
import { discoverCompanies } from './discoverCompanies';

export async function runPlacesDiscoveryJob(
  deps: {
    jobs: JobRepo;
    source: DiscoverySource;
    companies: CompanyRepo;
    leads: LeadRepo;
    websites: WebsiteRepo;
    checker: WebsiteChecker;
    logger?: Logger;
  },
  input: { jobId: string; tenantId: string; country: string; city: string; keyword: string },
) {
  const job = await deps.jobs.get(input.tenantId, input.jobId);
  if (!job) throw new Error('Job not found');
  if (job.status === 'done') {
    deps.logger?.info('discovery_skipped_idempotent', { jobId: input.jobId, status: job.status });
    return job.resultJson;
  }
  if (job.status === 'running') {
    deps.logger?.info('discovery_skipped_idempotent', { jobId: input.jobId, status: job.status });
    return { status: 'running' as const };
  }
  if (!canTransitionJob(job.status, 'running')) {
    throw new Error(`Invalid job transition from ${job.status} to running`);
  }

  await deps.jobs.update(input.tenantId, input.jobId, { status: 'running', startedAt: new Date(), error: null });
  deps.logger?.info('discovery_started', {
    jobId: input.jobId,
    tenantId: input.tenantId,
    country: input.country,
    city: input.city,
    keyword: input.keyword,
  });

  try {
    const discovered = await discoverCompanies(deps, input);
    let websiteChecks = 0;
    for (const company of discovered.companies) {
      if (!company.domain) continue;
      try {
        await checkWebsite(deps, {
          tenantId: input.tenantId,
          companyId: company.id,
          url: `https://${company.domain}`,
        });
        websiteChecks += 1;
      } catch (error) {
        deps.logger?.error('website_check_failed', {
          jobId: input.jobId,
          companyId: company.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const result = {
      found: discovered.found,
      created: discovered.created,
      duplicates: discovered.duplicates,
      skipped: discovered.skipped,
      websiteChecks,
    };

    await deps.jobs.update(input.tenantId, input.jobId, {
      status: 'done',
      finishedAt: new Date(),
      resultJson: result,
    });
    deps.logger?.info('job_completed', { jobId: input.jobId, type: 'places_discovery', ...result });
    deps.logger?.info('companies_created', { jobId: input.jobId, created: result.created });
    deps.logger?.info('leads_created', { jobId: input.jobId, created: result.created });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.jobs.update(input.tenantId, input.jobId, {
      status: 'failed',
      error: message,
      finishedAt: new Date(),
    });
    deps.logger?.error('job_failed', { jobId: input.jobId, type: 'places_discovery', message });
    throw error;
  }
}
