import './env';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { Server } from 'node:http';
import { neon } from '@neondatabase/serverless';
import { createApiServer } from './api';
import { runQueuedCsvImport, type CsvSqlClient } from './csv-import';
import { WORKER_HEARTBEAT_MS } from './worker-health';
import {
  prisma,
  PrismaAuditLogRepository,
  PrismaDiscoveryScheduleRepository,
  PrismaHostAuditCacheRepository,
  PrismaJobRunRepository,
  PrismaLeadRepository,
  PrismaLlmUsageRepository,
  PrismaReviewTaskRepository,
  PrismaSiteAutomationRepository,
  PrismaSiteSnapshotRepository,
  PrismaWebsiteAuditRepository,
  PrismaWebsiteRepository,
  PrismaWorkerHeartbeatRepository,
  withDbRetry,
} from '@moncha/db';
import {
  createConsoleLogger,
  enqueueDueSchedules,
  pushSiteSnapshotToGithub,
  resolveCountry,
  SITE_GITHUB_STALE_MS,
  runCountryDiscoveryJob,
  runSiteSnapshotJob,
  runWebsiteAuditJob,
  sweepAllSiteAutomation,
  type CountryDiscoveryJobPayload,
  type JobRunRecord,
} from '@moncha/domain';
import {
  closeRenderBrowser,
  defaultEvidenceRoot,
  LocalDiskEvidenceStore,
  MONCHA_WIDGET_JS,
  MonchaSiteCapturer,
  MonchaWebsiteAuditor,
} from '@moncha/crawling';
import { createOpenRouterFromEnv, GeminiBrandExtractor } from '@moncha/integrations';
import { countryCrawlDeps, discoveryBudget, liveCountryCrawls } from './country-crawls';
import { siteAgentConfig, siteAutoCopyEnabled, siteGithubPublisher } from './site-agent';

const WORKER_ID = `worker-${process.env.HOSTNAME || 'local'}-${randomUUID().slice(0, 8)}`;
const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY || 3));
const POLL_MS = Math.max(500, Number(process.env.WORKER_POLL_MS || 2000));
const STALE_MS = Math.max(60_000, Number(process.env.WORKER_STALE_MS || 10 * 60_000));
const SCHEDULER_TICK_MS = Math.max(5_000, Number(process.env.SCHEDULER_TICK_MS || 30_000));
const CRAWL_BUSY_RETRY_MS = 5 * 60_000;
const SHUTDOWN_WAIT_MS = 120_000;
/** Set in hosted containers (Cloudflare) so the platform can see the process is up. */
const HEALTH_PORT = Number(process.env.HEALTH_PORT || 0);
const STARTED_AT = new Date();

const logger = createConsoleLogger();
const jobs = new PrismaJobRunRepository(prisma);
const schedules = new PrismaDiscoveryScheduleRepository(prisma);
const heartbeats = new PrismaWorkerHeartbeatRepository(prisma);
const HOSTNAME = process.env.HOSTNAME || hostname();
const csvSql = neon(process.env.DATABASE_URL || '') as unknown as CsvSqlClient;
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

const siteAgent = siteAgentConfig();
const siteCapturer = new MonchaSiteCapturer({ limits: siteAgent.limits });
const siteBrandExtractor = llm
  ? new GeminiBrandExtractor({ client: llm, model: siteAgent.model, timeoutMs: siteAgent.llmTimeoutMs })
  : null;
let activeSiteSnapshot: Promise<void> | null = null;
const githubPublisher = siteGithubPublisher();
let activeGithubPush: Promise<void> | null = null;
const siteSnapshots = new PrismaSiteSnapshotRepository(prisma);
const siteAutomation = new PrismaSiteAutomationRepository(prisma);

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
  try {
    await withDbRetry(() => enqueueDueSchedules({ schedules, logger }));
  } finally {
    await siteAutomationTick();
  }
}

/** Queues website copies for qualified leads from finished crawls (tenants with automation on). */
async function siteAutomationTick() {
  if (!siteAgent.ready || !siteAutoCopyEnabled() || crawlAbort.signal.aborted) return;
  await withDbRetry(() => sweepAllSiteAutomation({ automation: siteAutomation, snapshots: siteSnapshots, logger }));
}

/** GET /api/v1/worker/health reports the worker offline when this row stops updating. */
async function heartbeatTick() {
  await withDbRetry(() => heartbeats.touch(WORKER_ID, HOSTNAME));
}

/** Large CSV files the API queued instead of importing during the request; one at a time. */
async function csvTick() {
  const [job] = await withDbRetry(() => jobs.claimJobs(WORKER_ID, 1, 'csv_import'));
  if (!job) return;
  const result = await runQueuedCsvImport({ sql: csvSql, jobs }, job);
  logger.info('csv_import_done', { jobId: job.id, tenantId: job.tenantId, ...result });
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

/** One website copy at a time per worker (Chromium memory); audits keep running in their own loop. */
async function siteTick() {
  if (!siteAgent.ready || !siteAgent.store || activeSiteSnapshot || crawlAbort.signal.aborted) return;
  const [job] = await withDbRetry(() => jobs.claimJobs(WORKER_ID, 1, 'site_snapshot'));
  if (!job) return;
  const store = siteAgent.store;
  activeSiteSnapshot = runSiteSnapshotJob(
    {
      jobs,
      snapshots: siteSnapshots,
      leads: new PrismaLeadRepository(prisma),
      capturer: siteCapturer,
      brandExtractor: siteBrandExtractor,
      store,
      llmUsage: new PrismaLlmUsageRepository(prisma),
      maxLlmCallsPerDay: Number(process.env.LLM_MAX_CALLS_PER_DAY || 0) || undefined,
      widgetJs: MONCHA_WIDGET_JS,
      githubEnabled: Boolean(githubPublisher),
      logger,
    },
    { job, timeoutMs: siteAgent.jobTimeoutMs, signal: crawlAbort.signal },
  )
    .then((outcome) => logger.info('site_snapshot_outcome', { jobId: job.id, ...outcome }))
    .catch((error) =>
      logger.error('site_snapshot_error', { jobId: job.id, message: error instanceof Error ? error.message : String(error) }),
    )
    .finally(() => {
      activeSiteSnapshot = null;
    });
  await activeSiteSnapshot;
}

/** Pushes finished copies to the sites repo, one at a time; GitHub problems never change a copy's status. */
async function githubTick() {
  if (!githubPublisher || !siteAgent.store || activeGithubPush || crawlAbort.signal.aborted) return;
  const now = new Date();
  const snapshot = await withDbRetry(() => siteSnapshots.claimGithubPush(now, new Date(now.getTime() - SITE_GITHUB_STALE_MS)));
  if (!snapshot) return;
  const store = siteAgent.store;
  activeGithubPush = pushSiteSnapshotToGithub(
    { snapshots: siteSnapshots, store, publisher: githubPublisher, logger },
    snapshot,
    crawlAbort.signal,
  )
    .then((outcome) => logger.info('site_github_outcome', { ...outcome }))
    .catch((error) =>
      logger.error('site_github_error', { snapshotId: snapshot.id, message: error instanceof Error ? error.message : String(error) }),
    )
    .finally(() => {
      activeGithubPush = null;
    });
  await activeGithubPush;
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
    siteAgent: siteAgent.ready,
    siteAutoCopy: siteAgent.ready && siteAutoCopyEnabled(),
    githubSites: githubPublisher ? `${githubPublisher.repo}@${githubPublisher.branch}` : false,
    schedulerTickMs: SCHEDULER_TICK_MS,
    ...discoveryBudget(),
  });

  let stopping = false;
  let apiServer: Server | null = null;
  const shutdown = async () => {
    if (stopping) process.exit(130);
    stopping = true;
    logger.info('worker_shutdown', { workerId: WORKER_ID, crawlRunning: Boolean(activeCrawl) });
    if (apiServer) {
      apiServer.close();
    }
    crawlAbort.abort();
    const running = [activeCrawl, activeSiteSnapshot, activeGithubPush].filter(Boolean);
    if (running.length) {
      await Promise.race([Promise.all(running), new Promise((r) => setTimeout(r, SHUTDOWN_WAIT_MS))]);
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

  const LISTEN_PORT = HEALTH_PORT || Number(process.env.PORT || 0);
  if (LISTEN_PORT) {
    apiServer = createApiServer({
      workerStatusProvider: () => ({
        workerId: WORKER_ID,
        startedAt: STARTED_AT.toISOString(),
        crawlRunning: Boolean(activeCrawl),
      }),
    });
    apiServer.listen(LISTEN_PORT, () => {
      logger.info('worker_api_listening', { port: LISTEN_PORT, workerId: WORKER_ID });
    });
  }

  await heartbeats
    .prune(new Date(Date.now() - 24 * 60 * 60_000))
    .catch((error) => logger.error('heartbeat_prune_error', { message: error instanceof Error ? error.message : String(error) }));

  await Promise.all([
    every('heartbeat_tick_error', WORKER_HEARTBEAT_MS, heartbeatTick),
    every('worker_tick_error', POLL_MS, tick),
    every('scheduler_tick_error', SCHEDULER_TICK_MS, schedulerTick),
    every('country_tick_error', POLL_MS, countryTick),
    every('csv_tick_error', POLL_MS, csvTick),
    every('site_tick_error', POLL_MS, siteTick),
    every('github_tick_error', POLL_MS, githubTick),
  ]);
}

main().catch(async (error) => {
  console.error(error);
  await closeRenderBrowser();
  process.exit(1);
});
