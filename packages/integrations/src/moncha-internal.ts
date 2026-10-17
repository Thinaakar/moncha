import { z } from 'zod';

type Env = Record<string, string | undefined>;

export const MONCHA_INTERNAL_UAT_URL = 'https://api.dev-moncha.com/vendor/internal/v1';
export const MONCHA_INTERNAL_PRODUCTION_URL = 'https://api.moncha.co/vendor/internal/v1';
/** Largest request body the internal API accepts. */
export const MONCHA_INTERNAL_MAX_BODY_BYTES = 11 * 1024 * 1024;

const REQUEST_TIMEOUT_MS = 30_000;
/** Discovery crawls the website (up to 100 pages) before it answers. */
const DISCOVER_TIMEOUT_MS = 180_000;
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

/** Discover answers with the fields at the top level; ingest wraps them in `data`. Both shapes are accepted. */
function unwrap(body: unknown): unknown {
  if (body && typeof body === 'object' && 'data' in body && (body as { data: unknown }).data && typeof (body as { data: unknown }).data === 'object') {
    return (body as { data: unknown }).data;
  }
  return body;
}

const discoverSchema = z.object({
  urls: z.array(z.string()),
  pagesFetched: z.number().nullish(),
  pages_fetched: z.number().nullish(),
  truncated: z.boolean().nullish(),
});

const ingestSchema = z.object({
  training_id: z.string().min(1),
  status: z.string().nullish(),
  total: z.number().nullish(),
});

const trainingSchema = z.object({
  training_id: z.string().nullish(),
  status: z.string(),
  total: z.number().nullish(),
  ready: z.number().nullish(),
  failed: z.number().nullish(),
  poll_after_seconds: z.number().nullish(),
});

const widgetSchema = z.object({ config: z.record(z.string(), z.unknown()) });

const installSchema = z.object({
  tenantId: z.string().min(1),
  chatbotId: z.string().min(1),
  apiUrl: z.string().min(1),
  widgetUrl: z.string().nullish(),
});

const domainsSchema = z.object({
  domains: z.array(z.string()),
});

const botSummarySchema = z.object({
  bot_id: z.string().min(1),
  name: z.string(),
  plan_tier: z.string().nullish(),
  is_active: z.boolean().nullish(),
  vendor_deactivated_at: z.string().nullish(),
  live: z.boolean().nullish(),
  created_at: z.string().nullish(),
  limits: z
    .object({ message_limit: z.number().nullish(), pages_limit: z.number().nullish(), voice_minutes_limit: z.number().nullish() })
    .nullish(),
  usage: z.object({ messages: z.number().nullish(), voice_minutes: z.number().nullish(), pages: z.number().nullish() }).nullish(),
  training: z.object({ pending: z.number().nullish(), failed: z.number().nullish() }).nullish(),
});

const botListSchema = z.object({
  data: z.array(botSummarySchema),
  total: z.number().nullish(),
  next_cursor: z.string().nullish(),
});

/** Largest `limit` GET /bots accepts (default 50). */
export const MONCHA_BOT_LIST_MAX = 100;

/**
 * One bot of GET /bots. `limits` are the plan-tier quotas (-1 = unlimited); `usage` messages and voice minutes cover
 * the current monthly window, pages are all trained pages.
 */
export type MonchaBotSummary = {
  botId: string;
  name: string;
  planTier: string | null;
  isActive: boolean;
  vendorDeactivatedAt: string | null;
  /** Holds a plan slot and is not paused (deactivate makes it false). */
  live: boolean;
  createdAt: string | null;
  limits: { messages: number | null; pages: number | null; voiceMinutes: number | null };
  usage: { messages: number; pages: number; voiceMinutes: number };
  /** Knowledge documents queued or processing / failed. */
  training: { pending: number; failed: number };
};

/** GET /bots: one page, ordered by bot id; pass `nextCursor` back as `cursor` for the next page. */
export type MonchaBotList = { bots: MonchaBotSummary[]; total: number | null; nextCursor: string | null };

/** Widget configuration as GET/PUT /bots/:botId/widget return it (saved values merged with defaults). */
export type MonchaWidgetConfig = Record<string, unknown>;

export type MonchaWidget = { config: MonchaWidgetConfig; response: unknown };

/** GET /bots/:botId/install: the public values the embed needs. `widgetUrl` is null until MonCha configures it. */
export type MonchaInstall = { tenantId: string; chatbotId: string; apiUrl: string; widgetUrl: string | null; response: unknown };

/** GET/PUT /bots/:botId/domains: hostnames where the widget is allowed to run. */
export type MonchaDomains = { domains: string[]; response: unknown };

export type MonchaKnowledgeDocument = { title: string; url: string; source_type: 'url' };

export type MonchaDiscovered = { urls: string[]; pagesFetched: number | null; truncated: boolean; response: unknown };

export type MonchaTrainingQueued = { trainingId: string; status: string | null; total: number | null; response: unknown };

export type MonchaTraining = {
  /** processing, completed, partial_failure or failed. */
  status: string;
  total: number | null;
  ready: number | null;
  failed: number | null;
  pollAfterSeconds: number | null;
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
  /** Defaults to 30 seconds. */
  timeoutMs?: number;
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
    const { body, idempotencyKey, signal, timeoutMs = REQUEST_TIMEOUT_MS } = options;
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

    const timeout = AbortSignal.timeout(timeoutMs);
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
      if (timeout.aborted) throw new MonchaInternalError('moncha_timeout', `No response within ${timeoutMs / 1000}s`, null);
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

  /** `GET /bots`: the enterprise's demo bots, `limit` (1-100, default 50) per page after `cursor` (a bot id). */
  async listBots(input: { cursor?: string; limit?: number; signal?: AbortSignal } = {}): Promise<MonchaBotList> {
    const params = new URLSearchParams();
    if (input.cursor) params.set('cursor', input.cursor);
    if (input.limit !== undefined) params.set('limit', String(Math.min(MONCHA_BOT_LIST_MAX, Math.max(1, Math.trunc(input.limit)))));
    const query = params.toString();
    const data = await this.request<unknown>('GET', `/bots${query ? `?${query}` : ''}`, { signal: input.signal });
    const parsed = botListSchema.safeParse(data);
    if (!parsed.success) throw new MonchaInternalError('unexpected_response', 'GET /bots returned an unexpected shape', 200);
    return {
      bots: parsed.data.data.map((b) => ({
        botId: b.bot_id,
        name: b.name,
        planTier: b.plan_tier ?? null,
        isActive: b.is_active ?? true,
        vendorDeactivatedAt: b.vendor_deactivated_at ?? null,
        live: b.live ?? false,
        createdAt: b.created_at ?? null,
        limits: {
          messages: b.limits?.message_limit ?? null,
          pages: b.limits?.pages_limit ?? null,
          voiceMinutes: b.limits?.voice_minutes_limit ?? null,
        },
        usage: { messages: b.usage?.messages ?? 0, pages: b.usage?.pages ?? 0, voiceMinutes: b.usage?.voice_minutes ?? 0 },
        training: { pending: b.training?.pending ?? 0, failed: b.training?.failed ?? 0 },
      })),
      total: parsed.data.total ?? null,
      nextCursor: parsed.data.next_cursor ?? null,
    };
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

  /** `POST /bots/:botId/knowledge/discover`: candidate page URLs of a website. Trains nothing. */
  async discover(input: { botId: string; url: string; maxPages?: number; signal?: AbortSignal }): Promise<MonchaDiscovered> {
    const body: Record<string, unknown> = { url: input.url };
    if (input.maxPages !== undefined) body.max_pages = input.maxPages;
    const response = await this.request<unknown>('POST', `/bots/${encodeURIComponent(input.botId)}/knowledge/discover`, {
      body,
      signal: input.signal,
      timeoutMs: DISCOVER_TIMEOUT_MS,
    });
    const parsed = discoverSchema.safeParse(unwrap(response));
    if (!parsed.success) throw new MonchaInternalError('unexpected_response', 'knowledge/discover returned no urls', 200);
    const { urls, pagesFetched, pages_fetched, truncated } = parsed.data;
    return { urls, pagesFetched: pagesFetched ?? pages_fetched ?? null, truncated: truncated ?? false, response };
  }

  /** `POST /bots/:botId/knowledge/ingest-bulk`: queues training of 1-100 documents. */
  async ingestBulk(input: {
    botId: string;
    documents: MonchaKnowledgeDocument[];
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<MonchaTrainingQueued> {
    const response = await this.request<unknown>('POST', `/bots/${encodeURIComponent(input.botId)}/knowledge/ingest-bulk`, {
      body: { documents: input.documents },
      idempotencyKey: input.idempotencyKey,
      signal: input.signal,
    });
    const parsed = ingestSchema.safeParse(unwrap(response));
    if (!parsed.success) throw new MonchaInternalError('unexpected_response', 'knowledge/ingest-bulk returned no training_id', 202);
    return { trainingId: parsed.data.training_id, status: parsed.data.status ?? null, total: parsed.data.total ?? null, response };
  }

  /** `GET /bots/:botId/training/:trainingId`: progress of one training job. */
  async training(input: { botId: string; trainingId: string; signal?: AbortSignal }): Promise<MonchaTraining> {
    const response = await this.request<unknown>(
      'GET',
      `/bots/${encodeURIComponent(input.botId)}/training/${encodeURIComponent(input.trainingId)}`,
      { signal: input.signal },
    );
    const parsed = trainingSchema.safeParse(unwrap(response));
    if (!parsed.success) throw new MonchaInternalError('unexpected_response', 'training status returned no status', 200);
    const { status, total, ready, failed, poll_after_seconds } = parsed.data;
    return {
      status,
      total: total ?? null,
      ready: ready ?? null,
      failed: failed ?? null,
      pollAfterSeconds: poll_after_seconds ?? null,
      response,
    };
  }

  /** `GET /bots/:botId/widget`: the widget configuration, saved values merged with defaults and the bot name. */
  async widget(input: { botId: string; signal?: AbortSignal }): Promise<MonchaWidget> {
    const response = await this.request<unknown>('GET', `/bots/${encodeURIComponent(input.botId)}/widget`, { signal: input.signal });
    const parsed = widgetSchema.safeParse(unwrap(response));
    if (!parsed.success) throw new MonchaInternalError('unexpected_response', 'GET widget returned no config', 200);
    return { config: parsed.data.config, response };
  }

  /** `PUT /bots/:botId/widget`: replaces the saved configuration with `config` (sent as is, not wrapped). */
  async updateWidget(input: { botId: string; config: MonchaWidgetConfig; signal?: AbortSignal }): Promise<MonchaWidget> {
    const response = await this.request<unknown>('PUT', `/bots/${encodeURIComponent(input.botId)}/widget`, {
      body: input.config,
      signal: input.signal,
    });
    const parsed = widgetSchema.safeParse(unwrap(response));
    if (!parsed.success) throw new MonchaInternalError('unexpected_response', 'PUT widget returned no config', 200);
    return { config: parsed.data.config, response };
  }

  /** `GET /bots/:botId/install`: tenantId, chatbotId, apiUrl (an origin) and widgetUrl for the embed. */
  async install(input: { botId: string; signal?: AbortSignal }): Promise<MonchaInstall> {
    const response = await this.request<unknown>('GET', `/bots/${encodeURIComponent(input.botId)}/install`, { signal: input.signal });
    const parsed = installSchema.safeParse(unwrap(response));
    if (!parsed.success) throw new MonchaInternalError('unexpected_response', 'GET install returned no tenantId, chatbotId or apiUrl', 200);
    const { tenantId, chatbotId, apiUrl, widgetUrl } = parsed.data;
    return { tenantId, chatbotId, apiUrl, widgetUrl: widgetUrl?.trim() || null, response };
  }

  /** `GET /bots/:botId/domains`: hostnames where the widget is allowed to run (6.1). */
  async domains(input: { botId: string; signal?: AbortSignal }): Promise<MonchaDomains> {
    const response = await this.request<unknown>('GET', `/bots/${encodeURIComponent(input.botId)}/domains`, { signal: input.signal });
    const parsed = domainsSchema.safeParse(unwrap(response));
    if (!parsed.success) throw new MonchaInternalError('unexpected_response', 'GET domains returned no domains list', 200);
    return { domains: parsed.data.domains, response };
  }

  /**
   * `PUT /bots/:botId/domains`: replaces the allowed hostnames (6.2). Prefer bare hostnames; a nonempty list enables
   * the restriction (subdomains of listed hosts are also allowed). `[]` disables the restriction.
   */
  async updateDomains(input: { botId: string; domains: string[]; signal?: AbortSignal }): Promise<MonchaDomains> {
    const response = await this.request<unknown>('PUT', `/bots/${encodeURIComponent(input.botId)}/domains`, {
      body: { domains: input.domains },
      signal: input.signal,
    });
    const parsed = domainsSchema.safeParse(unwrap(response));
    if (!parsed.success) throw new MonchaInternalError('unexpected_response', 'PUT domains returned no domains list', 200);
    return { domains: parsed.data.domains, response };
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
