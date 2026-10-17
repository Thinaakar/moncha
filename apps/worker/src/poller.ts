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
  PrismaColdEmailAutomationRepository,
  PrismaColdEmailRepository,
  PrismaDiscoveryScheduleRepository,
  PrismaHostAuditCacheRepository,
  PrismaJobRunRepository,
  PrismaCompanyRepository,
  PrismaLeadBotRepository,
  PrismaLeadRepository,
  PrismaLlmUsageRepository,
  PrismaReviewTaskRepository,
  PrismaSiteAutomationRepository,
  PrismaSiteSnapshotRepository,
  PrismaWebsiteAuditRepository,
  PrismaWebsiteRepository,
  PrismaWorkerHeartbeatRepository,
  PrismaWorkerSettingsRepository,
  withDbRetry,
} from '@moncha/db';
import {
  createConsoleLogger,
  deploySiteSnapshotToWorker,
  enqueueDueSchedules,
  getWorkerQueueState,
  installSiteChatbot,
  pushSiteSnapshotToGithub,
  resolveCountry,
  runColdEmailAutomation,
  runCountryDiscoveryJob,
  runLeadBotTick,
  runLeadBotTrainTick,
  runSitePipelineTick,
  runSiteSnapshotJob,
  runWebsiteAuditJob,
  sweepAllSiteAutomation,
  websiteAuditJobLeadId,
  type CountryDiscoveryJobPayload,
  type JobRunRecord,
  type SiteStore,
} from '@moncha/domain';
import {
  closeRenderBrowser,
  defaultEvidenceRoot,
  LocalDiskEvidenceStore,
  MonchaSiteCapturer,
  MonchaWebsiteAuditor,
} from '@moncha/crawling';
import {
  coldEmailContent,
  coldEmailSendingEnabled,
  createOpenRouterFromEnv,
  createResendMailerFromEnv,
  GeminiBrandExtractor,
  isColdEmailRecipientAllowed,
  parseColdEmailAllowlist,
} from '@moncha/integrations';
import { countryCrawlDeps, discoveryBudget, liveCountryCrawls } from './country-crawls';
import { monchaInternalClient, siteAgentConfig, siteAutoCopyEnabled, siteGithubPublisher, siteWorkerDeployer } from './site-agent';

const WORKER_ID = `worker-${process.env.HOSTNAME || 'local'}-${randomUUID().slice(0, 8)}`;
const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY || 3));
const POLL_MS = Math.max(500, Number(process.env.WORKER_POLL_MS || 2000));
const STALE_MS = Math.max(60_000, Number(process.env.WORKER_STALE_MS || 10 * 60_000));
const SCHEDULER_TICK_MS = Math.max(5_000, Number(process.env.SCHEDULER_TICK_MS || 30_000));
const CRAWL_BUSY_RETRY_MS = 5 * 60_000;
const SHUTDOWN_WAIT_MS = 120_000;
/** Set in hosted containers (Cloudflare) so the platform can see the process is up. */
const HEALTH_PORT = Number(process.env.HEALTH_PORT || 0);
/**
 * false = standby: serve the API only and run no background loops (jobs, schedules, crawls, website pipeline, heartbeat),
 * so a second host can run against the same database while another worker still owns the jobs.
 */
const JOBS_ENABLED = process.env.WORKER_JOBS_ENABLED?.trim().toLowerCase() !== 'false';
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
const githubPublisher = siteGithubPublisher();
const workerDeployer = siteWorkerDeployer();
let activePipeline: Promise<void> | null = null;
/** Last wait logged, so a website waiting for its retry or a limit is logged once rather than every poll. */
let lastPipelineWait = '';
const siteSnapshots = new PrismaSiteSnapshotRepository(prisma);
const siteAutomation = new PrismaSiteAutomationRepository(prisma);
const workerSettings = new PrismaWorkerSettingsRepository(prisma);
const monchaBots = monchaInternalClient();
const leadBots = new PrismaLeadBotRepository(prisma);
/** Account problems, rate limits and full tiers pause every bot until this time. */
let botsPausedUntil = 0;
/** Same for bot training. */
let trainingPausedUntil = 0;
/**
 * MonCha answers `discovery_unavailable` both for one website it cannot crawl and when discovery is down. This many
 * bots in a row means it is down: new discoveries wait, while submitted trainings keep being polled.
 */
const DISCOVERY_OUTAGE_STREAK = 3;
const DISCOVERY_OUTAGE_WAIT_MS = 15 * 60_000;
let discoveryRefusals = 0;
let discoveryPausedUntil = 0;
/** Cached operator drain pause; refreshed at most once per second. */
let queuePausedCache: { at: number; paused: boolean } = { at: 0, paused: false };

async function isQueuePaused(): Promise<boolean> {
  const now = Date.now();
  if (now - queuePausedCache.at < 1_000) return queuePausedCache.paused;
  const state = await withDbRetry(() => getWorkerQueueState({ settings: workerSettings }));
  queuePausedCache = { at: now, paused: state.paused };
  return state.paused;
}

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
  const payload = (job.payload || {}) as { force?: boolean };
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
  const leadId = websiteAuditJobLeadId(job);
  if (!leadId) throw new Error('website_audit missing leadId');
  await runWebsiteAuditJob(auditDeps(), {
    jobId: job.id,
    tenantId: job.tenantId,
    leadId,
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
  if (await isQueuePaused()) return;
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

/**
 * One website at a time: copy, MonCha chatbot (widget colour + embed in index.html), GitHub push, Cloudflare Worker
 * deploy. The next website starts only when the current one is live or a step gave up after its tries (see
 * sitePipeline.ts). Audits and crawls keep running in their own loops.
 */
async function pipelineTick() {
  if (!siteAgent.ready || !siteAgent.store || activePipeline || crawlAbort.signal.aborted) return;
  const store = siteAgent.store;
  const queuePaused = await isQueuePaused();
  activePipeline = runSitePipelineTick({
    pipeline: siteSnapshots,
    snapshots: siteSnapshots,
    jobs,
    // A new copy starts only once its lead's MonCha bot is created and trained; a copy that already started keeps going.
    claimCopy: async (jobId) =>
      (await withDbRetry(() => jobs.claimJobs(WORKER_ID, 1, 'site_snapshot', { id: jobId, requireLeadBot: !jobId && Boolean(monchaBots) })))[0] ??
      null,
    runCopy: (job) => copySite(job, store),
    installChatbot: monchaBots
      ? (snapshot) =>
          installSiteChatbot({ snapshots: siteSnapshots, bots: leadBots, api: monchaBots, store, logger }, snapshot, crawlAbort.signal)
      : undefined,
    push: githubPublisher
      ? (snapshot) =>
          pushSiteSnapshotToGithub(
            {
              snapshots: siteSnapshots,
              store,
              publisher: githubPublisher,
              logger,
              liveUrlFor: workerDeployer ? (name) => workerDeployer.urlFor(name) : undefined,
            },
            snapshot,
            crawlAbort.signal,
          )
      : undefined,
    deploy: workerDeployer
      ? (snapshot) =>
          deploySiteSnapshotToWorker(
            {
              snapshots: siteSnapshots,
              store,
              deployer: workerDeployer,
              logger,
              domains: monchaBots ? { bots: leadBots, api: monchaBots, logger } : undefined,
              avatar: monchaBots ? { bots: leadBots, api: monchaBots, logger } : undefined,
            },
            snapshot,
            crawlAbort.signal,
          )
      : undefined,
    queuePaused,
    logger,
  })
    .then((outcome) => {
      if (outcome.action === 'idle') return;
      if (outcome.action === 'waiting') {
        const key = `${outcome.snapshotId}:${outcome.step}:${outcome.until?.toISOString() ?? ''}`;
        if (key === lastPipelineWait) return;
        lastPipelineWait = key;
      }
      logger.info('site_pipeline_tick', { ...outcome });
    })
    .finally(() => {
      activePipeline = null;
    });
  await activePipeline;
}

/**
 * One MonCha bot at a time, for leads whose website copy waits (then backfilled leads). A bot that fails its 3 tries
 * fails the lead's copy and the next lead goes on.
 */
async function leadBotTick() {
  if (!monchaBots || crawlAbort.signal.aborted || Date.now() < botsPausedUntil) return;
  const queuePaused = await isQueuePaused();
  const tick = await withDbRetry(() =>
    runLeadBotTick({ bots: leadBots, api: monchaBots, logger }, { signal: crawlAbort.signal, queuePaused }),
  );
  if (tick.action === 'ran') {
    if (tick.outcome.status === 'paused') botsPausedUntil = tick.outcome.until.getTime();
    logger.info('lead_bot_tick', { ...tick.outcome });
  }
}

/**
 * One training step at a time for created bots: discover the lead's website and submit its pages (ingest-bulk), or poll
 * a submitted training. The lead's copy starts once its bot is trained; a training that fails 3 tries fails the copy.
 */
async function leadBotTrainTick() {
  if (!monchaBots || crawlAbort.signal.aborted || Date.now() < trainingPausedUntil) return;
  // Draining the queue and a discovery outage both mean: no new discoveries, only in-flight training.
  const queuePaused = (await isQueuePaused()) || Date.now() < discoveryPausedUntil;
  const tick = await withDbRetry(() =>
    runLeadBotTrainTick({ bots: leadBots, api: monchaBots, logger }, { signal: crawlAbort.signal, queuePaused }),
  );
  if (tick.action === 'ran') {
    const outcome = tick.outcome;
    if (outcome.status === 'paused') trainingPausedUntil = outcome.until.getTime();
    if (outcome.status !== 'training') logger.info('lead_bot_train_tick', { ...outcome });
    if ((outcome.status === 'retry' || outcome.status === 'failed') && outcome.error.startsWith('discovery_unavailable')) {
      discoveryRefusals += 1;
      if (discoveryRefusals >= DISCOVERY_OUTAGE_STREAK) {
        discoveryPausedUntil = Date.now() + DISCOVERY_OUTAGE_WAIT_MS;
        discoveryRefusals = 0;
        logger.error('lead_bot_discovery_outage', {
          refusals: DISCOVERY_OUTAGE_STREAK,
          until: new Date(discoveryPausedUntil).toISOString(),
        });
      }
    } else if (outcome.status === 'submitted') {
      discoveryRefusals = 0;
    }
  }
}

function copySite(job: JobRunRecord, store: SiteStore) {
  return runSiteSnapshotJob(
    {
      jobs,
      snapshots: siteSnapshots,
      leads: new PrismaLeadRepository(prisma),
      companies: new PrismaCompanyRepository(prisma),
      capturer: siteCapturer,
      brandExtractor: siteBrandExtractor,
      store,
      llmUsage: new PrismaLlmUsageRepository(prisma),
      maxLlmCallsPerDay: Number(process.env.LLM_MAX_CALLS_PER_DAY || 0) || undefined,
      githubEnabled: Boolean(githubPublisher),
      workerEnabled: Boolean(workerDeployer),
      chatbotEnabled: Boolean(monchaBots),
      logger,
    },
    { job, timeoutMs: siteAgent.jobTimeoutMs, signal: crawlAbort.signal },
  )
    .then((outcome) => logger.info('site_snapshot_outcome', { jobId: job.id, ...outcome }))
    .catch((error) =>
      logger.error('site_snapshot_error', { jobId: job.id, message: error instanceof Error ? error.message : String(error) }),
    );
}

/**
 * Cold email automation, per tenant with it switched on: drafts for fully ready demos within the daily cap. `send` mode
 * also sends, but only to addresses COLD_EMAIL_SENDING_ENABLED + COLD_EMAIL_ALLOWLIST allow; the rest stay drafts.
 */
const COLD_EMAIL_TICK_MS = 5 * 60_000;
const coldEmailRepo = new PrismaColdEmailRepository(prisma);
const coldEmailAutomationRepo = new PrismaColdEmailAutomationRepository(prisma);
const coldEmailAutomationDeps = {
  coldEmails: coldEmailRepo,
  mailer: createResendMailerFromEnv(process.env),
  env: process.env as Record<string, unknown>,
  isAllowed: isColdEmailRecipientAllowed,
  sendingEnabled: coldEmailSendingEnabled,
  parseAllowlist: parseColdEmailAllowlist,
  buildContent: coldEmailContent,
  logger,
};

async function coldEmailTick() {
  if (crawlAbort.signal.aborted || (await isQueuePaused())) return;
  const tenants = await withDbRetry(() => coldEmailAutomationRepo.listEnabled());
  for (const settings of tenants) {
    await runColdEmailAutomation(coldEmailAutomationDeps, settings);
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
    jobs: JOBS_ENABLED ? 'enabled' : 'standby (API only)',
    concurrency: CONCURRENCY,
    llm: Boolean(llm),
    render: true,
    siteAgent: siteAgent.ready,
    siteAutoCopy: siteAgent.ready && siteAutoCopyEnabled(),
    sitePipeline: `one website at a time: copy, ${monchaBots ? 'chatbot, ' : ''}GitHub push, Worker deploy`,
    githubSites: githubPublisher ? `${githubPublisher.owner}/{site}@${githubPublisher.branch}` : false,
    workerSites: Boolean(workerDeployer),
    leadBots: monchaBots ? `${monchaBots.environment}: bot created and trained on the website before each copy` : false,
    schedulerTickMs: SCHEDULER_TICK_MS,
    ...discoveryBudget(),
  });
  if (JOBS_ENABLED && githubPublisher?.check) {
    void githubPublisher.check().then((check) =>
      check.error ? logger.error('site_github_check', { ...check }) : logger.info('site_github_check', { ...check }),
    );
  }
  if (JOBS_ENABLED && workerDeployer?.check) {
    void workerDeployer.check().then((check) =>
      check.error ? logger.error('site_worker_check', { ...check }) : logger.info('site_worker_check', { ...check }),
    );
  }

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
    const running = [activeCrawl, activePipeline].filter(Boolean);
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

  if (!JOBS_ENABLED) {
    if (!apiServer) logger.error('worker_standby_without_api', { workerId: WORKER_ID });
    return;
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
    every('site_pipeline_tick_error', POLL_MS, pipelineTick),
    every('lead_bot_tick_error', POLL_MS, leadBotTick),
    every('lead_bot_train_tick_error', POLL_MS, leadBotTrainTick),
    every('cold_email_tick_error', COLD_EMAIL_TICK_MS, coldEmailTick),
  ]);
}

main().catch(async (error) => {
  console.error(error);
  await closeRenderBrowser();
  process.exit(1);
});
