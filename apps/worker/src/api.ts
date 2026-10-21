import './env';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { neon } from '@neondatabase/serverless';
import {
  coldEmailAutomationUpdateSchema,
  coldEmailCandidatesQuerySchema,
  coldEmailDraftSchema,
  coldEmailDraftSendSchema,
  coldEmailListQuerySchema,
  coldEmailPreviewSchema,
  coldEmailSendSchema,
  countryDiscoverySchema,
  jobListQuerySchema,
  leadBotListQuerySchema,
  leadExportQuerySchema,
  monchaBotListQuerySchema,
  leadListQuerySchema,
  manualLeadSchema,
  passwordLoginSchema,
  resolveReviewSchema,
  reviewListQuerySchema,
  scheduleCreateSchema,
  scheduleDeleteCountrySchema,
  scheduleRunsQuerySchema,
  siteAutomationCrawlsQuerySchema,
  siteAutomationUpdateSchema,
  workerQueueUpdateSchema,
  siteCostSummaryQuerySchema,
  siteCostWebsitesQuerySchema,
  siteSnapshotListQuerySchema,
  sourceImportSchema,
  updateProfileSchema,
  type SiteCostModelPrice,
  type SiteCostPricing,
  type SiteCostSummary,
  type SiteCostWebsite,
  type SiteCostWebsiteDetail,
  type SiteCostWebsitePage,
  type SiteAutomationCrawl,
  type SiteAutomationState,
  type WorkerQueueState,
  type ColdEmailAutomationView,
  type ColdEmailCandidatePage,
  type ColdEmailCandidateView,
  type ColdEmailGateView,
  type ColdEmailPage,
  type ColdEmailPreviewView,
  type ColdEmailView,
  type LeadBotPage,
  type LeadBotView,
  type MonchaBotPage,
  type MonchaBotView,
  type MonchaInternalCheckResult,
  type SiteDeployCheckResult,
  type SiteGithubCheckResult,
  type SiteManifest,
  type SitePipelineStatus,
  type SiteQueue,
  type SiteQueueItem,
  type SiteSnapshotDetail,
  type SiteSnapshotQueued,
  type SiteSnapshotSource,
  type SiteSnapshotSummary,
  type SiteCopyProgress,
} from '@moncha/contracts';
import {
  isTransientDbError,
  prisma,
  PrismaAuditLogRepository,
  PrismaAuthUserRepository,
  PrismaColdEmailAutomationRepository,
  PrismaColdEmailRepository,
  PrismaCompanyRepository,
  PrismaDiscoveryScheduleRepository,
  PrismaJobRunRepository,
  PrismaLeadBotRepository,
  PrismaLeadRepository,
  PrismaReviewTaskRepository,
  PrismaSessionRepository,
  PrismaSiteAutomationRepository,
  PrismaSiteCostRepository,
  PrismaSiteSnapshotRepository,
  PrismaWebsiteRepository,
  PrismaWorkerSettingsRepository,
  withDbRetry,
} from '@moncha/db';
import {
  AuthError,
  bearerToken,
  coldEmailGate,
  createColdEmailDraft,
  createConsoleLogger,
  createManualLead,
  createSchedule,
  ColdEmailError,
  currentUser,
  envAdminsFrom,
  leadCsvChunks,
  leadExportFilename,
  loginEnvAdmin,
  logoutUser,
  previewColdEmail,
  sendColdEmailDraft,
  sendColdEmailNow,
  COLD_EMAIL_AUTOMATION_MAX_DAILY_CAP,
  updateProfile,
  type ColdEmailRecord,
  COUNTRY_PROFILES,
  DEFAULT_AUDIT_CONFIG,
  DEFAULT_INDUSTRIES,
  DEFAULT_SCHEDULE_TIMEZONE,
  deleteCountrySchedules,
  deleteSchedule,
  listReviewTasks,
  listScheduleRuns,
  listSchedules,
  omitChatbotSitesEnabled,
  resolveCountry,
  resolveReviewTask,
  ReviewError,
  ScheduleError,
  supportedCountries,
  websiteAuditDedupeKey,
  normalizeSiteFilePath,
  cancelSiteSnapshot,
  getSiteAutomationStatus,
  describeSitePipeline,
  getSiteQueue,
  getWorkerQueueState,
  setWorkerQueuePaused,
  queueSiteSnapshot,
  SiteAutomationError,
  SiteCancelError,
  requestSiteChatbotInstall,
  requestSiteGithubPush,
  requestSiteWorkerDeploy,
  SITE_CHATBOT_MAX_ATTEMPTS,
  SiteChatbotRequestError,
  SITE_GITHUB_MAX_ATTEMPTS,
  SITE_WORKER_MAX_ATTEMPTS,
  siteCopyProgress,
  SiteGithubRequestError,
  SiteWorkerRequestError,
  updateSiteAutomationSettings,
  publicSiteUrl,
  signPreviewToken,
  siteGithubDomain,
  siteName,
  siteStoragePrefix,
  SiteSnapshotRequestError,
  verifyPreviewToken,
  getSiteCostSummary,
  getSiteCostWebsite,
  listSiteCostWebsites,
  R2_STORAGE_USD_PER_GB_MONTH,
  storageUsdPerMonth,
  createLeadBotNow,
  LEAD_BOT_MAX_ATTEMPTS,
  LeadBotRequestError,
  retryLeadBot,
  trainLeadBotNow,
  type LeadBotItem,
  type CountryDiscoveryJobPayload,
  type ModelPriceRow,
  type SiteCostPricing as DomainSiteCostPricing,
  type SiteCostWebsiteRow,
  type SiteSnapshotListItem,
  type SiteSnapshotRecord,
} from '@moncha/domain';
import {
  coldEmailContent,
  coldEmailSendingEnabled,
  createPriceBookFromEnv,
  createResendMailerFromEnv,
  isColdEmailRecipientAllowed,
  MonchaInternalError,
  parseColdEmailAllowlist,
  type MonchaBotList,
} from '@moncha/integrations';
import { CsvImportError, SOURCE_IMPORT_JOB_TYPES, sourceImportView, startCsvImport, type CsvSqlClient } from './csv-import';
import { monchaInternalClient, siteAgentConfig, siteAutoCopyEnabled, siteGithubPublisher, siteWorkerDeployer } from './site-agent';
import { workerHealth } from './worker-health';

// Local test API for Postman: exposes the same use cases the console routes call.
// Routes other than /api/v1/auth/* need no login: tenant comes from the x-tenant-id header or DEFAULT_TENANT_ID.
// Dev database only.

const PORT = Number(process.env.WORKER_API_PORT || 4000);
const HOST = process.env.WORKER_API_HOST || '127.0.0.1';
const API_KEY = process.env.WORKER_API_KEY || '';
const MAX_BODY_BYTES = 10_000_000;
// Below the console proxy's 60s timeout, so readers get a 503 envelope instead of a gateway timeout
// while Prisma waits out connect_timeout / pool_timeout on an unreachable database.
const READ_DEADLINE_MS = 25_000;

const logger = createConsoleLogger();
const schedules = new PrismaDiscoveryScheduleRepository(prisma);
const jobs = new PrismaJobRunRepository(prisma);
const leads = new PrismaLeadRepository(prisma);
let neonSql: CsvSqlClient | null = null;
/** Set-based CSV import and worker health share their SQL with the Cloudflare edge. */
const sqlClient = (): CsvSqlClient => (neonSql ??= neon(process.env.DATABASE_URL || '') as unknown as CsvSqlClient);

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Ctx = {
  req: IncomingMessage;
  url: URL;
  tenantId: string;
  params: Record<string, string>;
  body: () => Promise<unknown>;
};
type RawBody = {
  body: AsyncIterable<Uint8Array>;
  contentType: string;
  contentLength?: number;
  headers?: Record<string, string>;
};
type Result = { status?: number; json: unknown } | { status?: number; raw: RawBody };
type Handler = (ctx: Ctx) => Promise<Result>;

const routes: Array<{ method: string; pattern: RegExp; handler: Handler }> = [];
/** `:name` matches one path segment, `*name` the rest of the path. */
function route(method: string, path: string, handler: Handler) {
  const pattern = new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>[^/]+)').replace(/\*(\w+)/g, '(?<$1>.+)')}$`);
  routes.push({ method, pattern, handler });
}

const query = (url: URL, ...keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, url.searchParams.get(k) ?? undefined]));

export type WorkerStatusProvider = () => {
  workerId: string;
  startedAt: string;
  crawlRunning: boolean;
};

let workerStatusProvider: WorkerStatusProvider | null = null;
export function setWorkerStatusProvider(provider: WorkerStatusProvider | null) {
  workerStatusProvider = provider;
}

route('GET', '/health', async ({ tenantId }) => {
  let dbStatus = 'up';
  try {
    await withDbRetry(() => prisma.$queryRaw`SELECT 1`, 2);
  } catch (error) {
    dbStatus = `down: ${error instanceof Error ? error.message : String(error)}`;
  }
  const workerStatus = workerStatusProvider?.();
  return {
    status: dbStatus === 'up' ? 200 : 503,
    json: {
      ok: dbStatus === 'up',
      db: dbStatus,
      tenantId: tenantId || process.env.DEFAULT_TENANT_ID || 'unspecified',
      countries: supportedCountries(),
      ...(workerStatus ? { worker: workerStatus } : {}),
    },
  };
});

// Daily schedules
route('GET', '/api/v1/schedules', async ({ tenantId }) => ({
  json: { countries: await listSchedules({ schedules }, { tenantId }) },
}));

route('POST', '/api/v1/schedules', async ({ tenantId, body }) => {
  const input = scheduleCreateSchema.parse(await body());
  return { status: 201, json: await createSchedule({ schedules }, { ...input, tenantId }) };
});

route('DELETE', '/api/v1/schedules', async ({ tenantId, url }) => {
  const { country } = scheduleDeleteCountrySchema.parse(query(url, 'country'));
  return { json: await deleteCountrySchedules({ schedules }, { tenantId, country }) };
});

route('GET', '/api/v1/schedules/runs', async ({ tenantId, url }) => {
  const { limit } = scheduleRunsQuerySchema.parse(query(url, 'limit'));
  return { json: { runs: await listScheduleRuns({ schedules }, { tenantId, limit }) } };
});

route('DELETE', '/api/v1/schedules/:id', async ({ tenantId, params }) => ({
  json: await deleteSchedule({ schedules }, { tenantId, id: params.id! }),
}));

// Country crawl: queued now, run by the worker (pnpm --filter @moncha/worker start).
route('POST', '/api/v1/discovery/country', async ({ tenantId, body }) => {
  const input = countryDiscoverySchema.parse(await body());
  const profile = resolveCountry(input.country);
  if (!profile) {
    throw new HttpError(400, 'validation_error', `Unsupported country. Supported: ${supportedCountries().join(', ')}`);
  }
  const payload: CountryDiscoveryJobPayload = {
    mode: 'country',
    origin: 'manual',
    country: profile.name,
    countryCode: profile.code,
    cities: input.cities,
    industries: input.industries,
    maxPages: input.maxPages,
    maxSearches: input.maxSearches,
    maxCallsPerDay: input.maxCallsPerDay,
    reset: input.reset,
  };
  const job = await jobs.create({ tenantId, type: 'country_discovery', payload, maxAttempts: 1 });
  return { status: 202, json: { id: job.id, status: job.status, type: job.type } };
});

// Form options for the country crawl and schedules.
route('GET', '/api/v1/discovery/options', async () => ({
  json: {
    countries: COUNTRY_PROFILES.map((p) => ({ code: p.code, name: p.name, cities: [...p.cities] })),
    industries: [...DEFAULT_INDUSTRIES],
    defaults: { source: 'google_places', maxPages: 3, timezone: DEFAULT_SCHEDULE_TIMEZONE },
  },
}));

/**
 * Fills `deploy.domains` (the lead's MonCha widget allowed hosts, set right after a deploy) on deployed copies, with one
 * lookup for the whole page. Copies whose lead has no created bot keep `domains` undefined.
 */
async function withDeployDomains(tenantId: string, summaries: SiteSnapshotSummary[]): Promise<SiteSnapshotSummary[]> {
  const leadIds = summaries.filter((s) => s.deploy).map((s) => s.leadId);
  if (!leadIds.length) return summaries;
  const byLead = new Map((await leadBots.domainsForLeads(tenantId, leadIds)).map((b) => [b.leadId, b]));
  return summaries.map((s) => {
    const bot = s.deploy ? byLead.get(s.leadId) : undefined;
    if (!s.deploy || !bot) return s;
    return {
      ...s,
      deploy: { ...s.deploy, domains: bot.domains, domainsConfiguredAt: bot.domainsConfiguredAt?.toISOString() ?? null },
    };
  });
}

/** Adds `site` (the copy's summary: GitHub push, Worker deploy, live URL, progress) to website copy jobs. */
async function withSiteCopies<T extends { id: string; type: string }>(tenantId: string, items: T[]) {
  const ids = items.filter((j) => j.type === 'site_snapshot').map((j) => j.id);
  if (!ids.length) return items;
  const snapshots = await siteSnapshots.listByJobIds(tenantId, ids);
  const summaries = await withDeployDomains(tenantId, snapshots.map((s) => siteSummary(s, null)));
  const byJob = new Map(summaries.map((s) => [s.jobId, s]));
  return items.map((j) => (j.type === 'site_snapshot' ? { ...j, site: byJob.get(j.id) ?? null } : j));
}

route('GET', '/api/v1/jobs', async ({ tenantId, url }) => {
  const q = jobListQuerySchema.parse(query(url, 'page', 'pageSize', 'type', 'status', 'origin', 'deploy'));
  const page = await jobs.listPage(tenantId, q);
  return { json: { ...page, items: await withSiteCopies(tenantId, page.items) } };
});

route('GET', '/api/v1/jobs/:id', async ({ tenantId, params }) => {
  const job = await jobs.get(tenantId, params.id!);
  if (!job) throw new HttpError(404, 'not_found', 'Job not found');
  const [json] = await withSiteCopies(tenantId, [job]);
  return { json };
});

// Leads
route('GET', '/api/v1/leads', async ({ tenantId, url }) => {
  const q = leadListQuerySchema.parse(query(url, 'page', 'pageSize', 'search', 'country', 'queue'));
  // queue=ALL (parsed to undefined) must list every lead, including chatbot sites.
  return { json: await leads.list(tenantId, { ...q, omitChatbotSites: q.queue ? omitChatbotSitesEnabled() : false }) };
});

// Registered before /leads/:id so "export" is not read as a lead id.
route('GET', '/api/v1/leads/export', async ({ tenantId, url }) => {
  const q = leadExportQuerySchema.parse(query(url, 'search', 'country', 'queue'));
  const batches = leads.exportBatches(tenantId, { ...q, omitChatbotSites: q.queue ? omitChatbotSitesEnabled() : false });
  const filename = leadExportFilename(q.queue, new Date());
  return {
    raw: {
      body: leadCsvChunks(batches),
      contentType: 'text/csv; charset=utf-8',
      headers: { 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'no-store' },
    },
  };
});

route('GET', '/api/v1/leads/counts', async ({ tenantId }) => ({ json: await leads.queueCounts(tenantId) }));

route('POST', '/api/v1/leads', async ({ tenantId, body }) => {
  const input = manualLeadSchema.parse(await body());
  const result = await createManualLead(
    {
      companies: new PrismaCompanyRepository(prisma),
      leads,
      websites: new PrismaWebsiteRepository(prisma),
      jobs,
      logger,
    },
    { ...input, tenantId },
  );
  return { status: result.duplicate ? 200 : 201, json: result };
});

route('GET', '/api/v1/leads/:id', async ({ tenantId, params }) => {
  const lead = await leads.get(tenantId, params.id!);
  if (!lead) throw new HttpError(404, 'not_found', 'Lead not found');
  return { json: lead };
});

/** Queues a forced website audit for the lead, or returns the audit job already queued for it. */
async function queueLeadAudit(tenantId: string, id: string) {
  const lead = await leads.get(tenantId, id);
  if (!lead?.company.domain) throw new HttpError(404, 'not_found', 'Lead or its website domain not found');
  const open = await prisma.jobRun.findFirst({
    where: {
      tenantId,
      type: 'website_audit',
      status: { in: ['pending', 'running'] },
      leadId: id,
    },
    select: { id: true, status: true },
  });
  if (open) return { ...open, deduped: true };

  const url = `https://${lead.company.domain}`;
  await new PrismaWebsiteRepository(prisma).upsert({ tenantId, companyId: lead.companyId, url, status: 'UNCHECKED' });
  const job = await jobs.create({
    tenantId,
    type: 'website_audit',
    payload: { leadId: id, companyId: lead.companyId, url, force: true },
    leadId: id,
    dedupeKey: `${websiteAuditDedupeKey(id, DEFAULT_AUDIT_CONFIG.classifierVersion)}:manual:${Date.now()}`,
  });
  return { id: job.id, status: job.status };
}

// Re-audit one lead's website (the worker picks it up).
route('POST', '/api/v1/leads/:id/audit', async ({ tenantId, params }) => ({
  status: 202,
  json: await queueLeadAudit(tenantId, params.id!),
}));

// Auth: bearer-token sessions. Only the MONCHA_LEAD_ADMIN_USERS emails can sign in or keep a session.
const envAdmins = envAdminsFrom(process.env);
const auth = {
  users: new PrismaAuthUserRepository(prisma),
  sessions: new PrismaSessionRepository(prisma),
  allowedEmails: envAdmins.emails,
};
const tokenOf = (req: IncomingMessage) => bearerToken(req.headers.authorization);

// Review queue: NEEDS_REVIEW leads wait here for a human decision.
const reviewDeps = {
  reviewTasks: new PrismaReviewTaskRepository(prisma),
  leads,
  auditLogs: new PrismaAuditLogRepository(prisma),
  requestReaudit: queueLeadAudit,
  logger,
};

route('GET', '/api/v1/reviews', async ({ tenantId, url }) => {
  const q = reviewListQuerySchema.parse(query(url, 'page', 'pageSize', 'status', 'search', 'country'));
  return { json: await listReviewTasks(reviewDeps, { ...q, tenantId }) };
});

route('GET', '/api/v1/reviews/:id', async ({ tenantId, params }) => {
  const task = await reviewDeps.reviewTasks.get(tenantId, params.id!);
  if (!task) throw new HttpError(404, 'not_found', 'Review task not found');
  return { json: task };
});

// Resolver is the signed-in user when a bearer token is sent; an invalid token is rejected.
route('POST', '/api/v1/reviews/:id/resolve', async ({ req, tenantId, params, body }) => {
  const input = resolveReviewSchema.parse(await body());
  const token = tokenOf(req);
  const user = token ? await currentUser(auth, { token }) : null;
  if (user && user.tenantId !== tenantId) throw new HttpError(403, 'forbidden', 'Signed-in user belongs to another tenant');
  const resolvedBy = user ? user.email : 'api';
  return { json: await resolveReviewTask(reviewDeps, { ...input, tenantId, id: params.id!, resolvedBy }) };
});

route('POST', '/api/v1/auth/login', async ({ tenantId, body }) => {
  const input = passwordLoginSchema.parse(await body());
  return { json: await loginEnvAdmin(auth, envAdmins, { ...input, tenantId }) };
});

route('POST', '/api/v1/auth/logout', async ({ req }) => ({ json: await logoutUser(auth, { token: tokenOf(req) }) }));

route('GET', '/api/v1/auth/me', async ({ req }) => ({ json: { user: await currentUser(auth, { token: tokenOf(req) }) } }));

route('PATCH', '/api/v1/auth/me', async ({ req, body }) => {
  const input = updateProfileSchema.parse(await body());
  return { json: { user: await updateProfile(auth, { ...input, token: tokenOf(req) }) } };
});

// Background worker liveness (heartbeat written by poller.ts).
route('GET', '/api/v1/worker/health', async ({ tenantId }) => ({ json: await workerHealth(sqlClient(), tenantId) }));

// CSV import: small files now, large files queued for the worker.
route('POST', '/api/v1/source-imports', async ({ tenantId, body }) => {
  const input = sourceImportSchema.parse(await body());
  if (input.source !== 'csv') {
    throw new HttpError(
      400,
      'unsupported_source',
      'Only source "csv" is imported here. Use POST /api/v1/discovery/country for Google Places discovery.',
    );
  }
  const started = await startCsvImport({ sql: sqlClient(), jobs }, { tenantId, csv: input.csv, records: input.records });
  return { status: 202, json: started };
});

route('GET', '/api/v1/source-imports/:id', async ({ tenantId, params }) => {
  const job = await jobs.get(tenantId, params.id!);
  if (!job || !SOURCE_IMPORT_JOB_TYPES.includes(job.type)) throw new HttpError(404, 'not_found', 'Import not found');
  return { json: sourceImportView(job) };
});

// Website copies (site_snapshot jobs run by the worker; files live in R2).
const siteSnapshots = new PrismaSiteSnapshotRepository(prisma);
const workerSettings = new PrismaWorkerSettingsRepository(prisma);
const SOURCE_VIEW_MAX_BYTES = 3 * 1024 * 1024;

function workerQueueJson(state: Awaited<ReturnType<typeof getWorkerQueueState>>): WorkerQueueState {
  return {
    paused: state.paused,
    pausedAt: state.pausedAt?.toISOString() ?? null,
    pausedBy: state.pausedBy,
    updatedAt: state.updatedAt?.toISOString() ?? null,
  };
}

function requireSiteAgent() {
  const config = siteAgentConfig();
  if (!config.ready || !config.store || !config.previewSecret) {
    throw new HttpError(503, 'site_agent_not_configured', 'Website copies need R2_* and SITE_PREVIEW_SECRET in apps/worker/.env');
  }
  return { ...config, store: config.store, previewSecret: config.previewSecret };
}

/** Proxy-relative base for a finished snapshot's files: `site-files/{token}/`. */
async function previewBaseFor(snapshot: SiteSnapshotRecord): Promise<string | null> {
  const config = siteAgentConfig();
  if (snapshot.status !== 'done' || !config.previewSecret) return null;
  const token = await signPreviewToken(
    { snapshotId: snapshot.id, tenantId: snapshot.tenantId },
    config.previewSecret,
    config.previewTtlSec,
  );
  return `site-files/${token}/`;
}

const summarize = async (snapshot: SiteSnapshotRecord | SiteSnapshotListItem) =>
  siteSummary(snapshot, await previewBaseFor(snapshot));

/** The website's own Worker once deployed; otherwise the older shared Pages link (serves the copy's R2 files). */
function publicUrlFor(snapshot: SiteSnapshotRecord | SiteSnapshotListItem): string | null {
  if (snapshot.status !== 'done') return null;
  if (snapshot.workerStatus === 'deployed' && snapshot.workerUrl) return snapshot.workerUrl;
  const base = siteAgentConfig().publicBaseUrl;
  if (!base || !('company' in snapshot)) return null;
  return publicSiteUrl(base, siteGithubDomain(snapshot), snapshot.id);
}

function siteSummary(snapshot: SiteSnapshotRecord | SiteSnapshotListItem, previewBase: string | null): SiteSnapshotSummary {
  return {
    id: snapshot.id,
    leadId: snapshot.leadId,
    jobId: snapshot.jobId,
    status: snapshot.status,
    sourceUrl: snapshot.sourceUrl,
    finalUrl: snapshot.finalUrl,
    httpStatus: snapshot.httpStatus,
    sourceHash: snapshot.sourceHash,
    sourceBytes: snapshot.sourceBytes,
    sourceCharset: snapshot.sourceCharset,
    assetCount: snapshot.assetCount,
    skippedAssetCount: snapshot.skippedAssetCount,
    totalBytes: snapshot.totalBytes,
    llmModel: snapshot.llmModel,
    llmPromptTokens: snapshot.llmPromptTokens,
    llmCompletionTokens: snapshot.llmCompletionTokens,
    llmCostUsd: snapshot.llmCostUsd,
    warnings: snapshot.warnings,
    failureReason: snapshot.failureReason,
    failureDetail: snapshot.failureDetail,
    attempts: snapshot.attempts,
    origin: snapshot.origin,
    crawlJobId: snapshot.crawlJobId,
    createdAt: snapshot.createdAt.toISOString(),
    finishedAt: snapshot.finishedAt?.toISOString() ?? null,
    ...('company' in snapshot ? { company: snapshot.company, siteName: siteName(snapshot) } : {}),
    thumbnailPath: previewBase ? `${previewBase}screenshot-desktop.png` : null,
    github: snapshot.githubStatus
      ? {
          status: snapshot.githubStatus,
          attempts: snapshot.githubAttempts,
          maxAttempts: SITE_GITHUB_MAX_ATTEMPTS,
          nextAt: snapshot.githubNextAt?.toISOString() ?? null,
          commitSha: snapshot.githubCommitSha,
          commitUrl: snapshot.githubCommitUrl,
          folderUrl: snapshot.githubFolderUrl,
          repo: snapshot.githubRepo,
          error: snapshot.githubError,
          pushedAt: snapshot.githubPushedAt?.toISOString() ?? null,
        }
      : null,
    deploy: snapshot.workerStatus
      ? {
          status: snapshot.workerStatus,
          attempts: snapshot.workerAttempts,
          maxAttempts: SITE_WORKER_MAX_ATTEMPTS,
          nextAt: snapshot.workerNextAt?.toISOString() ?? null,
          name: snapshot.workerName,
          url: snapshot.workerUrl,
          error: snapshot.workerError,
          deployedAt: snapshot.workerDeployedAt?.toISOString() ?? null,
        }
      : null,
    chatbot: snapshot.chatbotStatus
      ? {
          status: snapshot.chatbotStatus,
          attempts: snapshot.chatbotAttempts,
          maxAttempts: SITE_CHATBOT_MAX_ATTEMPTS,
          nextAt: snapshot.chatbotNextAt?.toISOString() ?? null,
          error: snapshot.chatbotError,
          installedAt: snapshot.chatbotInstalledAt?.toISOString() ?? null,
        }
      : null,
    publicUrl: publicUrlFor(snapshot),
    progress: progressFor(snapshot),
  };
}

function progressFor(snapshot: SiteSnapshotRecord): SiteCopyProgress {
  const progress = siteCopyProgress(snapshot, {
    githubEnabled: Boolean(siteGithubPublisher()),
    workerEnabled: Boolean(siteWorkerDeployer()),
    chatbotEnabled: Boolean(monchaInternalClient()),
  });
  return { ...progress, since: progress.since?.toISOString() ?? null, nextAt: progress.nextAt?.toISOString() ?? null };
}

async function getSnapshotOr404(tenantId: string, id: string) {
  const snapshot = await siteSnapshots.get(tenantId, id);
  if (!snapshot) throw new HttpError(404, 'not_found', 'Website copy not found');
  return snapshot;
}

/** Signed-in admin or operator of this tenant; `action` completes "Sign in to …" and "Viewers cannot …". */
async function requireEditor(req: IncomingMessage, tenantId: string, action: string) {
  const token = tokenOf(req);
  if (!token) throw new HttpError(401, 'unauthorized', `Sign in to ${action}`);
  const user = await currentUser(auth, { token });
  if (user.tenantId !== tenantId) throw new HttpError(403, 'forbidden', 'Signed-in user belongs to another tenant');
  if (user.role === 'viewer') throw new HttpError(403, 'forbidden', `Viewers cannot ${action}`);
  return user;
}

// Each run costs crawl time and LLM budget, so it needs a signed-in user who is not a viewer.
route('POST', '/api/v1/leads/:id/site-snapshots', async ({ req, tenantId, params }) => {
  requireSiteAgent();
  await requireEditor(req, tenantId, 'create website copies');
  try {
    const queued = await queueSiteSnapshot({ leads, snapshots: siteSnapshots }, { tenantId, leadId: params.id! });
    const json: SiteSnapshotQueued = {
      snapshotId: queued.snapshot.id,
      jobId: queued.job?.id ?? queued.snapshot.jobId ?? '',
      status: queued.snapshot.status,
      ...(queued.deduped ? { deduped: true } : {}),
    };
    return { status: queued.deduped ? 200 : 202, json };
  } catch (error) {
    if (error instanceof SiteSnapshotRequestError) {
      throw error.code === 'lead_not_found'
        ? new HttpError(404, 'not_found', 'Lead not found')
        : new HttpError(409, 'no_website', 'This lead has no website to copy');
    }
    throw error;
  }
});

route('GET', '/api/v1/leads/:id/site-snapshots', async ({ tenantId, params }) => {
  const items = await siteSnapshots.listForLead(tenantId, params.id!, 20);
  return { json: { items: await withDeployDomains(tenantId, await Promise.all(items.map(summarize))) } };
});

route('GET', '/api/v1/site-snapshots', async ({ tenantId, url }) => {
  const q = siteSnapshotListQuerySchema.parse(query(url, 'page', 'pageSize', 'status', 'search', 'origin'));
  const page = await siteSnapshots.list(tenantId, q);
  return { json: { ...page, items: await withDeployDomains(tenantId, await Promise.all(page.items.map(summarize))) } };
});

// Registered before /site-snapshots/:id so "queue" is not read as an id.
route('GET', '/api/v1/site-snapshots/queue', async ({ tenantId }) => {
  const view = await getSiteQueue({ snapshots: siteSnapshots }, { tenantId, slots: 1 });
  const toItem = (item: (typeof view.running)[number]): SiteQueueItem => ({
    ...siteSummary(item, null),
    position: item.position,
    estimatedAt: item.estimatedAt.toISOString(),
    retrying: item.retrying,
    attempts: item.job?.attempts ?? 0,
    maxAttempts: item.job?.maxAttempts ?? 0,
    runAfter: item.job?.runAfter.toISOString() ?? null,
    startedAt: (item.job?.lockedAt ?? item.job?.startedAt)?.toISOString() ?? null,
    lastError: item.job?.lastError ?? null,
  });
  const json: SiteQueue = {
    running: view.running.map(toItem),
    waiting: view.waiting.map(toItem),
    averageRunMs: view.averageRunMs,
    measured: view.measured,
  };
  return { json };
});

route('GET', '/api/v1/site-pipeline', async ({ tenantId }) => {
  const [view, queue] = await Promise.all([
    describeSitePipeline(
      {
        pipeline: siteSnapshots,
        jobs,
        steps: {
          github: Boolean(siteGithubPublisher()),
          worker: Boolean(siteWorkerDeployer()),
          chatbot: Boolean(monchaInternalClient()),
        },
      },
      { tenantId },
    ),
    getWorkerQueueState({ settings: workerSettings }),
  ]);
  const current = view.current;
  const json: SitePipelineStatus = {
    enabled: siteAgentConfig().ready,
    steps: { github: view.steps.github, deploy: view.steps.worker, chatbot: Boolean(view.steps.chatbot) },
    queue: workerQueueJson(queue),
    current: current
      ? {
          site: siteSummary(current.snapshot, null),
          step: current.step,
          state: current.state,
          attempts: current.attempts,
          maxAttempts: current.maxAttempts,
          nextAt: current.nextAt?.toISOString() ?? null,
          error: current.error,
        }
      : null,
    toPublish: view.toPublish,
    waitingCopies: view.waitingCopies,
  };
  return { json };
});

/** Operator drain pause for bots + website pipeline. Discovery schedules keep running. */
route('GET', '/api/v1/queue', async () => ({ json: workerQueueJson(await getWorkerQueueState({ settings: workerSettings })) }));

route('PUT', '/api/v1/queue', async ({ req, tenantId, body }) => {
  const user = await requireEditor(req, tenantId, 'pause or resume the queue');
  const input = workerQueueUpdateSchema.parse(await body());
  const state = await setWorkerQueuePaused(
    { settings: workerSettings },
    { paused: input.paused, pausedBy: user.id },
  );
  logger.info('worker_queue.updated', { tenantId, userId: user.id, paused: state.paused });
  return { json: workerQueueJson(state) };
});

route('POST', '/api/v1/site-snapshots/:id/cancel', async ({ req, tenantId, params }) => {
  await requireEditor(req, tenantId, 'cancel website copies');
  try {
    return { json: await cancelSiteSnapshot({ snapshots: siteSnapshots }, { tenantId, id: params.id! }) };
  } catch (error) {
    if (error instanceof SiteCancelError) {
      throw error.code === 'not_found'
        ? new HttpError(404, 'not_found', 'Website copy not found')
        : new HttpError(409, 'not_pending', 'Only copies that have not started can be cancelled');
    }
    throw error;
  }
});

// Costs: AI tokens and storage behind each website copy. Older rows without OpenRouter's charge are
// priced from OpenRouter's model list (cached), so the numbers are marked estimated.
const siteCosts = { costs: new PrismaSiteCostRepository(prisma), prices: createPriceBookFromEnv() };

const priceView = (row: ModelPriceRow): SiteCostModelPrice => ({
  model: row.model,
  inputPerMillionUsd: row.input * 1_000_000,
  outputPerMillionUsd: row.output * 1_000_000,
});

function pricingView(pricing: DomainSiteCostPricing): SiteCostPricing {
  return {
    source: pricing.list.source,
    fetchedAt: pricing.list.fetchedAt?.toISOString() ?? null,
    models: pricing.rows.map(priceView).sort((a, b) => a.model.localeCompare(b.model)),
    unpricedModels: [...pricing.unpriced].sort(),
    r2StorageUsdPerGbMonth: R2_STORAGE_USD_PER_GB_MONTH,
  };
}

function costWebsiteView(row: SiteCostWebsiteRow): SiteCostWebsite {
  return {
    ...row,
    aiCostUsd: row.copyCostUsd + row.auditCostUsd,
    storageUsdPerMonth: storageUsdPerMonth(row.storageBytes),
    firstCopyAt: row.firstCopyAt.toISOString(),
    lastCopyAt: row.lastCopyAt.toISOString(),
  };
}

route('GET', '/api/v1/costs/summary', async ({ tenantId, url }) => {
  const q = siteCostSummaryQuerySchema.parse(query(url, 'days'));
  const result = await getSiteCostSummary(siteCosts, { tenantId, days: q.days });
  const t = result.totals;
  const aiCostUsd = t.copyCostUsd + t.auditCostUsd;
  const tokens = t.copyTokens.input + t.copyTokens.output + t.auditTokens.input + t.auditTokens.output;
  const prices = new Map(result.pricing.rows.map((row) => [row.model, row]));
  const json: SiteCostSummary = {
    days: result.days,
    since: result.since?.toISOString() ?? null,
    websites: t.websites,
    copies: t.copies,
    aiAudits: t.aiAudits,
    copyTokens: t.copyTokens,
    auditTokens: t.auditTokens,
    copyCostUsd: t.copyCostUsd,
    auditCostUsd: t.auditCostUsd,
    aiCostUsd,
    exactCostUsd: t.exactCostUsd,
    estimatedCostUsd: t.estimatedCostUsd,
    averagePerWebsiteUsd: t.websites ? aiCostUsd / t.websites : null,
    averageTokensPerWebsite: t.websites ? Math.round(tokens / t.websites) : null,
    storageBytes: t.storageBytes,
    storageUsdPerMonth: storageUsdPerMonth(t.storageBytes),
    byModel: result.byModel.map((row) => {
      const price = row.model ? prices.get(row.model) : undefined;
      return { ...row, price: price ? priceView(price) : null };
    }),
    byDay: result.byDay,
    pricing: pricingView(result.pricing),
  };
  return { json };
});

route('GET', '/api/v1/costs/websites', async ({ tenantId, url }) => {
  const q = siteCostWebsitesQuerySchema.parse(query(url, 'days', 'page', 'pageSize', 'search', 'sort'));
  const result = await listSiteCostWebsites(siteCosts, { tenantId, ...q });
  const json: SiteCostWebsitePage = {
    items: result.items.map(costWebsiteView),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
    pricing: pricingView(result.pricing),
  };
  return { json };
});

route('GET', '/api/v1/costs/websites/:leadId', async ({ tenantId, params }) => {
  const result = await getSiteCostWebsite(siteCosts, { tenantId, leadId: params.leadId! });
  if (!result) throw new HttpError(404, 'not_found', 'This lead has no website copies');
  const json: SiteCostWebsiteDetail = {
    ...costWebsiteView(result.row),
    copyRuns: result.copies.map(({ id, createdAt, ...run }) => ({
      ...run,
      snapshotId: id,
      createdAt: createdAt.toISOString(),
    })),
    auditRuns: result.audits.map(({ id, auditedAt, ...run }) => ({
      ...run,
      auditId: id,
      auditedAt: auditedAt.toISOString(),
    })),
    pricing: pricingView(result.pricing),
  };
  return { json };
});

// Copy automation: after each country crawl, its new qualified leads are queued for website copies.
const siteAutomation = new PrismaSiteAutomationRepository(prisma);

async function automationState(tenantId: string): Promise<SiteAutomationState> {
  const status = await getSiteAutomationStatus({ automation: siteAutomation }, { tenantId });
  return {
    enabled: status.settings.enabled,
    dailyCap: status.settings.dailyCap,
    enabledAt: status.settings.enabledAt?.toISOString() ?? null,
    updatedAt: status.settings.updatedAt?.toISOString() ?? null,
    updatedBy: status.settings.updatedBy,
    today: { ...status.today, resetsAt: status.today.resetsAt.toISOString() },
    carriedOver: status.carriedOver,
    waitingCrawls: status.waitingCrawls,
    agentReady: siteAgentConfig().ready,
    workerEnabled: siteAutoCopyEnabled(),
  };
}

route('GET', '/api/v1/site-automation', async ({ tenantId }) => ({ json: await automationState(tenantId) }));

route('PUT', '/api/v1/site-automation', async ({ req, tenantId, body }) => {
  const user = await requireEditor(req, tenantId, 'change copy automation');
  const input = siteAutomationUpdateSchema.parse(await body());
  try {
    await updateSiteAutomationSettings(
      { automation: siteAutomation },
      { tenantId, enabled: input.enabled, dailyCap: input.dailyCap, updatedBy: user.email },
    );
  } catch (error) {
    if (error instanceof SiteAutomationError) throw new HttpError(400, error.code, error.message);
    throw error;
  }
  logger.info('site_automation.settings_updated', { tenantId, userId: user.id, ...input });
  return { json: await automationState(tenantId) };
});

// GitHub connectivity: the token is valid and can see the account the site repos go to. Nothing is created.
route('GET', '/api/v1/site-automation/github-check', async ({ req, tenantId }) => {
  await requireEditor(req, tenantId, 'check the GitHub connection');
  const keys = {
    GITHUB_TOKEN: Boolean(process.env.GITHUB_TOKEN?.trim()),
    GITHUB_SITES_REPO: Boolean(process.env.GITHUB_SITES_REPO?.trim()),
    GITHUB_SITES_BRANCH: Boolean(process.env.GITHUB_SITES_BRANCH?.trim()),
    GITHUB_SITES_OWNER: Boolean(process.env.GITHUB_SITES_OWNER?.trim()),
  };
  const publisher = siteGithubPublisher();
  const check = publisher?.check ? await publisher.check() : null;
  const json: SiteGithubCheckResult = {
    configured: Boolean(publisher),
    keys,
    repo: publisher ? `${publisher.owner}/{siteName}` : null,
    branch: publisher?.branch ?? null,
    private: publisher ? true : null,
    canPush: null,
    canRead: check?.canRead ?? false,
    canWrite: false,
    branchHead: null,
    folderPattern: publisher ? `${publisher.owner}/{siteName}` : '{owner}/{siteName}',
    owner: publisher?.owner ?? null,
    login: check?.login ?? null,
    ownerType: check?.ownerType ?? null,
    error: publisher ? (check?.error ?? null) : 'GITHUB_TOKEN and GITHUB_SITES_OWNER (or GITHUB_SITES_REPO) must be set',
    checkedAt: new Date().toISOString(),
  };
  logger.info('site_github.check', { tenantId, owner: json.owner, canRead: json.canRead, error: json.error });
  return { json };
});

// Cloudflare connectivity: reads the account's workers.dev subdomain and Worker list. Nothing is deployed.
route('GET', '/api/v1/site-automation/deploy-check', async ({ req, tenantId }) => {
  await requireEditor(req, tenantId, 'check the Cloudflare connection');
  const deployer = siteWorkerDeployer();
  const check = deployer?.check ? await deployer.check() : null;
  const json: SiteDeployCheckResult = {
    configured: Boolean(deployer),
    keys: {
      CLOUDFLARE_API_TOKEN: Boolean(process.env.CLOUDFLARE_API_TOKEN?.trim()),
      CLOUDFLARE_ACCOUNT_ID: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID?.trim()),
      R2_ACCOUNT_ID: Boolean(process.env.R2_ACCOUNT_ID?.trim()),
    },
    subdomain: check?.subdomain ?? null,
    urlPattern: check?.subdomain ? `https://{siteName}.${check.subdomain}.workers.dev` : null,
    canRead: check?.canRead ?? false,
    siteWorkers: check?.siteWorkers ?? null,
    totalWorkers: check?.totalWorkers ?? null,
    workerLimit: check?.workerLimit ?? null,
    error: deployer ? (check?.error ?? null) : 'CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (or R2_ACCOUNT_ID) must be set',
    checkedAt: new Date().toISOString(),
  };
  logger.info('site_worker.check', { tenantId, canRead: json.canRead, siteWorkers: json.siteWorkers, error: json.error });
  return { json };
});

/** MonCha internal lead API: connection + GET /slots. Nothing is created. */
async function monchaStatusJson(): Promise<MonchaInternalCheckResult> {
  const client = monchaInternalClient();
  const check = client ? await client.check() : null;
  return {
    configured: Boolean(client),
    keys: {
      MONCHA_INTERNAL_BASE_URL: Boolean(process.env.MONCHA_INTERNAL_BASE_URL?.trim()),
      MONCHA_INTERNAL_KEY: Boolean(process.env.MONCHA_INTERNAL_KEY?.trim()),
    },
    environment: check?.environment ?? null,
    baseUrl: check?.baseUrl ?? null,
    canAuthenticate: check?.canAuthenticate ?? false,
    slots: check?.slots ?? null,
    error: client
      ? (check?.error ?? null)
      : 'MONCHA_INTERNAL_KEY must be set, and MONCHA_INTERNAL_BASE_URL (default UAT) must be an https URL',
    requestId: check?.requestId ?? null,
    checkedAt: new Date().toISOString(),
  };
}

// Cold outreach: draft / preview / gated send (COLD_EMAIL_SENDING_ENABLED + COLD_EMAIL_ALLOWLIST).
const coldEmails = new PrismaColdEmailRepository(prisma);
const coldMailer = createResendMailerFromEnv(process.env);
const coldEmailDeps = {
  coldEmails,
  mailer: coldMailer,
  env: process.env as Record<string, unknown>,
  isAllowed: isColdEmailRecipientAllowed,
  sendingEnabled: coldEmailSendingEnabled,
  parseAllowlist: parseColdEmailAllowlist,
  buildContent: coldEmailContent,
  coldFrom:
    process.env.COLD_EMAIL_FROM?.trim() ||
    (process.env.EMAIL_FROM?.includes('support@jobteacher.pro') ? process.env.EMAIL_FROM.trim() : undefined) ||
    'Moncha <support@jobteacher.pro>',
};

function coldEmailView(row: ColdEmailRecord): ColdEmailView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    leadId: row.leadId,
    companyName: row.companyName,
    toEmail: row.toEmail,
    deliveredTo: row.deliveredTo,
    demoUrl: row.demoUrl,
    subject: row.subject,
    status: row.status,
    resendId: row.resendId,
    error: row.error,
    sentAt: row.sentAt?.toISOString() ?? null,
    origin: row.origin,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const coldEmailAutomation = new PrismaColdEmailAutomationRepository(prisma);

async function coldEmailAutomationView(tenantId: string): Promise<ColdEmailAutomationView> {
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [settings, usedToday, ready] = await Promise.all([
    coldEmailAutomation.get(tenantId),
    coldEmails.countOriginSince(tenantId, 'auto', dayStart),
    coldEmails.listAutoReady(tenantId, COLD_EMAIL_AUTOMATION_MAX_DAILY_CAP),
  ]);
  return {
    enabled: settings.enabled,
    mode: settings.mode,
    dailyCap: settings.dailyCap,
    enabledAt: settings.enabledAt?.toISOString() ?? null,
    updatedBy: settings.updatedBy,
    updatedAt: settings.updatedAt?.toISOString() ?? null,
    usedToday,
    readyNow: ready.length,
  };
}

function coldEmailErrorHttp(error: unknown): never {
  if (error instanceof ColdEmailError) {
    const status =
      error.code === 'not_found'
        ? 404
        : error.code === 'blocked'
          ? 403
          : error.code === 'not_configured'
            ? 503
            : error.code === 'no_demo'
              ? 409
              : 400;
    throw new HttpError(status, error.code, error.message);
  }
  throw error;
}

route('GET', '/api/v1/cold-emails/automation', async ({ req, tenantId }) => {
  await requireEditor(req, tenantId, 'view cold email automation');
  return { json: await coldEmailAutomationView(tenantId) };
});

route('PUT', '/api/v1/cold-emails/automation', async ({ req, tenantId, body }) => {
  const user = await requireEditor(req, tenantId, 'change cold email automation');
  const input = coldEmailAutomationUpdateSchema.parse(await body());
  await coldEmailAutomation.update(tenantId, input, user.email, new Date());
  logger.info('cold_email.automation_updated', { tenantId, by: user.email, ...input });
  return { json: await coldEmailAutomationView(tenantId) };
});

// Approve a draft: sends it to its own company address, or deliverToOverride if provided.
route('POST', '/api/v1/cold-emails/:id/send', async ({ req, tenantId, params, body }) => {
  await requireEditor(req, tenantId, 'send cold emails');
  let deliverToOverride: string | string[] | undefined;
  try {
    const rawBody = await body();
    if (rawBody && typeof rawBody === 'object') {
      const parsed = coldEmailDraftSendSchema.safeParse(rawBody);
      if (parsed.success && parsed.data.deliverToOverride) {
        deliverToOverride = parsed.data.deliverToOverride;
      }
    }
  } catch {
    // Empty body is valid when approving draft to its own address
  }
  try {
    const row = await sendColdEmailDraft(coldEmailDeps, {
      tenantId,
      id: params.id!,
      deliverToOverride,
    });
    logger.info('cold_email.draft_sent', { tenantId, id: row.id, to: row.deliveredTo });
    return { json: coldEmailView(row) };
  } catch (error) {
    coldEmailErrorHttp(error);
  }
});

route('GET', '/api/v1/cold-emails/gate', async ({ req, tenantId }) => {
  await requireEditor(req, tenantId, 'view cold email settings');
  const gate = coldEmailGate(coldEmailDeps);
  const json: ColdEmailGateView = gate;
  return { json };
});

route('GET', '/api/v1/cold-emails', async ({ req, tenantId, url }) => {
  await requireEditor(req, tenantId, 'list cold emails');
  const q = coldEmailListQuerySchema.parse(query(url, 'page', 'pageSize', 'status'));
  const result = await coldEmails.list(tenantId, q);
  const json: ColdEmailPage = {
    items: result.items.map(coldEmailView),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
  };
  return { json };
});

route('GET', '/api/v1/cold-emails/candidates', async ({ req, tenantId, url }) => {
  await requireEditor(req, tenantId, 'list cold email candidates');
  const q = coldEmailCandidatesQuerySchema.parse(query(url, 'page', 'pageSize', 'readyOnly'));
  const result = await coldEmails.listCandidates(tenantId, {
    page: q.page,
    pageSize: q.pageSize,
    readyOnly: q.readyOnly,
  });
  const items: ColdEmailCandidateView[] = result.items.map((c) => ({
    leadId: c.leadId,
    companyId: c.companyId,
    companyName: c.companyName,
    companyEmail: c.companyEmail,
    domain: c.domain,
    demoUrl: c.demoUrl,
    botTrained: c.botTrained,
    lastColdEmail: c.lastColdEmail
      ? {
          id: c.lastColdEmail.id,
          status: c.lastColdEmail.status,
          sentAt: c.lastColdEmail.sentAt?.toISOString() ?? null,
          createdAt: c.lastColdEmail.createdAt.toISOString(),
        }
      : null,
  }));
  const json: ColdEmailCandidatePage = {
    items,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
  };
  return { json };
});

route('POST', '/api/v1/cold-emails/preview', async ({ req, tenantId, body }) => {
  await requireEditor(req, tenantId, 'preview cold emails');
  const input = coldEmailPreviewSchema.parse(await body());
  try {
    const content = previewColdEmail(coldEmailDeps, input);
    const json: ColdEmailPreviewView = content;
    return { json };
  } catch (error) {
    coldEmailErrorHttp(error);
  }
});

route('POST', '/api/v1/cold-emails/draft', async ({ req, tenantId, body }) => {
  await requireEditor(req, tenantId, 'create cold email drafts');
  const input = coldEmailDraftSchema.parse(await body());
  try {
    const content = previewColdEmail(coldEmailDeps, {
      companyName: input.companyName,
      demoUrl: input.demoUrl,
    });
    const row = await createColdEmailDraft(coldEmailDeps, {
      tenantId,
      leadId: input.leadId,
      companyName: input.companyName,
      toEmail: input.toEmail,
      demoUrl: input.demoUrl,
      subject: input.subject ?? content.subject,
    });
    return { status: 201, json: coldEmailView(row) };
  } catch (error) {
    coldEmailErrorHttp(error);
  }
});

route('POST', '/api/v1/cold-emails/send', async ({ req, tenantId, body }) => {
  await requireEditor(req, tenantId, 'send cold emails');
  const input = coldEmailSendSchema.parse(await body());
  try {
    const row = await sendColdEmailNow(coldEmailDeps, {
      tenantId,
      leadId: input.leadId,
      companyName: input.companyName,
      toEmail: input.toEmail ?? (Array.isArray(input.deliverTo) ? input.deliverTo[0]! : input.deliverTo),
      deliverTo: input.deliverTo,
      demoUrl: input.demoUrl,
      note: input.note,
      subject: input.subject,
    });
    logger.info('cold_email.sent', {
      tenantId,
      id: row.id,
      deliverTo: row.deliveredTo,
      intended: row.toEmail,
      status: row.status,
    });
    return { status: 201, json: coldEmailView(row) };
  } catch (error) {
    coldEmailErrorHttp(error);
  }
});

// Console MonCha settings page: any signed-in user can read connection and slots.
route('GET', '/api/v1/moncha', async ({ req, tenantId }) => {
  const token = tokenOf(req);
  if (!token) throw new HttpError(401, 'unauthorized', 'Sign in to view MonCha settings');
  const user = await currentUser(auth, { token });
  if (user.tenantId !== tenantId) throw new HttpError(403, 'forbidden', 'Signed-in user belongs to another tenant');
  const json = await monchaStatusJson();
  logger.info('moncha_internal.status', {
    tenantId,
    environment: json.environment,
    canAuthenticate: json.canAuthenticate,
    error: json.error,
  });
  return { json };
});

// MonCha internal lead API connectivity check (editor session). Same payload as GET /api/v1/moncha.
route('GET', '/api/v1/site-automation/moncha-check', async ({ req, tenantId }) => {
  await requireEditor(req, tenantId, 'check the MonCha internal lead API');
  const json = await monchaStatusJson();
  logger.info('moncha_internal.check', {
    tenantId,
    environment: json.environment,
    canAuthenticate: json.canAuthenticate,
    error: json.error,
    requestId: json.requestId,
  });
  return { json };
});

// MonCha demo bots: one per lead, created (POST /bots) before the lead's website is copied.
const leadBots = new PrismaLeadBotRepository(prisma);

function leadBotView(bot: LeadBotItem): LeadBotView {
  return {
    id: bot.id,
    leadId: bot.leadId,
    company: bot.company,
    environment: bot.environment,
    status: bot.status,
    name: bot.name,
    planTier: bot.planTier,
    attempts: bot.attempts,
    maxAttempts: LEAD_BOT_MAX_ATTEMPTS,
    nextAt: bot.nextAt?.toISOString() ?? null,
    error: bot.error,
    chatbotId: bot.chatbotId,
    monchaTenantId: bot.monchaTenantId,
    connectionId: bot.connectionId,
    config: bot.config,
    createdBotAt: bot.createdBotAt?.toISOString() ?? null,
    knowledge: {
      status: bot.knowledgeStatus,
      attempts: bot.knowledgeAttempts,
      maxAttempts: LEAD_BOT_MAX_ATTEMPTS,
      nextAt: bot.knowledgeNextAt?.toISOString() ?? null,
      websiteUrl: bot.websiteUrl ?? bot.company.websiteUrl,
      discoveredUrls: bot.discoveredUrls,
      pagesFetched: bot.pagesFetched,
      truncated: bot.discoveryTruncated,
      discoveredAt: bot.discoveredAt?.toISOString() ?? null,
      documents: bot.trainingPayload?.documents ?? null,
      trainingKey: bot.trainingKey,
      trainingId: bot.trainingId,
      trainingResult: bot.trainingResult,
      submittedAt: bot.trainingSubmittedAt?.toISOString() ?? null,
      trainedAt: bot.trainedAt?.toISOString() ?? null,
    },
    widget: {
      primaryColor: bot.widgetPrimaryColor,
      configBefore: bot.widgetConfigBefore,
      config: bot.widgetConfig,
      install: bot.installValues,
      configuredAt: bot.widgetConfiguredAt?.toISOString() ?? null,
      domains: bot.domains,
      domainsConfiguredAt: bot.domainsConfiguredAt?.toISOString() ?? null,
    },
    createdAt: bot.createdAt.toISOString(),
    updatedAt: bot.updatedAt.toISOString(),
  };
}

function requireMonchaInternal() {
  const client = monchaInternalClient();
  if (!client) throw new HttpError(503, 'moncha_not_configured', 'Lead bots need MONCHA_INTERNAL_KEY in apps/worker/.env');
  return client;
}

// MonCha settings "Bots": one page of MonCha's GET /bots, each linked to the lead we made it for. Any signed-in user.
route('GET', '/api/v1/moncha/bots', async ({ req, tenantId, url }) => {
  const token = tokenOf(req);
  if (!token) throw new HttpError(401, 'unauthorized', 'Sign in to view MonCha bots');
  const user = await currentUser(auth, { token });
  if (user.tenantId !== tenantId) throw new HttpError(403, 'forbidden', 'Signed-in user belongs to another tenant');
  const q = monchaBotListQuerySchema.parse(query(url, 'cursor', 'limit'));
  const client = requireMonchaInternal();
  let page: MonchaBotList;
  try {
    page = await client.listBots({ cursor: q.cursor, limit: q.limit });
  } catch (error) {
    if (!(error instanceof MonchaInternalError)) throw error;
    // MonCha's own 401/403 must not look like the console session ending.
    throw new HttpError(error.status === 429 ? 503 : 502, error.code, `MonCha GET /bots: ${error.message}`);
  }
  const links = new Map((await leadBots.linksByChatbotIds(tenantId, page.bots.map((b) => b.botId))).map((l) => [l.chatbotId, l]));
  const json: MonchaBotPage = {
    items: page.bots.map((bot): MonchaBotView => {
      const link = links.get(bot.botId);
      return {
        botId: bot.botId,
        name: bot.name,
        planTier: bot.planTier,
        isActive: bot.isActive,
        deactivatedAt: bot.vendorDeactivatedAt,
        live: bot.live,
        createdAt: bot.createdAt,
        limits: bot.limits,
        usage: bot.usage,
        training: bot.training,
        lead: link
          ? {
              leadId: link.leadId,
              company: link.company,
              status: link.status,
              knowledgeStatus: link.knowledgeStatus,
              liveUrl: link.liveUrl,
              chatbotInstalled: link.chatbotInstalled,
            }
          : null,
      };
    }),
    total: page.total,
    nextCursor: page.nextCursor,
    limit: q.limit,
  };
  return { json };
});

route('GET', '/api/v1/lead-bots', async ({ tenantId, url }) => {
  const q = leadBotListQuerySchema.parse(query(url, 'page', 'pageSize', 'status', 'knowledgeStatus'));
  const page = await leadBots.list(tenantId, q);
  const json: LeadBotPage = { ...page, items: page.items.map(leadBotView) };
  return { json };
});

route('GET', '/api/v1/leads/:id/bot', async ({ tenantId, params }) => {
  const bot = await leadBots.getForLead(tenantId, params.id!);
  if (!bot) throw new HttpError(404, 'bot_not_found', 'This lead has no bot yet');
  return { json: leadBotView(bot) };
});

// Creates the lead's bot now (3.1 tier with the most free slots, 3.2 POST /bots). Normally the worker does this
// before it copies the lead's website.
route('POST', '/api/v1/leads/:id/bot', async ({ req, tenantId, params }) => {
  const client = requireMonchaInternal();
  await requireEditor(req, tenantId, 'create lead bots');
  const lead = await leads.get(tenantId, params.id!);
  if (!lead) throw new HttpError(404, 'not_found', 'Lead not found');
  try {
    const { bot, outcome } = await createLeadBotNow({ bots: leadBots, api: client, logger }, { tenantId, leadId: lead.id });
    return { status: outcome?.status === 'created' ? 201 : 200, json: { bot: leadBotView(bot), outcome } };
  } catch (error) {
    if (error instanceof LeadBotRequestError) {
      if (error.code === 'bot_failed') {
        throw new HttpError(409, 'bot_failed', 'Bot creation gave up after 3 tries; POST /api/v1/leads/:id/bot/retry first');
      }
      if (error.code === 'busy') throw new HttpError(409, 'bot_busy', 'The worker is creating this bot right now');
    }
    throw error;
  }
});

// Runs the lead's training step now (7.1 discover + 7.3 ingest-bulk, or one 7.4 status poll while it trains). Normally
// the worker does this before it copies the lead's website.
route('POST', '/api/v1/leads/:id/bot/train', async ({ req, tenantId, params }) => {
  const client = requireMonchaInternal();
  await requireEditor(req, tenantId, 'train lead bots');
  try {
    const { bot, outcome } = await trainLeadBotNow({ bots: leadBots, api: client, logger }, { tenantId, leadId: params.id! });
    return { status: outcome?.status === 'submitted' ? 202 : 200, json: { bot: leadBotView(bot), outcome } };
  } catch (error) {
    if (error instanceof LeadBotRequestError) {
      if (error.code === 'not_found') throw new HttpError(404, 'bot_not_found', 'This lead has no bot yet');
      if (error.code === 'not_created') throw new HttpError(409, 'bot_not_created', 'The bot is not created yet');
      if (error.code === 'training_failed') {
        throw new HttpError(409, 'training_failed', 'Training gave up after 3 tries; POST /api/v1/leads/:id/bot/retry first');
      }
      if (error.code === 'busy') throw new HttpError(409, 'bot_busy', 'The worker is training this bot right now');
    }
    throw error;
  }
});

route('POST', '/api/v1/leads/:id/bot/retry', async ({ req, tenantId, params }) => {
  await requireEditor(req, tenantId, 'retry lead bots');
  try {
    const { bot, copyQueued } = await retryLeadBot({ bots: leadBots, leads, snapshots: siteSnapshots }, { tenantId, leadId: params.id! });
    return { json: { bot: leadBotView(bot), copyQueued } };
  } catch (error) {
    if (error instanceof LeadBotRequestError) {
      if (error.code === 'not_found') throw new HttpError(404, 'bot_not_found', 'This lead has no bot yet');
      if (error.code === 'not_failed') throw new HttpError(409, 'bot_not_failed', 'Only a bot whose creation or training failed can be retried');
    }
    throw error;
  }
});

route('GET', '/api/v1/site-automation/crawls', async ({ tenantId, url }) => {
  const { limit } = siteAutomationCrawlsQuerySchema.parse(query(url, 'limit'));
  const crawls = await siteAutomation.listCrawls(tenantId, limit);
  const items: SiteAutomationCrawl[] = crawls.map((c) => ({
    crawlJobId: c.crawlJobId,
    country: c.country,
    countryCode: c.countryCode,
    trigger: c.trigger,
    crawlStatus: c.crawlStatus,
    status: c.status,
    crawlFinishedAt: c.crawlFinishedAt.toISOString(),
    lastCheckedAt: c.lastCheckedAt.toISOString(),
    completedAt: c.completedAt?.toISOString() ?? null,
    leadsCreated: c.leadsCreated,
    auditsEnqueued: c.auditsEnqueued,
    auditsTotal: c.auditsTotal,
    auditsPending: c.auditsPending,
    qualified: c.qualified,
    queued: c.queued,
    carriedOver: c.carriedOver,
    copies: c.copies,
  }));
  return { json: { items } };
});

route('GET', '/api/v1/site-snapshots/:id', async ({ tenantId, params }) => {
  const snapshot = await getSnapshotOr404(tenantId, params.id!);
  const previewBase = await previewBaseFor(snapshot);
  let manifest: SiteManifest | null = null;
  const store = siteAgentConfig().store;
  if (snapshot.status === 'done' && store) {
    const bytes = await store.getBytes(`${snapshot.storagePrefix}manifest.json`);
    if (bytes) manifest = JSON.parse(Buffer.from(bytes).toString('utf8')) as SiteManifest;
  }
  const summary = siteSummary(snapshot, previewBase);
  const bot = await leadBots.getForLead(tenantId, snapshot.leadId);
  if (summary.deploy && bot) {
    summary.deploy = {
      ...summary.deploy,
      domains: bot.domains,
      domainsConfiguredAt: bot.domainsConfiguredAt?.toISOString() ?? null,
    };
  }
  const json: SiteSnapshotDetail = {
    ...summary,
    brand: snapshot.brand,
    previewBase,
    files: previewBase
      ? {
          index: `${previewBase}index.html`,
          source: `${previewBase}source.html`,
          rendered: `${previewBase}rendered.html`,
          desktop: `${previewBase}screenshot-desktop.png`,
          mobile: `${previewBase}screenshot-mobile.png`,
        }
      : null,
    manifest,
    githubConfigured: Boolean(siteGithubPublisher()),
    githubRepo: snapshot.githubRepo ?? (siteGithubPublisher() ? `${siteGithubPublisher()!.owner}/${siteName(snapshot)}` : null),
    deployConfigured: Boolean(siteWorkerDeployer()),
  };
  return { json };
});

// Pushes a done copy to its own repo now: first push of an older copy, or a retry after a failure.
route('POST', '/api/v1/site-snapshots/:id/github-push', async ({ req, tenantId, params }) => {
  await requireEditor(req, tenantId, 'push website copies to GitHub');
  if (!siteGithubPublisher()) {
    throw new HttpError(503, 'github_not_configured', 'GitHub push needs GITHUB_TOKEN and GITHUB_SITES_OWNER in apps/worker/.env');
  }
  try {
    const result = await requestSiteGithubPush({ snapshots: siteSnapshots }, { tenantId, id: params.id! });
    logger.info('site_github.push_requested', { tenantId, snapshotId: params.id });
    return { status: 202, json: result };
  } catch (error) {
    if (error instanceof SiteGithubRequestError) {
      if (error.code === 'not_found') throw new HttpError(404, 'not_found', 'Website copy not found');
      if (error.code === 'not_done') throw new HttpError(409, 'not_ready', 'Only finished copies can be pushed');
      throw new HttpError(409, 'push_in_progress', 'This copy is being pushed right now');
    }
    throw error;
  }
});

// Deploys a done copy to its website's Worker now: first deploy of an older copy, a retry, or a redeploy.
route('POST', '/api/v1/site-snapshots/:id/deploy', async ({ req, tenantId, params }) => {
  await requireEditor(req, tenantId, 'deploy website copies');
  if (!siteWorkerDeployer()) {
    throw new HttpError(
      503,
      'deploy_not_configured',
      'Worker deploys need CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in apps/worker/.env',
    );
  }
  try {
    const result = await requestSiteWorkerDeploy({ snapshots: siteSnapshots }, { tenantId, id: params.id! });
    logger.info('site_worker.deploy_requested', { tenantId, snapshotId: params.id });
    return { status: 202, json: result };
  } catch (error) {
    if (error instanceof SiteWorkerRequestError) {
      if (error.code === 'not_found') throw new HttpError(404, 'not_found', 'Website copy not found');
      if (error.code === 'not_done') throw new HttpError(409, 'not_ready', 'Only finished copies can be deployed');
      throw new HttpError(409, 'deploy_in_progress', 'This copy is being deployed right now');
    }
    throw error;
  }
});

// Adds the lead's MonCha chatbot to a done copy again (first time, a retry after it failed, or a refresh). The pipeline
// sets the widget colour, adds the embed to index.html, then pushes and redeploys the website.
route('POST', '/api/v1/site-snapshots/:id/chatbot', async ({ req, tenantId, params }) => {
  await requireEditor(req, tenantId, 'add chatbots to website copies');
  requireMonchaInternal();
  try {
    const result = await requestSiteChatbotInstall({ snapshots: siteSnapshots }, { tenantId, id: params.id! });
    logger.info('site_chatbot.install_requested', { tenantId, snapshotId: params.id });
    return { status: 202, json: result };
  } catch (error) {
    if (error instanceof SiteChatbotRequestError) {
      if (error.code === 'not_found') throw new HttpError(404, 'not_found', 'Website copy not found');
      if (error.code === 'not_done') throw new HttpError(409, 'not_ready', 'Only finished copies can get the chatbot');
      throw new HttpError(409, 'chatbot_in_progress', 'The chatbot is being added to this copy right now');
    }
    throw error;
  }
});

// source.html decoded with its detected charset, for the View source tab (bytes are unchanged in R2).
route('GET', '/api/v1/site-snapshots/:id/source', async ({ tenantId, params }) => {
  const { store } = requireSiteAgent();
  const snapshot = await getSnapshotOr404(tenantId, params.id!);
  if (snapshot.status !== 'done') throw new HttpError(409, 'not_ready', 'The website copy is not finished yet');
  const bytes = await store.getBytes(`${snapshot.storagePrefix}source.html`);
  if (!bytes) throw new HttpError(404, 'not_found', 'source.html not found');
  const charset = snapshot.sourceCharset || 'utf-8';
  const truncated = bytes.byteLength > SOURCE_VIEW_MAX_BYTES;
  let text: string;
  try {
    text = new TextDecoder(charset).decode(truncated ? bytes.subarray(0, SOURCE_VIEW_MAX_BYTES) : bytes);
  } catch {
    text = new TextDecoder('utf-8').decode(truncated ? bytes.subarray(0, SOURCE_VIEW_MAX_BYTES) : bytes);
  }
  const json: SiteSnapshotSource = {
    text,
    charset,
    bytes: bytes.byteLength,
    sha256: snapshot.sourceHash ?? '',
    truncated,
  };
  return { json };
});

const PLAIN_TEXT_FILES = new Set(['source.html', 'rendered.html']);

// Token-gated file access for the sandboxed preview iframe (no cookies reach it). The tenant and
// snapshot come only from the signed token; the path is normalized against the snapshot root.
route('GET', '/api/v1/site-files/:token/*path', async ({ url, params }) => {
  const { store, previewSecret } = requireSiteAgent();
  const claims = await verifyPreviewToken(params.token!, previewSecret);
  if (!claims) throw new HttpError(403, 'invalid_token', 'Preview link is invalid or expired');
  const path = normalizeSiteFilePath(params.path!);
  if (!path) throw new HttpError(400, 'invalid_path', 'Invalid file path');
  const object = await store.get(`${siteStoragePrefix(claims.tenantId, claims.snapshotId)}${path}`);
  if (!object) throw new HttpError(404, 'not_found', 'File not found');

  let contentType = object.contentType;
  if (PLAIN_TEXT_FILES.has(path)) {
    const charset = /charset=([^;]+)/i.exec(object.contentType)?.[1]?.trim() || 'utf-8';
    contentType = `text/plain; charset=${charset}`;
  }
  const headers: Record<string, string> = { 'cache-control': 'private, max-age=300' };
  if (url.searchParams.get('download') === '1') {
    headers['content-disposition'] = `attachment; filename="${path.split('/').pop()!.replace(/[^\w.~-]/g, '_')}"`;
  }
  return { raw: { body: object.body, contentType, contentLength: object.contentLength, headers } };
});

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'payload_too_large', 'Body larger than 10 MB'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new HttpError(400, 'validation_error', 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function setCorsHeaders(res: ServerResponse) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD');
  res.setHeader('access-control-allow-headers', 'Content-Type, Authorization, x-tenant-id, x-api-key');
}

function send(res: ServerResponse, status: number, json: unknown) {
  setCorsHeaders(res);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(json, null, 2));
}

/** Streams raw bytes (website-copy files). Fonts and module scripts need CORS from the sandboxed origin. */
async function sendBytes(res: ServerResponse, status: number, raw: RawBody) {
  setCorsHeaders(res);
  res.writeHead(status, {
    'content-type': raw.contentType,
    ...(raw.contentLength !== undefined ? { 'content-length': String(raw.contentLength) } : {}),
    'x-content-type-options': 'nosniff',
    ...raw.headers,
  });
  for await (const chunk of raw.body) {
    if (!res.write(chunk)) await new Promise<void>((resolve) => res.once('drain', () => resolve()));
  }
  res.end();
}

type ZodLikeError = Error & { flatten: () => unknown };
const isZodError = (error: unknown): error is ZodLikeError =>
  error instanceof Error && error.name === 'ZodError' && typeof (error as ZodLikeError).flatten === 'function';

const isCodedError = (error: unknown): error is ScheduleError | AuthError | ReviewError | HttpError | CsvImportError =>
  error instanceof ScheduleError ||
  error instanceof AuthError ||
  error instanceof ReviewError ||
  error instanceof HttpError ||
  error instanceof CsvImportError;

const databaseUnavailable = () =>
  new HttpError(503, 'database_unavailable', 'The database is not responding right now. Try again in a moment.');

function withDeadline<T>(work: Promise<T>, ms: number, path: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      logger.error('worker_api_deadline', { path, ms });
      reject(databaseUnavailable());
    }, ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

function errorStatus(error: unknown): number {
  if (isCodedError(error)) return error.status;
  if (isZodError(error)) return 400;
  return isTransientDbError(error) ? 503 : 500;
}

function sendError(res: ServerResponse, error: unknown) {
  setCorsHeaders(res);
  if (isZodError(error)) {
    return send(res, 400, { error: { code: 'validation_error', message: 'Invalid request', details: error.flatten() } });
  }
  if (isCodedError(error)) {
    return send(res, error.status, { error: { code: error.code, message: error.message } });
  }
  if (isTransientDbError(error)) {
    logger.error('worker_api_db_unavailable', { message: error instanceof Error ? error.message : String(error) });
    const { status, code, message } = databaseUnavailable();
    return send(res, status, { error: { code, message } });
  }
  logger.error('worker_api_error', { message: error instanceof Error ? error.message : String(error) });
  return send(res, 500, { error: { code: 'internal_error', message: 'Internal server error' } });
}

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const started = Date.now();
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const method = req.method || 'GET';
  let status = 500;

  if (method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (API_KEY && req.headers['x-api-key'] !== API_KEY) {
      throw new HttpError(401, 'unauthorized', 'Missing or wrong x-api-key header');
    }
    const tenantHeader = req.headers['x-tenant-id'];
    const tenantId = (Array.isArray(tenantHeader) ? tenantHeader[0] : tenantHeader) || process.env.DEFAULT_TENANT_ID;
    // Website-copy files carry their tenant inside the signed token.
    if (!tenantId && url.pathname !== '/health' && !url.pathname.startsWith('/api/v1/site-files/')) {
      throw new HttpError(400, 'validation_error', 'Send x-tenant-id or set DEFAULT_TENANT_ID');
    }

    const pathMatches = routes.filter((r) => r.pattern.test(url.pathname));
    const match = pathMatches.find((r) => r.method === method);
    if (!match) {
      throw pathMatches.length
        ? new HttpError(405, 'method_not_allowed', `${method} not allowed on ${url.pathname}`)
        : new HttpError(404, 'not_found', `No route for ${method} ${url.pathname}`);
    }
    const params = { ...(url.pathname.match(match.pattern)?.groups ?? {}) };
    const work = match.handler({ req, url, tenantId: tenantId || '', params, body: () => readBody(req) });
    const result = await (method === 'GET' ? withDeadline(work, READ_DEADLINE_MS, url.pathname) : work);
    status = result.status ?? 200;
    if ('raw' in result) await sendBytes(res, status, result.raw);
    else send(res, status, result.json);
  } catch (error) {
    status = errorStatus(error);
    if (res.headersSent) res.destroy(error instanceof Error ? error : undefined);
    else sendError(res, error);
  } finally {
    logger.info('worker_api_request', { method, path: url.pathname, status, ms: Date.now() - started });
  }
}

export function createApiServer(options?: {
  workerStatusProvider?: WorkerStatusProvider;
}) {
  if (options?.workerStatusProvider) {
    setWorkerStatusProvider(options.workerStatusProvider);
  }
  return createServer(handleApiRequest);
}

export function startApiServer(port = PORT, host = HOST) {
  const server = createApiServer();
  server.listen(port, host, () => {
    logger.info('worker_api_started', { url: `http://${host}:${port}`, apiKey: Boolean(API_KEY) });
  });
  return server;
}

if (process.env.DB_ENV && process.env.DB_ENV !== 'dev') {
  logger.info('worker_api_db_env', { dbEnv: process.env.DB_ENV });
}

const isDirectRun = Boolean(
  process.argv[1] &&
    (process.argv[1].endsWith('api.ts') || process.argv[1].endsWith('api.js')),
);

if (isDirectRun) {
  const server = startApiServer();
  const shutdown = () => server.close(() => void prisma.$disconnect().then(() => process.exit(0)));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
