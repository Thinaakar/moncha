import { describe, expect, it } from 'vitest';
import {
  createMonchaInternalClientFromEnv,
  isValidIdempotencyKey,
  MONCHA_INTERNAL_PRODUCTION_URL,
  MONCHA_INTERNAL_UAT_URL,
  MonchaInternalClient,
  MonchaInternalError,
  monchaInternalConfigFromEnv,
  retryAfterAt,
} from './moncha-internal';

const KEY = 'test-internal-key-123456';
const SLOTS = {
  starter: { allocated: 20, used: 3, available: 17 },
  growth: { allocated: 5, used: 1, available: 4 },
  scale: { allocated: 0, used: 0, available: 0 },
};

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function client(respond: (call: Call) => Response) {
  const fake = fakeFetch(respond);
  return { ...fake, api: new MonchaInternalClient({ baseUrl: MONCHA_INTERNAL_UAT_URL, key: KEY }, fake.fetchImpl) };
}

async function caught(promise: Promise<unknown>): Promise<MonchaInternalError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MonchaInternalError) return error;
    throw error;
  }
  throw new Error('expected a MonchaInternalError');
}

describe('monchaInternalConfigFromEnv', () => {
  it('needs the key and defaults the base URL to UAT', () => {
    expect(monchaInternalConfigFromEnv({})).toBeNull();
    expect(monchaInternalConfigFromEnv({ MONCHA_INTERNAL_KEY: '  ' })).toBeNull();
    expect(monchaInternalConfigFromEnv({ MONCHA_INTERNAL_KEY: KEY })).toEqual({ baseUrl: MONCHA_INTERNAL_UAT_URL, key: KEY });
  });

  it('uses production only when set explicitly and drops trailing slashes', () => {
    const config = monchaInternalConfigFromEnv({ MONCHA_INTERNAL_KEY: KEY, MONCHA_INTERNAL_BASE_URL: `${MONCHA_INTERNAL_PRODUCTION_URL}/` });
    expect(config?.baseUrl).toBe(MONCHA_INTERNAL_PRODUCTION_URL);
    expect(createMonchaInternalClientFromEnv({ MONCHA_INTERNAL_KEY: KEY, MONCHA_INTERNAL_BASE_URL: MONCHA_INTERNAL_PRODUCTION_URL })?.environment).toBe(
      'production',
    );
  });

  it('rejects unsafe base URLs and keys', () => {
    expect(monchaInternalConfigFromEnv({ MONCHA_INTERNAL_KEY: KEY, MONCHA_INTERNAL_BASE_URL: 'http://api.moncha.co/vendor/internal/v1' })).toBeNull();
    expect(monchaInternalConfigFromEnv({ MONCHA_INTERNAL_KEY: KEY, MONCHA_INTERNAL_BASE_URL: 'not a url' })).toBeNull();
    expect(monchaInternalConfigFromEnv({ MONCHA_INTERNAL_KEY: KEY, MONCHA_INTERNAL_BASE_URL: 'https://x.test/v1?key=1' })).toBeNull();
    expect(monchaInternalConfigFromEnv({ MONCHA_INTERNAL_KEY: 'two words' })).toBeNull();
    expect(monchaInternalConfigFromEnv({ MONCHA_INTERNAL_KEY: KEY, MONCHA_INTERNAL_BASE_URL: 'http://localhost:8787/vendor/internal/v1' })?.baseUrl).toBe(
      'http://localhost:8787/vendor/internal/v1',
    );
  });
});

describe('MonchaInternalClient requests', () => {
  it('sends the bearer key and Accept, and never a tenant header', async () => {
    const { api, calls } = client(() => json({ data: SLOTS }));
    expect(await api.slots()).toEqual(SLOTS);
    expect(calls[0]!.url).toBe(`${MONCHA_INTERNAL_UAT_URL}/slots`);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers).toEqual({ Authorization: `Bearer ${KEY}`, Accept: 'application/json' });
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it('adds Content-Type with a JSON body and Idempotency-Key when given', async () => {
    const { api, calls } = client(() => json({ data: {} }, 201));
    await api.request('POST', '/bots', { body: { name: 'Acme Demo L123', plan_tier: 'starter' }, idempotencyKey: 'lead-123-create-v1' });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Idempotency-Key']).toBe('lead-123-create-v1');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ name: 'Acme Demo L123', plan_tier: 'starter' });
  });

  it('rejects bad idempotency keys, placeholder paths and oversized bodies before sending', async () => {
    const { api, calls } = client(() => json({}));
    expect((await caught(api.request('POST', '/bots', { body: {}, idempotencyKey: 'short' }))).code).toBe('idempotency_key_invalid');
    expect((await caught(api.request('POST', '/bots', { body: {}, idempotencyKey: 'lead 123 create' }))).code).toBe('idempotency_key_invalid');
    expect((await caught(api.request('GET', '/bots/:botId'))).code).toBe('invalid_path');
    const big = 'x'.repeat(11 * 1024 * 1024);
    expect((await caught(api.request('POST', '/bots', { body: { big } }))).code).toBe('payload_too_large');
    expect(calls).toHaveLength(0);
  });

  it('accepts the documented idempotency key characters and lengths', () => {
    expect(isValidIdempotencyKey('lead-123-bot-abc-ingest-batch-01-v1')).toBe(true);
    expect(isValidIdempotencyKey('a_b:c.d-e')).toBe(true);
    expect(isValidIdempotencyKey('x'.repeat(200))).toBe(true);
    expect(isValidIdempotencyKey('x'.repeat(201))).toBe(false);
    expect(isValidIdempotencyKey('1234567')).toBe(false);
  });
});

describe('MonchaInternalClient errors', () => {
  it('maps invalid credentials to a clear, non-retryable error with the request id', async () => {
    const { api } = client(() =>
      json({ error: { code: 'invalid_internal_credentials', message: 'invalid credentials' }, request_id: 'req-1' }, 401),
    );
    const error = await caught(api.slots());
    expect(error.code).toBe('invalid_internal_credentials');
    expect(error.status).toBe(401);
    expect(error.requestId).toBe('req-1');
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/Internal lead agent/);
  });

  it('reads Retry-After on 429', async () => {
    const { api } = client(() => json({ error: { code: 'rate_limit_exceeded' } }, 429, { 'retry-after': '30' }));
    const before = Date.now();
    const error = await caught(api.slots());
    expect(error.code).toBe('rate_limit_exceeded');
    expect(error.retryable).toBe(true);
    expect(error.retryAt!.getTime()).toBeGreaterThanOrEqual(before + 30_000);
  });

  it('handles the validator shape and bodies with only a code', async () => {
    const validation = client(() => json({ success: false, error: { issues: [{ message: 'Too long', path: ['name'] }] } }, 400));
    const error = await caught(validation.api.request('POST', '/bots', { body: {}, idempotencyKey: 'lead-123-create-v1' }));
    expect(error.code).toBe('validation_failed');
    expect(error.message).toBe('name: Too long');

    const onlyCode = client(() => json({ error: { code: 'payload_too_large' } }, 413));
    expect((await caught(onlyCode.api.slots())).code).toBe('payload_too_large');

    const empty = client(() => new Response('', { status: 503 }));
    const unavailable = await caught(empty.api.slots());
    expect(unavailable.code).toBe('http_503');
    expect(unavailable.retryable).toBe(true);
  });

  it('never puts the key in an error message', async () => {
    const { api } = client(() => json({ error: { code: 'request_failed', message: `bad token ${KEY}` } }, 500));
    const error = await caught(api.slots());
    expect(error.message).not.toContain(KEY);
    expect(error.message).toContain('***');

    const offline = new MonchaInternalClient({ baseUrl: MONCHA_INTERNAL_UAT_URL, key: KEY }, (async () => {
      throw new Error(`connect failed for ${KEY}`);
    }) as unknown as typeof fetch);
    const unreachable = await caught(offline.slots());
    expect(unreachable.code).toBe('moncha_unreachable');
    expect(unreachable.message).not.toContain(KEY);
  });

  it('flags an unexpected /slots shape', async () => {
    const { api } = client(() => json({ data: { starter: 1 } }));
    expect((await caught(api.slots())).code).toBe('unexpected_response');
  });

  it('parses Retry-After as seconds or a date', () => {
    const now = Date.UTC(2026, 9, 15, 6, 0, 0);
    expect(retryAfterAt(new Headers({ 'retry-after': '5' }), now)?.getTime()).toBe(now + 5000);
    expect(retryAfterAt(new Headers({ 'retry-after': 'Thu, 15 Oct 2026 06:01:00 GMT' }), now)?.getTime()).toBe(now + 60_000);
    expect(retryAfterAt(new Headers(), now)).toBeUndefined();
  });
});

describe('MonchaInternalClient.createBot', () => {
  const created = {
    data: {
      bot_id: '11111111-1111-4111-8111-111111111111',
      customer_tenant_id: '22222222-2222-4222-8222-222222222222',
      connection_id: '33333333-3333-4333-8333-333333333333',
      plan_tier: 'starter',
      funding: 'vendor',
      install: { tenantId: '22222222-2222-4222-8222-222222222222', chatbotId: '11111111-1111-4111-8111-111111111111' },
    },
  };

  it('posts name, tier and language with the idempotency key and returns the IDs and full response', async () => {
    const { api, calls } = client(() => json(created, 201));
    const bot = await api.createBot({ name: 'Acme Dental', planTier: 'starter', idempotencyKey: 'lead-abc-bot-v1' });
    expect(calls[0]!.url).toBe(`${MONCHA_INTERNAL_UAT_URL}/bots`);
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ name: 'Acme Dental', plan_tier: 'starter', language: 'en' });
    expect((calls[0]!.init.headers as Record<string, string>)['Idempotency-Key']).toBe('lead-abc-bot-v1');
    expect(bot).toEqual({
      botId: created.data.bot_id,
      tenantId: created.data.customer_tenant_id,
      connectionId: created.data.connection_id,
      planTier: 'starter',
      response: created,
    });
  });

  it('flags a response without IDs and passes MonCha errors through', async () => {
    const empty = client(() => json({ data: {} }, 201));
    expect((await caught(empty.api.createBot({ name: 'A', planTier: 'growth', idempotencyKey: 'lead-abc-bot-v1' }))).code).toBe(
      'unexpected_response',
    );
    const taken = client(() => json({ error: { code: 'bot_name_taken', message: 'name taken' } }, 409));
    const error = await caught(taken.api.createBot({ name: 'A', planTier: 'scale', idempotencyKey: 'lead-abc-bot-v1' }));
    expect(error.code).toBe('bot_name_taken');
    expect(error.status).toBe(409);
  });
});

describe('MonchaInternalClient.check', () => {
  it('reports slots when the key works', async () => {
    const { api } = client(() => json({ data: SLOTS }));
    expect(await api.check()).toEqual({
      environment: 'uat',
      baseUrl: MONCHA_INTERNAL_UAT_URL,
      canAuthenticate: true,
      slots: SLOTS,
      error: null,
      requestId: null,
    });
  });

  it('reports the error code when it does not', async () => {
    const { api } = client(() => json({ error: { code: 'vendor_subscription_required', message: 'x' }, request_id: 'req-9' }, 402));
    const result = await api.check();
    expect(result.canAuthenticate).toBe(false);
    expect(result.slots).toBeNull();
    expect(result.error).toMatch(/^vendor_subscription_required: /);
    expect(result.requestId).toBe('req-9');
  });
});
