import './env';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  countryDiscoverySchema,
  leadListQuerySchema,
  manualLeadSchema,
  scheduleCreateSchema,
  scheduleDeleteCountrySchema,
  scheduleRunsQuerySchema,
} from '@moncha/contracts';
import {
  prisma,
  PrismaCompanyRepository,
  PrismaDiscoveryScheduleRepository,
  PrismaJobRunRepository,
  PrismaLeadRepository,
  PrismaWebsiteRepository,
} from '@moncha/db';
import {
  createConsoleLogger,
  createManualLead,
  createSchedule,
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

// Local test API for Postman: exposes the same use cases the console routes call.
// No login: tenant comes from the x-tenant-id header or DEFAULT_TENANT_ID. Dev database only.

const PORT = Number(process.env.WORKER_API_PORT || 4000);
const HOST = process.env.WORKER_API_HOST || '127.0.0.1';
const API_KEY = process.env.WORKER_API_KEY || '';
const MAX_BODY_BYTES = 1_000_000;

const logger = createConsoleLogger();
const schedules = new PrismaDiscoveryScheduleRepository(prisma);
const jobs = new PrismaJobRunRepository(prisma);
const leads = new PrismaLeadRepository(prisma);

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

route('GET', '/health', async ({ tenantId }) => {
  await prisma.$queryRaw`SELECT 1`;
  return { json: { ok: true, db: 'up', tenantId, countries: supportedCountries() } };
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
  return { json: await leads.list(tenantId, { ...q, omitChatbotSites: omitChatbotSitesEnabled() }) };
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

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'payload_too_large', 'Body larger than 1 MB'));
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

function send(res: ServerResponse, status: number, json: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(json, null, 2));
}

type ZodLikeError = Error & { flatten: () => unknown };
const isZodError = (error: unknown): error is ZodLikeError =>
  error instanceof Error && error.name === 'ZodError' && typeof (error as ZodLikeError).flatten === 'function';

function errorStatus(error: unknown): number {
  if (error instanceof ScheduleError || error instanceof HttpError) return error.status;
  return isZodError(error) ? 400 : 500;
}

function sendError(res: ServerResponse, error: unknown) {
  if (isZodError(error)) {
    return send(res, 400, { error: { code: 'validation_error', message: 'Invalid request', details: error.flatten() } });
  }
  if (error instanceof ScheduleError || error instanceof HttpError) {
    return send(res, error.status, { error: { code: error.code, message: error.message } });
  }
  logger.error('worker_api_error', { message: error instanceof Error ? error.message : String(error) });
  return send(res, 500, { error: { code: 'internal_error', message: 'Internal server error' } });
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const method = req.method || 'GET';
  let status = 500;
  try {
    if (API_KEY && req.headers['x-api-key'] !== API_KEY) {
      throw new HttpError(401, 'unauthorized', 'Missing or wrong x-api-key header');
    }
    const tenantHeader = req.headers['x-tenant-id'];
    const tenantId = (Array.isArray(tenantHeader) ? tenantHeader[0] : tenantHeader) || process.env.DEFAULT_TENANT_ID;
    if (!tenantId) throw new HttpError(400, 'validation_error', 'Send x-tenant-id or set DEFAULT_TENANT_ID');

    const pathMatches = routes.filter((r) => r.pattern.test(url.pathname));
    const match = pathMatches.find((r) => r.method === method);
    if (!match) {
      throw pathMatches.length
        ? new HttpError(405, 'method_not_allowed', `${method} not allowed on ${url.pathname}`)
        : new HttpError(404, 'not_found', `No route for ${method} ${url.pathname}`);
    }
    const params = { ...(url.pathname.match(match.pattern)?.groups ?? {}) };
    const result = await match.handler({ req, url, tenantId, params, body: () => readBody(req) });
    status = result.status ?? 200;
    send(res, status, result.json);
  } catch (error) {
    status = errorStatus(error);
    sendError(res, error);
  } finally {
    logger.info('worker_api_request', { method, path: url.pathname, status, ms: Date.now() - started });
  }
});

if (process.env.DB_ENV !== 'dev') {
  console.error('Refusing to start: the test API only runs against the dev database (DB_ENV=dev).');
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  logger.info('worker_api_started', { url: `http://${HOST}:${PORT}`, apiKey: Boolean(API_KEY) });
});

const shutdown = () => server.close(() => void prisma.$disconnect().then(() => process.exit(0)));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
