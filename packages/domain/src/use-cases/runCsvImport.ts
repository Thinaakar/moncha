import type { CompanyRepo, JobRepo, LeadRepo, Logger, WebsiteRepo } from '../ports';
import { canTransitionJob } from '../ports';
import type { AuditConfig } from '../config/audit';
import { importCsvRecords, parseCsv, type CsvRecordInput } from './importCsvRecords';

export async function runCsvImportJob(
  deps: {
    jobs: JobRepo;
    companies: CompanyRepo;
    leads: LeadRepo;
    websites?: WebsiteRepo;
    logger?: Logger;
    config?: AuditConfig;
  },
  input: { jobId: string; tenantId: string; csv?: string; records?: CsvRecordInput[] },
) {
  const job = await deps.jobs.get(input.tenantId, input.jobId);
  if (!job) throw new Error('Job not found');
  if (job.status === 'done') {
    deps.logger?.info('csv_import_skipped_idempotent', { jobId: input.jobId, status: job.status });
    return job.result ?? { status: job.status };
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

  deps.logger?.info('discovery_started', { jobId: input.jobId, source: 'csv', tenantId: input.tenantId });

  try {
    const records = input.records ?? (input.csv ? parseCsv(input.csv) : []);
    const imported = await importCsvRecords(
      { ...deps, websites: deps.websites, jobs: deps.jobs, config: deps.config },
      { tenantId: input.tenantId, records },
    );

    const result = {
      found: imported.found,
      created: imported.created,
      duplicates: imported.duplicates,
      skipped: imported.skipped,
      auditsEnqueued: imported.auditsEnqueued,
      noWebsite: imported.noWebsite,
    };
    await deps.jobs.update(input.tenantId, input.jobId, {
      status: 'done',
      finishedAt: new Date(),
      result,
    });
    deps.logger?.info('job_completed', { jobId: input.jobId, type: 'csv_import', ...result });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.jobs.update(input.tenantId, input.jobId, {
      status: 'failed',
      lastError: message,
      finishedAt: new Date(),
    });
    deps.logger?.error('job_failed', { jobId: input.jobId, type: 'csv_import', message });
    throw error;
  }
}
