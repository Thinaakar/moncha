import type {
  AuditLogRepo,
  EvidenceStore,
  HostAuditCacheRepo,
  JobRepo,
  LeadRepo,
  Logger,
  ReviewTaskRepo,
  WebsiteAuditRepo,
  WebsiteAuditor,
  WebsiteRepo,
} from '../ports';
import { canTransitionJob } from '../ports';
import type { AuditConfig } from '../config/audit';
import { auditLeadWebsite } from './auditLeadWebsite';

export type WebsiteAuditJobDeps = {
  jobs: JobRepo;
  auditor: WebsiteAuditor;
  websites: WebsiteRepo;
  leads: LeadRepo;
  audits: WebsiteAuditRepo;
  reviewTasks: ReviewTaskRepo;
  auditLogs: AuditLogRepo;
  evidenceStore?: EvidenceStore;
  hostCache?: HostAuditCacheRepo;
  logger?: Logger;
  config?: AuditConfig;
};

export async function runWebsiteAuditJob(
  deps: WebsiteAuditJobDeps,
  input: { jobId: string; tenantId: string; leadId: string; force?: boolean },
) {
  const job = await deps.jobs.get(input.tenantId, input.jobId);
  if (!job) throw new Error('Job not found');
  if (job.status === 'done') {
    deps.logger?.info('website_audit_skipped_idempotent', { jobId: input.jobId });
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

  try {
    const outcome = await auditLeadWebsite(deps, {
      tenantId: input.tenantId,
      leadId: input.leadId,
      force: input.force,
    });
    await deps.jobs.update(input.tenantId, input.jobId, {
      status: 'done',
      finishedAt: new Date(),
      result: outcome,
      lockedAt: null,
      lockedBy: null,
    });
    return outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = job.attempts || 1;
    const maxAttempts = job.maxAttempts || 3;
    const retry = attempts < maxAttempts;
    await deps.jobs.update(input.tenantId, input.jobId, {
      status: retry ? 'pending' : 'failed',
      lastError: message,
      finishedAt: retry ? null : new Date(),
      runAfter: retry ? new Date(Date.now() + attempts * 30_000) : undefined,
      lockedAt: null,
      lockedBy: null,
    });
    deps.logger?.error('website_audit_job_failed', {
      jobId: input.jobId,
      message,
      retry,
    });
    throw error;
  }
}
