import './env';
import { randomUUID } from 'node:crypto';
import {
  prisma,
  PrismaAuditLogRepository,
  PrismaDiscoveryScheduleRepository,
  PrismaHostAuditCacheRepository,
  PrismaJobRunRepository,
  PrismaLeadRepository,
  PrismaReviewTaskRepository,
  PrismaWebsiteAuditRepository,
  PrismaWebsiteRepository,
  withDbRetry,
} from '@moncha/db';
import {
  createConsoleLogger,
  enqueueDueSchedules,
  resolveCountry,
  runCountryDiscoveryJob,
  runWebsiteAuditJob,
  type CountryDiscoveryJobPayload,
  type JobRunRecord,
} from '@moncha/domain';
import {
  closeRenderBrowser,
  defaultEvidenceRoot,
  LocalDiskEvidenceStore,
  MonchaWebsiteAuditor,
} from '@moncha/crawling';
import { createOpenRouterFromEnv } from '@moncha/integrations';
import { countryCrawlDeps, discoveryBudget, liveCountryCrawls } from './country-crawls';

const WORKER_ID = `worker-${process.env.HOSTNAME || 'local'}-${randomUUID().slice(0, 8)}`;
const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY || 3));
const POLL_MS = Math.max(500, Number(process.env.WORKER_POLL_MS || 2000));
const STALE_MS = Math.max(60_000, Number(process.env.WORKER_STALE_MS || 10 * 60_000));
const SCHEDULER_TICK_MS = Math.max(5_000, Number(process.env.SCHEDULER_TICK_MS || 30_000));
const CRAWL_BUSY_RETRY_MS = 5 * 60_000;
const SHUTDOWN_WAIT_MS = 120_000;

const logger = createConsoleLogger();
const jobs = new PrismaJobRunRepository(prisma);
const schedules = new PrismaDiscoveryScheduleRepository(prisma);
const crawlAbort = new AbortController();
let activeCrawl: Promise<void> | null = null;
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

async function schedulerTick() {
  await withDbRetry(() => enqueueDueSchedules({ schedules, logger }));
}

/** One country crawl at a time per worker; audits keep running in their own loop. */
async function countryTick() {
  if (activeCrawl || crawlAbort.signal.aborted) return;
  const [job] = await withDbRetry(() => jobs.claimJobs(WORKER_ID, 1, 'country_discovery'));
  if (!job) return;
  activeCrawl = runCrawl(job).finally(() => {
    activeCrawl = null;
  });
  await activeCrawl;
}

async function runCrawl(job: JobRunRecord) {
  const payload = (job.payload || {}) as Partial<CountryDiscoveryJobPayload>;
  const profile = resolveCountry(payload.countryCode || payload.country || '');
  if (profile) {
    const live = await liveCountryCrawls(job.tenantId, profile.name, job.id);
    if (live.length) {
      await jobs.update(job.tenantId, job.id, {
        status: 'pending',
        lockedAt: null,
        lockedBy: null,
        runAfter: new Date(Date.now() + CRAWL_BUSY_RETRY_MS),
        lastError: `waiting: ${profile.name} crawl ${live.join(', ')} is still running`,
      });
      logger.info('country_job_deferred', { jobId: job.id, country: profile.code, runningJobs: live });
      return;
    }
  }
  try {
    const result = await runCountryDiscoveryJob(countryCrawlDeps(logger), {
      job,
      ...discoveryBudget(),
      signal: crawlAbort.signal,
    });
    logger.info('country_job_done', {
      jobId: job.id,
      country: result.countryCode,
      stoppedReason: result.stoppedReason,
      found: result.found,
      created: result.created,
      calls: result.calls,
    });
  } catch (error) {
    logger.error('country_job_failed', {
      jobId: job.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function every(errorEvent: string, ms: number, fn: () => Promise<void>) {
  for (;;) {
    try {
      await fn();
    } catch (error) {
      logger.error(errorEvent, {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    await new Promise((r) => setTimeout(r, ms));
  }
}

async function main() {
  logger.info('worker_started', {
    workerId: WORKER_ID,
    concurrency: CONCURRENCY,
    llm: Boolean(llm),
    render: true,
    schedulerTickMs: SCHEDULER_TICK_MS,
    ...discoveryBudget(),
  });

  let stopping = false;
  const shutdown = async () => {
    if (stopping) process.exit(130);
    stopping = true;
    logger.info('worker_shutdown', { workerId: WORKER_ID, crawlRunning: Boolean(activeCrawl) });
    crawlAbort.abort();
    if (activeCrawl) {
      await Promise.race([activeCrawl, new Promise((r) => setTimeout(r, SHUTDOWN_WAIT_MS))]);
    }
    await closeRenderBrowser();
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });

  await Promise.all([
    every('worker_tick_error', POLL_MS, tick),
    every('scheduler_tick_error', SCHEDULER_TICK_MS, schedulerTick),
    every('country_tick_error', POLL_MS, countryTick),
  ]);
}

main().catch(async (error) => {
  console.error(error);
  await closeRenderBrowser();
  process.exit(1);
});
