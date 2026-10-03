import { neon } from '@neondatabase/serverless';
import {
  countryDiscoverySchema,
  leadListQuerySchema,
  manualLeadSchema,
  scheduleCreateSchema,
  scheduleDeleteCountrySchema,
  scheduleRunsQuerySchema,
} from '@moncha/contracts';
import {
  createManualLead,
  createSchedule,
  DEFAULT_AUDIT_CONFIG,
  deleteCountrySchedules,
  deleteSchedule,
  listScheduleRuns,
  listSchedules,
  resolveCountry,
  ScheduleError,
  supportedCountries,
  websiteAuditDedupeKey,
  type CountryDiscoveryJobPayload,
} from '@moncha/domain';
import {
  NeonCompanyRepo,
  NeonDiscoveryScheduleRepo,
  NeonJobRepo,
  NeonLeadRepo,
  NeonWebsiteRepo,
} from './neon-adapter';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

type ZodLikeError = Error & { flatten: () => unknown };
const isZodError = (error: unknown): error is ZodLikeError =>
  error instanceof Error && error.name === 'ZodError' && typeof (error as ZodLikeError).flatten === 'function';

function errorStatus(error: unknown): number {
  if (error instanceof ScheduleError || error instanceof HttpError) return error.status;
  return isZodError(error) ? 400 : 500;
}

function errorResponse(error: unknown, cors: Record<string, string>): Response {
  const status = errorStatus(error);
  let body: unknown;
  if (isZodError(error)) {
    body = { error: { code: 'validation_error', message: 'Invalid request', details: error.flatten() } };
  } else if (error instanceof ScheduleError || error instanceof HttpError) {
    body = { error: { code: error.code, message: error.message } };
  } else {
    body = { error: { code: 'internal_error', message: error instanceof Error ? error.message : String(error) } };
  }
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...cors,
    },
  });
}

function jsonResponse(data: unknown, status = 200, cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...cors,
    },
  });
}

const query = (url: URL, ...keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, url.searchParams.get(k) ?? undefined]));

async function readJson(request: Request): Promise<unknown> {
  const text = (await request.text()).trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'validation_error', 'Invalid JSON body');
  }
}

export async function handleNeonApi(
  request: Request,
  env: { DATABASE_URL?: string; DEFAULT_TENANT_ID?: string; WORKER_API_KEY?: string; [key: string]: unknown },
  cors: Record<string, string>
): Promise<Response | null> {
  const databaseUrl = typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL : '';
  if (!databaseUrl) {
    return jsonResponse(
      { error: { code: 'configuration_error', message: 'DATABASE_URL is not configured in Cloudflare environment' } },
      503,
      cors
    );
  }

  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method;

  // Authentication & tenant resolution
  const apiKey = typeof env.WORKER_API_KEY === 'string' ? env.WORKER_API_KEY : '';
  if (apiKey && request.headers.get('x-api-key') !== apiKey) {
    return errorResponse(new HttpError(401, 'unauthorized', 'Missing or wrong x-api-key header'), cors);
  }

  const tenantHeader = request.headers.get('x-tenant-id');
  const tenantId = tenantHeader || (typeof env.DEFAULT_TENANT_ID === 'string' ? env.DEFAULT_TENANT_ID : 'tenant_moncha_internal');

  if (!tenantId && pathname !== '/health') {
    return errorResponse(new HttpError(400, 'validation_error', 'Send x-tenant-id or set DEFAULT_TENANT_ID'), cors);
  }

  const sql = neon(databaseUrl);

  try {
    // 1. Health check
    if (pathname === '/health' && method === 'GET') {
      let dbStatus = 'up';
      try {
        await sql.query('SELECT 1');
      } catch (error) {
        dbStatus = `down: ${error instanceof Error ? error.message : String(error)}`;
      }
      return jsonResponse(
        {
          ok: dbStatus === 'up',
          db: dbStatus,
          tenantId: tenantId || 'tenant_moncha_internal',
          countries: supportedCountries(),
        },
        dbStatus === 'up' ? 200 : 503,
        cors
      );
    }

    const schedules = new NeonDiscoveryScheduleRepo(sql);
    const jobs = new NeonJobRepo(sql);
    const leads = new NeonLeadRepo(sql);
    const companies = new NeonCompanyRepo(sql);
    const websites = new NeonWebsiteRepo(sql);

    // 2. Schedules
    if (pathname === '/api/v1/schedules') {
      if (method === 'GET') {
        const countries = await listSchedules({ schedules }, { tenantId });
        return jsonResponse({ countries }, 200, cors);
      }
      if (method === 'POST') {
        const body = await readJson(request);
        const input = scheduleCreateSchema.parse(body);
        const result = await createSchedule({ schedules }, { ...input, tenantId });
        return jsonResponse(result, 201, cors);
      }
      if (method === 'DELETE') {
        const { country } = scheduleDeleteCountrySchema.parse(query(url, 'country'));
        const result = await deleteCountrySchedules({ schedules }, { tenantId, country });
        return jsonResponse(result, 200, cors);
      }
    }

    if (pathname === '/api/v1/schedules/runs' && method === 'GET') {
      const { limit } = scheduleRunsQuerySchema.parse(query(url, 'limit'));
      const runs = await listScheduleRuns({ schedules }, { tenantId, limit });
      return jsonResponse({ runs }, 200, cors);
    }

    const scheduleIdMatch = pathname.match(/^\/api\/v1\/schedules\/(?<id>[^/]+)$/);
    if (scheduleIdMatch && method === 'DELETE') {
      const id = scheduleIdMatch.groups?.id!;
      const result = await deleteSchedule({ schedules }, { tenantId, id });
      return jsonResponse(result, 200, cors);
    }

    // 3. Country Discovery Job
    if (pathname === '/api/v1/discovery/country' && method === 'POST') {
      const body = await readJson(request);
      const input = countryDiscoverySchema.parse(body);
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
      return jsonResponse({ id: job.id, status: job.status, type: job.type }, 202, cors);
    }

    // 4. Jobs
    const jobIdMatch = pathname.match(/^\/api\/v1\/jobs\/(?<id>[^/]+)$/);
    if (jobIdMatch && method === 'GET') {
      const id = jobIdMatch.groups?.id!;
      const job = await jobs.get(tenantId, id);
      if (!job) throw new HttpError(404, 'not_found', 'Job not found');
      return jsonResponse(job, 200, cors);
    }

    // 5. Leads
    if (pathname === '/api/v1/leads') {
      if (method === 'GET') {
        const q = leadListQuerySchema.parse(query(url, 'page', 'pageSize', 'search', 'country', 'queue'));
        const result = await leads.list(tenantId, { ...q, omitChatbotSites: false });
        return jsonResponse(result, 200, cors);
      }
      if (method === 'POST') {
        const body = await readJson(request);
        const input = manualLeadSchema.parse(body);
        const result = await createManualLead(
          { companies, leads, websites, jobs },
          { ...input, tenantId }
        );
        return jsonResponse(result, result.duplicate ? 200 : 201, cors);
      }
    }

    if (pathname === '/api/v1/leads/counts' && method === 'GET') {
      const counts = await leads.queueCounts(tenantId);
      return jsonResponse(counts, 200, cors);
    }

    const leadAuditMatch = pathname.match(/^\/api\/v1\/leads\/(?<id>[^/]+)\/audit$/);
    if (leadAuditMatch && method === 'POST') {
      const id = leadAuditMatch.groups?.id!;
      const lead = await leads.get(tenantId, id);
      if (!lead?.company.domain) throw new HttpError(404, 'not_found', 'Lead or its website domain not found');

      // Check open job
      const openRows = await sql.query(
        `SELECT id, status FROM "JobRun"
         WHERE "tenantId" = $1 AND type = 'website_audit' AND status IN ('pending', 'running')
         AND payload->>'leadId' = $2 LIMIT 1`,
        [tenantId, id]
      );
      const open = Array.isArray(openRows) && openRows.length ? (openRows[0] as any) : null;
      if (open) return jsonResponse({ id: open.id, status: open.status, deduped: true }, 202, cors);

      const webUrl = `https://${lead.company.domain}`;
      await websites.upsert({ tenantId, companyId: lead.companyId, url: webUrl, status: 'UNCHECKED' });
      const job = await jobs.create({
        tenantId,
        type: 'website_audit',
        payload: { leadId: id, companyId: lead.companyId, url: webUrl, force: true },
        dedupeKey: `${websiteAuditDedupeKey(id, DEFAULT_AUDIT_CONFIG.classifierVersion)}:manual:${Date.now()}`,
      });
      return jsonResponse({ id: job.id, status: job.status }, 202, cors);
    }

    const leadIdMatch = pathname.match(/^\/api\/v1\/leads\/(?<id>[^/]+)$/);
    if (leadIdMatch && method === 'GET') {
      const id = leadIdMatch.groups?.id!;
      const lead = await leads.get(tenantId, id);
      if (!lead) throw new HttpError(404, 'not_found', 'Lead not found');
      return jsonResponse(lead, 200, cors);
    }

    throw new HttpError(404, 'not_found', `No route for ${method} ${pathname}`);
  } catch (error) {
    return errorResponse(error, cors);
  }
}
