import './env';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { neon } from '@neondatabase/serverless';
import {
  changePasswordSchema,
  countryDiscoverySchema,
  forgotPasswordSchema,
  leadListQuerySchema,
  manualLeadSchema,
  passwordLoginSchema,
  registerSchema,
  resetPasswordSchema,
  scheduleCreateSchema,
  scheduleDeleteCountrySchema,
  scheduleRunsQuerySchema,
  sourceImportSchema,
  updateProfileSchema,
} from '@moncha/contracts';
import {
  prisma,
  PrismaAuthUserRepository,
  PrismaCompanyRepository,
  PrismaDiscoveryScheduleRepository,
  PrismaJobRunRepository,
  PrismaLeadRepository,
  PrismaPasswordResetRepository,
  PrismaSessionRepository,
  PrismaWebsiteRepository,
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
  DEFAULT_AUDIT_CONFIG,
  deleteCountrySchedules,
  deleteSchedule,
  listScheduleRuns,
  listSchedules,
  omitChatbotSitesEnabled,
  resolveCountry,
  ScheduleError,
  supportedCountries,
  websiteAuditDedupeKey,
  type CountryDiscoveryJobPayload,
} from '@moncha/domain';
import { createResendMailerFromEnv } from '@moncha/integrations';
import { CsvImportError, SOURCE_IMPORT_JOB_TYPES, sourceImportView, startCsvImport, type CsvSqlClient } from './csv-import';
import { workerHealth } from './worker-health';

// Local test API for Postman: exposes the same use cases the console routes call.
// Routes other than /api/v1/auth/* need no login: tenant comes from the x-tenant-id header or DEFAULT_TENANT_ID.
// Dev database only.

const PORT = Number(process.env.WORKER_API_PORT || 4000);
const HOST = process.env.WORKER_API_HOST || '127.0.0.1';
const API_KEY = process.env.WORKER_API_KEY || '';
const MAX_BODY_BYTES = 10_000_000;

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
type Result = { status?: number; json: unknown };
type Handler = (ctx: Ctx) => Promise<Result>;

const routes: Array<{ method: string; pattern: RegExp; handler: Handler }> = [];
function route(method: string, path: string, handler: Handler) {
  const pattern = new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`);
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
    await prisma.$queryRaw`SELECT 1`;
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

// Re-audit one lead's website (the worker picks it up).
route('POST', '/api/v1/leads/:id/audit', async ({ tenantId, params }) => {
  const id = params.id!;
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
  if (open) return { status: 202, json: { ...open, deduped: true } };

  const url = `https://${lead.company.domain}`;
  await new PrismaWebsiteRepository(prisma).upsert({ tenantId, companyId: lead.companyId, url, status: 'UNCHECKED' });
  const job = await jobs.create({
    tenantId,
    type: 'website_audit',
    payload: { leadId: id, companyId: lead.companyId, url, force: true },
    dedupeKey: `${websiteAuditDedupeKey(id, DEFAULT_AUDIT_CONFIG.classifierVersion)}:manual:${Date.now()}`,
  });
  return { status: 202, json: { id: job.id, status: job.status } };
});

// Auth: bearer-token sessions.
const auth = { users: new PrismaAuthUserRepository(prisma), sessions: new PrismaSessionRepository(prisma) };
const tokenOf = (req: IncomingMessage) => bearerToken(req.headers.authorization);

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

type ZodLikeError = Error & { flatten: () => unknown };
const isZodError = (error: unknown): error is ZodLikeError =>
  error instanceof Error && error.name === 'ZodError' && typeof (error as ZodLikeError).flatten === 'function';

const isCodedError = (error: unknown): error is ScheduleError | AuthError | HttpError | CsvImportError =>
  error instanceof ScheduleError ||
  error instanceof AuthError ||
  error instanceof HttpError ||
  error instanceof CsvImportError;

function errorStatus(error: unknown): number {
  if (isCodedError(error)) return error.status;
  return isZodError(error) ? 400 : 500;
}

function sendError(res: ServerResponse, error: unknown) {
  setCorsHeaders(res);
  if (isZodError(error)) {
    return send(res, 400, { error: { code: 'validation_error', message: 'Invalid request', details: error.flatten() } });
  }
  if (isCodedError(error)) {
    return send(res, error.status, { error: { code: error.code, message: error.message } });
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
    if (!tenantId && url.pathname !== '/health') {
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
    const result = await match.handler({ req, url, tenantId: tenantId || '', params, body: () => readBody(req) });
    status = result.status ?? 200;
    send(res, status, result.json);
  } catch (error) {
    status = errorStatus(error);
    sendError(res, error);
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
