import './env';
import { randomUUID } from 'node:crypto';
import {
  prisma,
  PrismaAuditLogRepository,
  PrismaHostAuditCacheRepository,
  PrismaJobRunRepository,
  PrismaLeadRepository,
  PrismaReviewTaskRepository,
  PrismaWebsiteAuditRepository,
  PrismaWebsiteRepository,
  withDbRetry,
} from '@moncha/db';
import { createConsoleLogger, runWebsiteAuditJob } from '@moncha/domain';
import {
  closeRenderBrowser,
  defaultEvidenceRoot,
  LocalDiskEvidenceStore,
  MonchaWebsiteAuditor,
} from '@moncha/crawling';
import { createOpenRouterFromEnv } from '@moncha/integrations';

const WORKER_ID = `worker-${process.env.HOSTNAME || 'local'}-${randomUUID().slice(0, 8)}`;
const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY || 3));
const POLL_MS = Math.max(500, Number(process.env.WORKER_POLL_MS || 2000));
const STALE_MS = Math.max(60_000, Number(process.env.WORKER_STALE_MS || 10 * 60_000));

const logger = createConsoleLogger();
const jobs = new PrismaJobRunRepository(prisma);
const llm = createOpenRouterFromEnv(process.env);
const evidenceStore = new LocalDiskEvidenceStore(defaultEvidenceRoot());
const hostCache = new PrismaHostAuditCacheRepository(prisma);

const auditor = new MonchaWebsiteAuditor({
  llm: llm ?? undefined,
  enableLlm: Boolean(llm),
  logger,
});

function auditDeps() {
  return {
    jobs,
    auditor,
    websites: new PrismaWebsiteRepository(prisma),
    leads: new PrismaLeadRepository(prisma),
    audits: new PrismaWebsiteAuditRepository(prisma),
    reviewTasks: new PrismaReviewTaskRepository(prisma),
    auditLogs: new PrismaAuditLogRepository(prisma),
    evidenceStore,
    hostCache,
    logger,
  };
}

async function handleJob(job: Awaited<ReturnType<typeof jobs.claimJobs>>[number]) {
  const payload = (job.payload || {}) as { leadId?: string; force?: boolean };
  if (job.type !== 'website_audit') {
    // Should not be claimed (claimJobs filters), but never overwrite other runners.
    logger.error('worker_unexpected_job_type', { jobId: job.id, type: job.type });
    await jobs.update(job.tenantId, job.id, {
      status: 'pending',
      lockedAt: null,
      lockedBy: null,
      lastError: `worker_unexpected_${job.type}`,
      runAfter: new Date(Date.now() + 60_000),
      // Do not bump attempts further — claim already incremented once.
    });
    return;
  }
  if (!payload.leadId) throw new Error('website_audit missing leadId');
  await runWebsiteAuditJob(auditDeps(), {
    jobId: job.id,
    tenantId: job.tenantId,
    leadId: payload.leadId,
    force: payload.force === true,
  });
}

async function tick() {
  await withDbRetry(async () => {
    await jobs.recoverStuck(new Date(Date.now() - STALE_MS));
  });
  const claimed = await withDbRetry(() => jobs.claimJobs(WORKER_ID, CONCURRENCY));
  if (!claimed.length) return;
  logger.info('worker_claimed', { workerId: WORKER_ID, count: claimed.length });
  await Promise.all(
    claimed.map(async (job) => {
      try {
        await handleJob(job);
      } catch (error) {
        logger.error('worker_job_error', {
          jobId: job.id,
          type: job.type,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
}

async function main() {
  logger.info('worker_started', {
    workerId: WORKER_ID,
    concurrency: CONCURRENCY,
    llm: Boolean(llm),
    render: true,
  });

  const shutdown = async () => {
    logger.info('worker_shutdown', { workerId: WORKER_ID });
    await closeRenderBrowser();
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });

  for (;;) {
    try {
      await tick();
    } catch (error) {
      logger.error('worker_tick_error', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch(async (error) => {
  console.error(error);
  await closeRenderBrowser();
  process.exit(1);
});
