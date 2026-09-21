import type { CompanyRepo, JobRepo, LeadRepo, Logger, WebsiteChecker, WebsiteRepo } from '../ports';
import { canTransitionJob } from '../ports';
import { checkWebsite } from './checkWebsite';
import { importCsvRecords, parseCsv, type CsvRecordInput } from './importCsvRecords';

export async function runCsvImportJob(
  deps: {
    jobs: JobRepo;
    companies: CompanyRepo;
    leads: LeadRepo;
    websites: WebsiteRepo;
    checker: WebsiteChecker;
    logger?: Logger;
  },
  input: { jobId: string; tenantId: string; csv?: string; records?: CsvRecordInput[] },
) {
  const job = await deps.jobs.get(input.tenantId, input.jobId);
  if (!job) throw new Error('Job not found');
  if (job.status === 'done' || job.status === 'running') {
    deps.logger?.info('csv_import_skipped_idempotent', { jobId: input.jobId, status: job.status });
    return job.resultJson ?? { status: job.status };
  }
  if (!canTransitionJob(job.status, 'running')) {
    throw new Error(`Invalid job transition from ${job.status} to running`);
  }

  await deps.jobs.update(input.tenantId, input.jobId, { status: 'running', startedAt: new Date(), error: null });
  deps.logger?.info('discovery_started', { jobId: input.jobId, source: 'csv', tenantId: input.tenantId });

  try {
    const records = input.records ?? (input.csv ? parseCsv(input.csv) : []);
    const imported = await importCsvRecords(deps, { tenantId: input.tenantId, records });
    let websiteChecks = 0;
    for (const company of imported.companies) {
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
      found: imported.found,
      created: imported.created,
      duplicates: imported.duplicates,
      skipped: imported.skipped,
      websiteChecks,
    };
    await deps.jobs.update(input.tenantId, input.jobId, {
      status: 'done',
      finishedAt: new Date(),
      resultJson: result,
    });
    deps.logger?.info('job_completed', { jobId: input.jobId, type: 'csv_import', ...result });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.jobs.update(input.tenantId, input.jobId, {
      status: 'failed',
      error: message,
      finishedAt: new Date(),
    });
    deps.logger?.error('job_failed', { jobId: input.jobId, type: 'csv_import', message });
    throw error;
  }
}
