import './env';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { neon } from '@neondatabase/serverless';
import {
  changePasswordSchema,
  countryDiscoverySchema,
  forgotPasswordSchema,
  jobListQuerySchema,
  leadListQuerySchema,
  manualLeadSchema,
  passwordLoginSchema,
  registerSchema,
  resetPasswordSchema,
  resolveReviewSchema,
  reviewListQuerySchema,
  scheduleCreateSchema,
  scheduleDeleteCountrySchema,
  scheduleRunsQuerySchema,
  siteSnapshotListQuerySchema,
  sourceImportSchema,
  updateProfileSchema,
  type SiteManifest,
  type SiteSnapshotDetail,
  type SiteSnapshotQueued,
  type SiteSnapshotSource,
  type SiteSnapshotSummary,
} from '@moncha/contracts';
import {
  isTransientDbError,
  prisma,
  PrismaAuditLogRepository,
  PrismaAuthUserRepository,
  PrismaCompanyRepository,
  PrismaDiscoveryScheduleRepository,
  PrismaJobRunRepository,
  PrismaLeadRepository,
  PrismaPasswordResetRepository,
  PrismaReviewTaskRepository,
  PrismaSessionRepository,
  PrismaSiteSnapshotRepository,
  PrismaWebsiteRepository,
  withDbRetry,
} from '@moncha/db';
import {
  AuthError,
  bearerToken,
  changePassword,
  createConsoleLogger,
  createManualLead,
  createSchedule,
  currentUser,
  loginUser,
  logoutUser,
  registerUser,
  requestPasswordReset,
  resetPassword,
  updateProfile,
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
  queueSiteSnapshot,
  signPreviewToken,
  siteStoragePrefix,
  SiteSnapshotRequestError,
  verifyPreviewToken,
  type CountryDiscoveryJobPayload,
  type SiteSnapshotListItem,
  type SiteSnapshotRecord,
} from '@moncha/domain';
import { createResendMailerFromEnv } from '@moncha/integrations';
import { CsvImportError, SOURCE_IMPORT_JOB_TYPES, sourceImportView, startCsvImport, type CsvSqlClient } from './csv-import';
import { siteAgentConfig } from './site-agent';
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

route('GET', '/api/v1/jobs', async ({ tenantId, url }) => {
  const q = jobListQuerySchema.parse(query(url, 'page', 'pageSize', 'type', 'status'));
  return { json: await jobs.listPage(tenantId, q) };
});

route('GET', '/api/v1/jobs/:id', async ({ tenantId, params }) => {
  const job = await jobs.get(tenantId, params.id!);
  if (!job) throw new HttpError(404, 'not_found', 'Job not found');
  return { json: job };
});

// Leads
route('GET', '/api/v1/leads', async ({ tenantId, url }) => {
  const q = leadListQuerySchema.parse(query(url, 'page', 'pageSize', 'search', 'country', 'queue'));
  // queue=ALL (parsed to undefined) must list every lead, including chatbot sites.
  return { json: await leads.list(tenantId, { ...q, omitChatbotSites: q.queue ? omitChatbotSitesEnabled() : false }) };
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
      payload: { path: ['leadId'], equals: id },
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
    dedupeKey: `${websiteAuditDedupeKey(id, DEFAULT_AUDIT_CONFIG.classifierVersion)}:manual:${Date.now()}`,
  });
  return { id: job.id, status: job.status };
}

// Re-audit one lead's website (the worker picks it up).
route('POST', '/api/v1/leads/:id/audit', async ({ tenantId, params }) => ({
  status: 202,
  json: await queueLeadAudit(tenantId, params.id!),
}));

// Auth: bearer-token sessions.
const auth = { users: new PrismaAuthUserRepository(prisma), sessions: new PrismaSessionRepository(prisma) };
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

route('POST', '/api/v1/auth/register', async ({ tenantId, body }) => {
  const input = registerSchema.parse(await body());
  return { status: 201, json: await registerUser(auth, { ...input, tenantId }) };
});

route('POST', '/api/v1/auth/login', async ({ tenantId, body }) => {
  const input = passwordLoginSchema.parse(await body());
  return { json: await loginUser(auth, { ...input, tenantId }) };
});

route('POST', '/api/v1/auth/logout', async ({ req }) => ({ json: await logoutUser(auth, { token: tokenOf(req) }) }));

route('GET', '/api/v1/auth/me', async ({ req }) => ({ json: { user: await currentUser(auth, { token: tokenOf(req) }) } }));

route('PATCH', '/api/v1/auth/me', async ({ req, body }) => {
  const input = updateProfileSchema.parse(await body());
  return { json: { user: await updateProfile(auth, { ...input, token: tokenOf(req) }) } };
});

route('POST', '/api/v1/auth/change-password', async ({ req, body }) => {
  const input = changePasswordSchema.parse(await body());
  return { json: await changePassword(auth, { ...input, token: tokenOf(req) }) };
});

const resetDeps = () => ({
  ...auth,
  resets: new PrismaPasswordResetRepository(prisma),
  mailer: createResendMailerFromEnv(process.env) ?? undefined,
  logger,
});

route('POST', '/api/v1/auth/forgot-password', async ({ tenantId, body }) => {
  const input = forgotPasswordSchema.parse(await body());
  const resetUrl = process.env.RESET_PASSWORD_URL?.trim() || undefined;
  return { json: await requestPasswordReset(resetDeps(), { ...input, tenantId, resetUrl }) };
});

route('POST', '/api/v1/auth/reset-password', async ({ body }) => {
  const input = resetPasswordSchema.parse(await body());
  return { json: await resetPassword(resetDeps(), input) };
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
const SOURCE_VIEW_MAX_BYTES = 3 * 1024 * 1024;

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
    warnings: snapshot.warnings,
    failureReason: snapshot.failureReason,
    createdAt: snapshot.createdAt.toISOString(),
    finishedAt: snapshot.finishedAt?.toISOString() ?? null,
    ...('company' in snapshot ? { company: snapshot.company } : {}),
    thumbnailPath: previewBase ? `${previewBase}screenshot-desktop.png` : null,
  };
}

async function getSnapshotOr404(tenantId: string, id: string) {
  const snapshot = await siteSnapshots.get(tenantId, id);
  if (!snapshot) throw new HttpError(404, 'not_found', 'Website copy not found');
  return snapshot;
}

// Each run costs crawl time and LLM budget, so it needs a signed-in user who is not a viewer.
route('POST', '/api/v1/leads/:id/site-snapshots', async ({ req, tenantId, params }) => {
  requireSiteAgent();
  const token = tokenOf(req);
  if (!token) throw new HttpError(401, 'unauthorized', 'Sign in to create a website copy');
  const user = await currentUser(auth, { token });
  if (user.tenantId !== tenantId) throw new HttpError(403, 'forbidden', 'Signed-in user belongs to another tenant');
  if (user.role === 'viewer') throw new HttpError(403, 'forbidden', 'Viewers cannot create website copies');
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
  return { json: { items: await Promise.all(items.map(summarize)) } };
});

route('GET', '/api/v1/site-snapshots', async ({ tenantId, url }) => {
  const q = siteSnapshotListQuerySchema.parse(query(url, 'page', 'pageSize', 'status', 'search'));
  const page = await siteSnapshots.list(tenantId, q);
  return { json: { ...page, items: await Promise.all(page.items.map(summarize)) } };
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
  const json: SiteSnapshotDetail = {
    ...siteSummary(snapshot, previewBase),
    brand: snapshot.brand,
    previewBase,
    files: previewBase
      ? {
          index: `${previewBase}index.html`,
          demo: `${previewBase}demo.html`,
          source: `${previewBase}source.html`,
          rendered: `${previewBase}rendered.html`,
          desktop: `${previewBase}screenshot-desktop.png`,
          mobile: `${previewBase}screenshot-mobile.png`,
        }
      : null,
    manifest,
  };
  return { json };
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
