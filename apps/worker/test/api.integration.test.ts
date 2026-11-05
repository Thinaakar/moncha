/**
 * Worker API integration tests: the real HTTP server, routes, validation, auth and Prisma, against a throwaway
 * Neon branch. Never the dev or production database.
 *
 *   TEST_DATABASE_HOST=<endpoint host of a temporary branch> pnpm --filter @moncha/worker test
 *
 * TEST_DATABASE_HOST reuses the role and database of apps/worker/.env's DATABASE_URL (a Neon branch inherits them),
 * so no password is passed on the command line. TEST_DATABASE_URL may be given instead. Without either the suite is
 * skipped. Every run uses its own tenant and deletes it at the end. No email is sent: Resend is left unconfigured and
 * development mode stays on.
 */
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// apps/worker/.env would otherwise override DATABASE_URL with the dev database (src/env.ts loads it with override).
vi.mock('../src/env', () => ({}));

function workerEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  let text = '';
  try {
    text = readFileSync(resolve(__dirname, '../.env'), 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]!] = m[2]!.trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const hostOf = (url: string) => /@([^/:?]+)/.exec(url)?.[1]?.toLowerCase() ?? '';
const endpointOf = (host: string) => host.split('.')[0]!.replace(/-pooler$/, '');

/** The test database URL, refusing the dev and production databases. */
function testDatabaseUrl(): string | null {
  const env = workerEnv();
  let url = process.env.TEST_DATABASE_URL?.trim() || null;
  const host = process.env.TEST_DATABASE_HOST?.trim();
  if (!url && host) {
    if (!env.DATABASE_URL) throw new Error('TEST_DATABASE_HOST needs apps/worker/.env DATABASE_URL for the role and database');
    url = env.DATABASE_URL.replace(/@[^/:?]+/, `@${host}`);
  }
  if (!url) return null;
  const testEndpoint = endpointOf(hostOf(url));
  const forbidden = [env.DATABASE_URL, env.DIRECT_URL, env.DATABASE_URL_UNPOOLED]
    .filter(Boolean)
    .map((u) => endpointOf(hostOf(u!)));
  const prod = env.PROD_DB_HOST?.trim().toLowerCase();
  if (!testEndpoint || forbidden.includes(testEndpoint) || (prod && hostOf(url).includes(prod))) {
    throw new Error('Refusing to run API integration tests against the dev or production database');
  }
  return url;
}

const databaseUrl = testDatabaseUrl();
const tenantId = `itest_${Date.now().toString(36)}`;
const EDITOR = 'editor@itest.local';
const VIEWER = 'viewer@itest.local';

let server: Server;
let base = '';
let editorToken = '';
let viewerToken = '';
let prisma: typeof import('@moncha/db').prisma;

type Res = { status: number; json: any };

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<Res> {
  const res = await fetch(`${base}/api/v1/${path}`, {
    method,
    headers: {
      'x-tenant-id': tenantId,
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function login(email: string): Promise<string> {
  const res = await call('POST', 'auth/login', { body: { email, password: process.env.MONCHA_LEAD_ADMIN_PASSWORD } });
  expect(res.status).toBe(200);
  return res.json.token as string;
}

describe.skipIf(!databaseUrl)('worker API (integration)', () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: databaseUrl!,
      DB_ENV: 'dev',
      DEFAULT_TENANT_ID: tenantId,
      MONCHA_LEAD_ADMIN_USERS: `${EDITOR},${VIEWER}`,
      MONCHA_LEAD_ADMIN_PASSWORD: `itest-${Math.random().toString(36).slice(2)}`,
      WORKER_API_KEY: '',
      RESEND_API_KEY: '',
      COLD_EMAIL_DEV_MODE: 'true',
      COLD_EMAIL_SENDING_ENABLED: 'false',
      COLD_EMAIL_ALLOWLIST: '',
      LOG_LEVEL: 'error',
    });
    prisma = (await import('@moncha/db')).prisma;
    await prisma.tenant.create({ data: { id: tenantId, name: 'API integration test' } });

    const { createApiServer } = await import('../src/api');
    server = createApiServer();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    editorToken = await login(EDITOR);
    viewerToken = await login(VIEWER);
    await prisma.user.updateMany({ where: { tenantId, email: VIEWER }, data: { role: 'viewer' } });
  }, 120_000);

  afterAll(async () => {
    if (server) await new Promise<void>((done) => server.close(() => done()));
    if (prisma) {
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
      await prisma.$disconnect();
    }
  }, 60_000);

  describe('crawl settings', () => {
    it('returns defaults and today counters for a new tenant', async () => {
      const res = await call('GET', 'crawl-settings', { token: editorToken });
      expect(res.status).toBe(200);
      expect(res.json.settings).toMatchObject({ active: false, crawlBatchSize: 20, maxPagesPerSearch: 3, targetCountry: 'SG' });
      expect(res.json.progress).toMatchObject({
        websitesCrawledToday: 0,
        duplicatesFilteredToday: 0,
        crawlsRunToday: 0,
        followUpsDueToday: 0,
        followUpsOverdue: 0,
        followUpsSentToday: 0,
      });
    });

    it('only lets editors save', async () => {
      expect((await call('PUT', 'crawl-settings', { body: { crawlBatchSize: 30 } })).status).toBe(401);
      const viewer = await call('PUT', 'crawl-settings', { token: viewerToken, body: { crawlBatchSize: 30 } });
      expect(viewer.status).toBe(403);
    });

    it.each([
      ['crawlBatchSize', 501],
      ['crawlBatchSize', 0],
      ['maxPagesPerSearch', 4],
      ['dailyWebsiteCreationLimit', 501],
      ['dailyCustomerReachLimit', -1],
      ['minQueueBuffer', 1001],
      ['maxDailyCrawlRuns', 101],
      ['followUpDelayDays', 0],
      ['followUpDelayDays', 31],
      ['followUpPreferredHour', 24],
    ])('rejects %s = %s', async (field, value) => {
      const res = await call('PUT', 'crawl-settings', { token: editorToken, body: { [field]: value } });
      expect(res.status).toBe(400);
      expect(res.json.error.code).toBe('validation_error');
    });

    it('rejects cities that are not in the target country, also on a cities-only update', async () => {
      const mixed = await call('PUT', 'crawl-settings', { token: editorToken, body: { targetCountry: 'MY', targetCities: ['Tampines'] } });
      expect(mixed.status).toBe(400);
      expect(mixed.json.error.message).toContain('not a search area in Malaysia');

      const citiesOnly = await call('PUT', 'crawl-settings', { token: editorToken, body: { targetCities: ['Kuala Lumpur'] } });
      expect(citiesOnly.status).toBe(400);
      expect(citiesOnly.json.error.message).toContain('not a search area in Singapore');
    });

    it('persists a valid save and returns it after a reload', async () => {
      const body = {
        targetCountry: 'MY',
        targetCities: ['Kuala Lumpur'],
        crawlBatchSize: 45,
        maxPagesPerSearch: 2,
        dailyWebsiteCreationLimit: 7,
        followUpDelayDays: 5,
        followUpPreferredHour: 9,
      };
      const saved = await call('PUT', 'crawl-settings', { token: editorToken, body });
      expect(saved.status).toBe(200);
      expect(saved.json.settings).toMatchObject({ ...body, updatedBy: EDITOR });

      const reloaded = await call('GET', 'crawl-settings', { token: editorToken });
      expect(reloaded.json.settings).toMatchObject(body);
    });

    it('starts a manual crawl with the saved settings only', async () => {
      const res = await call('POST', 'crawl-settings/trigger', { token: editorToken, body: {} });
      expect(res.status).toBe(202);
      expect(res.json).toMatchObject({ batchSize: 45, countryCode: 'MY' });
      const job = await prisma.jobRun.findFirst({ where: { tenantId, id: res.json.id } });
      expect(job?.payload).toMatchObject({ countryCode: 'MY', cities: ['Kuala Lumpur'], maxSearches: 3, maxPages: 2 });

      const tooBig = await call('POST', 'crawl-settings/trigger', { token: editorToken, body: { batchSize: 501 } });
      expect(tooBig.status).toBe(400);
      expect((await call('POST', 'crawl-settings/trigger', { token: viewerToken, body: {} })).status).toBe(403);
    });

    it('switches the engine on its own and reflects it in the copy automation state', async () => {
      const on = await call('PUT', 'crawl-settings', { token: editorToken, body: { active: true } });
      expect(on.json.settings).toMatchObject({ active: true, crawlBatchSize: 45 });
      const copies = await call('GET', 'site-automation', { token: editorToken });
      expect(copies.json).toMatchObject({ enabled: true, dailyCap: 7, controlledBy: 'crawl_settings' });
      await call('PUT', 'crawl-settings', { token: editorToken, body: { active: false } });
    });
  });

  describe('automation managed by the crawl settings', () => {
    it('refuses the old copy and cold email automation switches', async () => {
      const copies = await call('PUT', 'site-automation', { token: editorToken, body: { enabled: true } });
      expect(copies.status).toBe(409);
      expect(copies.json.error.code).toBe('managed_by_crawl_settings');

      const outreach = await call('PUT', 'cold-emails/automation', { token: editorToken, body: { enabled: true } });
      expect(outreach.status).toBe(409);

      const view = await call('GET', 'cold-emails/automation', { token: editorToken });
      expect(view.json).toMatchObject({ enabled: false, mode: 'send', controlledBy: 'crawl_settings' });
    });

    it('reports development mode through the email gate', async () => {
      const res = await call('GET', 'cold-emails/gate', { token: editorToken });
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ isDevMode: true, resendConfigured: false });
      expect((await call('GET', 'cold-emails/gate', { token: viewerToken })).status).toBe(403);
    });
  });

  describe('schedules', () => {
    it('only lets editors add and delete schedules', async () => {
      const body = { country: 'Japan', time: '09:30', timezone: 'Asia/Tokyo' };
      expect((await call('POST', 'schedules', { body })).status).toBe(401);
      expect((await call('POST', 'schedules', { token: viewerToken, body })).status).toBe(403);

      const created = await call('POST', 'schedules', { token: editorToken, body });
      expect(created.status).toBe(201);
      expect(created.json).toMatchObject({ countryCode: 'JP', time: '09:30' });

      expect((await call('DELETE', `schedules/${created.json.id}`)).status).toBe(401);
      expect((await call('DELETE', `schedules/${created.json.id}`, { token: viewerToken })).status).toBe(403);
      expect((await call('DELETE', 'schedules?country=JP', { token: viewerToken })).status).toBe(403);
      expect((await call('DELETE', `schedules/${created.json.id}`, { token: editorToken })).status).toBe(200);
    });
  });

  it('exposes each country time zone in the discovery options', async () => {
    const res = await call('GET', 'discovery/options', { token: editorToken });
    const zones = Object.fromEntries(res.json.countries.map((c: { code: string; timezone: string }) => [c.code, c.timezone]));
    expect(zones).toMatchObject({ SG: 'Asia/Singapore', MY: 'Asia/Kuala_Lumpur', JP: 'Asia/Tokyo' });
  });
});
