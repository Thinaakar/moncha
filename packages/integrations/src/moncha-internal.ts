import { z } from 'zod';

type Env = Record<string, string | undefined>;

export const MONCHA_INTERNAL_UAT_URL = 'https://api.dev-moncha.com/vendor/internal/v1';
export const MONCHA_INTERNAL_PRODUCTION_URL = 'https://api.moncha.co/vendor/internal/v1';
/** Largest request body the internal API accepts. */
export const MONCHA_INTERNAL_MAX_BODY_BYTES = 11 * 1024 * 1024;

const REQUEST_TIMEOUT_MS = 30_000;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_:.-]{8,200}$/;

export type MonchaInternalEnvironment = 'uat' | 'production' | 'custom';

export type MonchaInternalConfig = {
  /** Environment base URL ending in `/vendor/internal/v1`, without a trailing slash. */
  baseUrl: string;
  /** The secret saved in MonCha Admin. Server-side only. */
  key: string;
};

const slotSchema = z.object({ allocated: z.number(), used: z.number(), available: z.number() });
const slotsSchema = z.object({ data: z.object({ starter: slotSchema, growth: slotSchema, scale: slotSchema }) });

export type MonchaSlot = z.infer<typeof slotSchema>;
export type MonchaSlots = z.infer<typeof slotsSchema>['data'];
export type MonchaPlanTier = keyof MonchaSlots;

const createdBotSchema = z.object({
  data: z.object({
    bot_id: z.string().min(1),
    customer_tenant_id: z.string().min(1),
    connection_id: z.string().nullish(),
    plan_tier: z.string().nullish(),
  }),
});

export type MonchaBotCreateInput = {
  /** 1-30 characters, unique within the MonCha workspace. */
  name: string;
  planTier: MonchaPlanTier;
  /** Defaults to `en`. */
  language?: string;
  /** Stable per logical create; reuse it with the identical body when retrying. */
  idempotencyKey: string;
  signal?: AbortSignal;
};

export type MonchaCreatedBot = {
  botId: string;
  /** The MonCha enterprise workspace (`customer_tenant_id` / `install.tenantId`). */
  tenantId: string;
  connectionId: string | null;
  planTier: string | null;
  /** The whole response body, stored as is. */
  response: unknown;
};

export type MonchaInternalCheck = {
  environment: MonchaInternalEnvironment;
  baseUrl: string;
  /** `GET /slots` succeeded with this key. */
  canAuthenticate: boolean;
  slots: MonchaSlots | null;
  error: string | null;
  requestId: string | null;
};

export class MonchaInternalError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** HTTP status, or null when no response arrived. */
    readonly status: number | null,
    readonly requestId: string | null = null,
    readonly retryAt?: Date,
  ) {
    super(message);
    this.name = 'MonchaInternalError';
  }

  /** Network failures, 429 and 5xx. Auth, validation, ownership and billing errors are not worth repeating unchanged. */
  get retryable(): boolean {
    return this.status === null || this.status === 429 || this.status >= 500;
  }
}

export type MonchaInternalRequest = {
  body?: unknown;
  /** Required by create and ingest operations; reuse the same key and body when retrying. */
  idempotencyKey?: string;
  signal?: AbortSignal;
};

export function monchaInternalEnvironment(baseUrl: string): MonchaInternalEnvironment {
  if (baseUrl === MONCHA_INTERNAL_UAT_URL) return 'uat';
  if (baseUrl === MONCHA_INTERNAL_PRODUCTION_URL) return 'production';
  return 'custom';
}

export function isValidIdempotencyKey(key: string): boolean {
  return IDEMPOTENCY_KEY.test(key);
}

/** `Retry-After` as seconds or an HTTP date. */
export function retryAfterAt(headers: Headers, now = Date.now()): Date | undefined {
  const value = headers.get('retry-after')?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return new Date(now + seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? new Date(date) : undefined;
}

type ErrorBody = {
  error?: unknown;
  success?: unknown;
  request_id?: unknown;
};

/** Error bodies differ: `{error:{code,message}}`, the validator's `{success:false,error}`, or only `error.code`. */
function describeError(status: number, data: unknown): { code: string; message: string; requestId: string | null } {
  const body = (data && typeof data === 'object' ? data : {}) as ErrorBody;
  const error = (body.error && typeof body.error === 'object' ? body.error : {}) as {
    code?: unknown;
    message?: unknown;
    request_id?: unknown;
    issues?: Array<{ message?: unknown; path?: unknown[] }>;
  };
  const requestId = typeof body.request_id === 'string' ? body.request_id : typeof error.request_id === 'string' ? error.request_id : null;
  if (typeof error.code === 'string') {
    return { code: error.code, message: typeof error.message === 'string' ? error.message : error.code, requestId };
  }
  if (body.success === false) {
    const issue = error.issues?.[0];
    const where = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
    return { code: 'validation_failed', message: `${where}${typeof issue?.message === 'string' ? issue.message : 'request failed validation'}`, requestId };
  }
  if (typeof body.error === 'string') return { code: `http_${status}`, message: body.error, requestId };
  return { code: `http_${status}`, message: `MonCha internal API HTTP ${status}`, requestId };
}

const FRIENDLY: Record<string, string> = {
  invalid_internal_credentials:
    'MonCha rejected MONCHA_INTERNAL_KEY: wrong key or environment, the key was replaced, or API - vendor / Internal lead agent is disabled in MonCha Admin',
  vendor_tenant_mismatch: 'The tenant header does not match the workspace of MONCHA_INTERNAL_KEY',
  vendor_subscription_required: 'The MonCha enterprise subscription is not active or outside its current period',
  vendor_disabled: 'API - vendor is disabled for this enterprise in MonCha Admin',
  internal_workspace_unavailable: 'The enterprise workspace is not provisioned for the internal lead agent',
};

/**
 * Client for MonCha's internal lead API (internal-lead-agent.md). Every request carries the Admin secret as a
 * bearer token; the server derives the enterprise workspace from it, so no tenant header is ever sent.
 */
export class MonchaInternalClient {
  readonly baseUrl: string;
  readonly environment: MonchaInternalEnvironment;
  private readonly key: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: MonchaInternalConfig, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = config.baseUrl;
    this.environment = monchaInternalEnvironment(config.baseUrl);
    this.key = config.key;
    this.fetchImpl = fetchImpl;
  }

  private scrub(text: string): string {
    return this.key.length >= 8 ? text.split(this.key).join('***') : text;
  }

  async request<T>(method: string, path: string, options: MonchaInternalRequest = {}): Promise<T> {
    const { body, idempotencyKey, signal } = options;
    if (!path.startsWith('/') || path.includes(':')) {
      throw new MonchaInternalError('invalid_path', `Path must start with / and contain real IDs, not :placeholders (${path})`, null);
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.key}`,
      Accept: 'application/json',
    };
    let payload: string | undefined;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      if (Buffer.byteLength(payload) > MONCHA_INTERNAL_MAX_BODY_BYTES) {
        throw new MonchaInternalError('payload_too_large', 'Request body is over the 11 MiB limit', null);
      }
      headers['Content-Type'] = 'application/json';
    }
    if (idempotencyKey !== undefined) {
      if (!isValidIdempotencyKey(idempotencyKey)) {
        throw new MonchaInternalError(
          'idempotency_key_invalid',
          'Idempotency-Key must be 8-200 characters of letters, digits, underscore, colon, period or hyphen',
          null,
        );
      }
      headers['Idempotency-Key'] = idempotencyKey;
    }

    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: payload,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw new MonchaInternalError('aborted', 'Request was cancelled', null);
      if (timeout.aborted) throw new MonchaInternalError('moncha_timeout', `No response within ${REQUEST_TIMEOUT_MS / 1000}s`, null);
      const message = error instanceof Error ? error.message : String(error);
      throw new MonchaInternalError('moncha_unreachable', this.scrub(message).slice(0, 200), null);
    }

    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (response.ok) return data as T;

    const described = describeError(response.status, data);
    const requestId = described.requestId ?? response.headers.get('x-request-id');
    const message = this.scrub(FRIENDLY[described.code] ?? described.message).slice(0, 300);
    if (response.status === 429) {
      const code = described.code.startsWith('http_') ? 'rate_limit_exceeded' : described.code;
      throw new MonchaInternalError(code, message, 429, requestId, retryAfterAt(response.headers));
    }
    throw new MonchaInternalError(described.code, message, response.status, requestId);
  }

  /** `GET /slots`: bot slots per tier in the enterprise's allocation pool. */
  async slots(signal?: AbortSignal): Promise<MonchaSlots> {
    const data = await this.request<unknown>('GET', '/slots', { signal });
    const parsed = slotsSchema.safeParse(data);
    if (!parsed.success) throw new MonchaInternalError('unexpected_response', 'GET /slots returned an unexpected shape', 200);
    return parsed.data.data;
  }

  /** `POST /bots`: one demo bot in the chosen tier; uses one available slot. */
  async createBot(input: MonchaBotCreateInput): Promise<MonchaCreatedBot> {
    const response = await this.request<unknown>('POST', '/bots', {
      body: { name: input.name, plan_tier: input.planTier, language: input.language ?? 'en' },
      idempotencyKey: input.idempotencyKey,
      signal: input.signal,
    });
    const parsed = createdBotSchema.safeParse(response);
    if (!parsed.success) throw new MonchaInternalError('unexpected_response', 'POST /bots returned no bot_id or customer_tenant_id', 201);
    const { data } = parsed.data;
    return {
      botId: data.bot_id,
      tenantId: data.customer_tenant_id,
      connectionId: data.connection_id ?? null,
      planTier: data.plan_tier ?? null,
      response,
    };
  }

  /** Read-only: proves the key, environment and enterprise prerequisites with `GET /slots`. */
  async check(signal?: AbortSignal): Promise<MonchaInternalCheck> {
    const result: MonchaInternalCheck = {
      environment: this.environment,
      baseUrl: this.baseUrl,
      canAuthenticate: false,
      slots: null,
      error: null,
      requestId: null,
    };
    try {
      result.slots = await this.slots(signal);
      result.canAuthenticate = true;
    } catch (error) {
      if (error instanceof MonchaInternalError) {
        result.error = `${error.code}: ${error.message}`;
        result.requestId = error.requestId;
      } else {
        result.error = this.scrub(String(error)).slice(0, 300);
      }
    }
    return result;
  }
}

/** HTTPS only (plain http just for localhost); the base URL defaults to UAT so production is always a deliberate choice. */
export function monchaInternalConfigFromEnv(env: Env = process.env): MonchaInternalConfig | null {
  const key = env.MONCHA_INTERNAL_KEY?.trim();
  if (!key || /\s/.test(key)) return null;
  const raw = (env.MONCHA_INTERNAL_BASE_URL?.trim() || MONCHA_INTERNAL_UAT_URL).replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
  if (url.search || url.hash || url.username || url.password) return null;
  return { baseUrl: raw, key };
}

/** Returns null when MONCHA_INTERNAL_KEY is missing or MONCHA_INTERNAL_BASE_URL is not a usable URL. */
export function createMonchaInternalClientFromEnv(env: Env = process.env, fetchImpl: typeof fetch = fetch): MonchaInternalClient | null {
  const config = monchaInternalConfigFromEnv(env);
  return config ? new MonchaInternalClient(config, fetchImpl) : null;
}
