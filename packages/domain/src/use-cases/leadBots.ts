import {
  BOT_PLAN_TIERS,
  type BotPlanTier,
  type BotSlots,
  type KnowledgeDocument,
  type LeadBotItem,
  type LeadBotRepo,
  type LeadRepo,
  type Logger,
  type MonchaBotApi,
  type SiteSnapshotRepo,
} from '../ports';
import { queueSiteSnapshot } from './siteSnapshots';

/**
 * Every lead that gets a website copy first gets a MonCha demo bot (internal lead API, POST /bots) trained on its
 * website (knowledge/discover, knowledge/ingest-bulk, then training status until done); the copy starts only once the
 * bot is trained. A step that fails 3 tries records its error and fails the lead's waiting copy, so the pipeline moves
 * on to the next lead.
 */
export const LEAD_BOT_MAX_ATTEMPTS = 3;
export const LEAD_BOT_BACKOFF_MS = [60_000, 5 * 60_000];
/** A bot still `creating` after this long belongs to a worker that died; it is taken over (same key and body). */
export const LEAD_BOT_STALE_MS = 5 * 60_000;
/** Account problems (key, subscription, Admin options) pause every bot this long without using up a try. */
export const LEAD_BOT_ACCOUNT_PAUSE_MS = 15 * 60_000;
/** Every tier full: check the slots again after this long, without using up a try. */
export const LEAD_BOT_NO_SLOTS_WAIT_MS = 60 * 60_000;
export const LEAD_BOT_NAME_MAX = 30;
export const LEAD_BOT_LANGUAGE = 'en';
/** Copies whose bot gave up end with this failure reason. */
export const LEAD_BOT_COPY_FAILURE = 'bot_failed';
/** knowledge/discover `max_pages` (the API maximum); ingest-bulk takes at most 100 documents too. */
export const LEAD_BOT_DISCOVER_MAX_PAGES = 100;
export const LEAD_BOT_TRAIN_MAX_DOCUMENTS = 100;
export const LEAD_BOT_TITLE_MAX = 300;
/** Training status is polled no faster than this (the API's poll_after_seconds, currently 5). */
export const LEAD_BOT_POLL_MIN_MS = 5_000;
/** A failed poll (network, 5xx) is tried again after this long, without using up a try. */
export const LEAD_BOT_POLL_RETRY_MS = 60_000;
/** Written to `error` when the bot is trained. */
export const LEAD_BOT_TRAINED = 'success';

/** The bot's page quota is used up: another try cannot succeed. */
const KNOWLEDGE_FINAL_CODES = new Set(['kb_pages_limit', 'training_limit_reached']);

/** Errors about the MonCha account rather than the lead: retrying another lead would fail the same way. */
const ACCOUNT_CODES = new Set([
  'invalid_internal_credentials',
  'vendor_tenant_mismatch',
  'vendor_subscription_required',
  'vendor_disabled',
  'internal_workspace_unavailable',
  'connection_revoked',
  'insufficient_consent',
  'insufficient_scope',
]);

/** The tier with the most available slots; a tie goes to the cheaper tier. Null when every tier is full. */
export function pickBotTier(slots: BotSlots): BotPlanTier | null {
  let best: BotPlanTier | null = null;
  for (const tier of BOT_PLAN_TIERS) {
    const available = slots[tier]?.available ?? 0;
    if (available > 0 && (best === null || available > slots[best].available)) best = tier;
  }
  return best;
}

/**
 * The lead's company name (whitespace collapsed, at most 30 characters), or its domain when it has no name.
 * `withRef` adds a short lead reference, for names another lead's bot already uses.
 */
export function botName(company: { name: string; domain: string | null }, leadId: string, withRef = false): string {
  const base = company.name.replace(/\s+/g, ' ').trim() || company.domain?.trim() || 'Lead';
  if (!withRef) return base.slice(0, LEAD_BOT_NAME_MAX).trim();
  const ref = `L${leadId.replace(/[^a-z0-9]/gi, '').slice(-5)}`;
  return `${base.slice(0, LEAD_BOT_NAME_MAX - ref.length - 1).trim()} ${ref}`;
}

/** One key per create request body; a new body (another name or tier) gets the next version. */
export function botIdempotencyKey(leadId: string, previous: string | null): string {
  const version = Number(previous?.match(/-v(\d+)$/)?.[1] ?? 0) + 1;
  return `lead-${leadId}-bot-v${version}`;
}

/** One key per ingest-bulk body; a new body (after a failed training) gets the next version. */
export function trainingIdempotencyKey(leadId: string, previous: string | null): string {
  const version = Number(previous?.match(/-v(\d+)$/)?.[1] ?? 0) + 1;
  return `lead-${leadId}-train-v${version}`;
}

function readablePathPart(part: string): string {
  let text = part;
  try {
    text = decodeURIComponent(part);
  } catch {
    // keep the raw segment
  }
  return text.replace(/\.(html?|php|aspx?|jsp)$/i, '').replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** `{company} - {page path}`, for example `Acme Dental - services / implants`; the homepage is `Home`. */
export function pageTitle(company: { name: string; domain: string | null }, url: string): string {
  let host = company.domain ?? '';
  let path = '';
  try {
    const parsed = new URL(url);
    host ||= parsed.hostname;
    path = parsed.pathname.split('/').filter(Boolean).map(readablePathPart).filter(Boolean).join(' / ');
  } catch {
    // not a URL: the homepage title
  }
  const base = company.name.replace(/\s+/g, ' ').trim() || host || 'Website';
  return `${base} - ${path || 'Home'}`.slice(0, LEAD_BOT_TITLE_MAX).trim();
}

/** Discovered http(s) URLs without fragments or duplicates, at most 100; the website itself when none is left. */
export function trainingUrls(discovered: string[], websiteUrl: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of discovered) {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    url.hash = '';
    const text = url.toString();
    if (text.length > 2048 || seen.has(text)) continue;
    seen.add(text);
    urls.push(text);
    if (urls.length >= LEAD_BOT_TRAIN_MAX_DOCUMENTS) break;
  }
  return urls.length ? urls : [websiteUrl];
}

type ApiError = { code: string; message: string; status: number | null; retryAt?: Date };

function apiError(error: unknown): ApiError {
  const e = error as { code?: unknown; message?: unknown; status?: unknown; retryAt?: unknown };
  return {
    code: typeof e?.code === 'string' ? e.code : 'error',
    message: (typeof e?.message === 'string' ? e.message : String(error)).slice(0, 300),
    status: typeof e?.status === 'number' ? e.status : null,
    retryAt: e?.retryAt instanceof Date ? e.retryAt : undefined,
  };
}

export type LeadBotDeps = {
  bots: LeadBotRepo;
  api: MonchaBotApi;
  logger: Logger;
  now?: () => Date;
};

export type LeadBotOutcome =
  | { status: 'created'; leadId: string; botId: string; chatbotId: string; planTier: string; name: string }
  | { status: 'retry'; leadId: string; botId: string; error: string; nextAt: Date }
  | { status: 'failed'; leadId: string; botId: string; error: string; copiesFailed: number }
  /** Not this lead's fault (account problem, rate limit, every tier full): the try is given back. */
  | { status: 'paused'; leadId: string; botId: string; error: string; until: Date };

/** Creates one claimed bot (status `creating`, attempts already counted). */
export async function createLeadBot(deps: LeadBotDeps, bot: LeadBotItem, signal?: AbortSignal): Promise<LeadBotOutcome> {
  const now = deps.now ?? (() => new Date());
  const { tenantId, leadId, id: botId } = bot;
  let { name, planTier, idempotencyKey } = bot;

  const giveBack = async (error: string, until: Date): Promise<LeadBotOutcome> => {
    await deps.bots.update(tenantId, botId, {
      status: 'pending',
      attempts: Math.max(0, bot.attempts - 1),
      nextAt: until,
      lockedAt: null,
      error,
    });
    deps.logger.error('lead_bot_paused', { tenantId, leadId, botId, error, until: until.toISOString() });
    return { status: 'paused', leadId, botId, error, until };
  };

  try {
    if (!name || !planTier || !idempotencyKey) {
      const tier = planTier ?? pickBotTier(await deps.api.slots(signal));
      if (!tier) return giveBack('slot_unavailable: every tier is full', new Date(now().getTime() + LEAD_BOT_NO_SLOTS_WAIT_MS));
      if (!name) {
        name = botName(bot.company, leadId);
        if (await deps.bots.nameTaken(tenantId, bot.environment, name, leadId)) name = botName(bot.company, leadId, true);
      }
      planTier = tier;
      idempotencyKey = botIdempotencyKey(leadId, bot.idempotencyKey);
      // Saved before sending: a retry after a timeout sends exactly this request again.
      await deps.bots.update(tenantId, botId, { name, planTier, idempotencyKey });
    }

    const created = await deps.api.createBot({ name, planTier, language: LEAD_BOT_LANGUAGE, idempotencyKey, signal });
    const savedTier = created.planTier ?? planTier;
    await deps.bots.update(tenantId, botId, {
      status: 'created',
      chatbotId: created.botId,
      monchaTenantId: created.tenantId,
      connectionId: created.connectionId,
      planTier: (BOT_PLAN_TIERS as readonly string[]).includes(savedTier) ? (savedTier as BotPlanTier) : planTier,
      config: created.response,
      error: null,
      nextAt: null,
      lockedAt: null,
      createdBotAt: now(),
    });
    deps.logger.info('lead_bot_created', { tenantId, leadId, botId, chatbotId: created.botId, planTier: savedTier, name });
    return { status: 'created', leadId, botId, chatbotId: created.botId, planTier: savedTier, name };
  } catch (error) {
    const e = apiError(error);
    const text = `${e.code}: ${e.message}`.slice(0, 300);
    if (e.code === 'aborted' || signal?.aborted) return giveBack(text, now());
    if (ACCOUNT_CODES.has(e.code) || e.status === 401 || e.status === 402 || e.status === 403) {
      return giveBack(text, new Date(now().getTime() + LEAD_BOT_ACCOUNT_PAUSE_MS));
    }
    if (e.status === 429) return giveBack(text, e.retryAt ?? new Date(now().getTime() + LEAD_BOT_BACKOFF_MS[0]!));

    const patch: Parameters<LeadBotRepo['update']>[2] = { error: text, lockedAt: null };
    if (e.code === 'bot_name_taken') {
      // Another bot in the workspace has the name: the next try adds a lead reference, which is a new request body.
      patch.name = botName(bot.company, leadId, true);
      patch.idempotencyKey = botIdempotencyKey(leadId, idempotencyKey);
    } else if (e.code === 'slot_unavailable') {
      // The chosen tier filled up: the next try picks the tier again (and a new key).
      patch.planTier = null;
    }

    if (bot.attempts >= LEAD_BOT_MAX_ATTEMPTS) {
      const at = now();
      await deps.bots.update(tenantId, botId, { ...patch, status: 'failed', nextAt: null });
      const copiesFailed = await deps.bots.failWaitingCopies(
        tenantId,
        leadId,
        `Bot creation failed after ${LEAD_BOT_MAX_ATTEMPTS} attempts: ${text}`,
        at,
      );
      deps.logger.error('lead_bot_failed', { tenantId, leadId, botId, error: text, attempts: bot.attempts, copiesFailed });
      return { status: 'failed', leadId, botId, error: text, copiesFailed };
    }
    const wait = e.code === 'bot_name_taken' ? 0 : (LEAD_BOT_BACKOFF_MS[bot.attempts - 1] ?? LEAD_BOT_BACKOFF_MS.at(-1)!);
    const nextAt = new Date(now().getTime() + wait);
    await deps.bots.update(tenantId, botId, { ...patch, status: 'pending', nextAt });
    deps.logger.error('lead_bot_retry', { tenantId, leadId, botId, error: text, attempts: bot.attempts, nextAt: nextAt.toISOString() });
    return { status: 'retry', leadId, botId, error: text, nextAt };
  }
}

export type LeadBotTickOutcome = { action: 'idle'; queued: number; copiesFailed: number } | { action: 'ran'; outcome: LeadBotOutcome };

/**
 * One bot per tick: queues bots for leads whose copy waits, fails copies of leads whose bot already gave up, then
 * creates the next due bot. With `leadId`, only that lead's bot, right away.
 */
export async function runLeadBotTick(
  deps: LeadBotDeps,
  options: { tenantId?: string; leadId?: string; signal?: AbortSignal } = {},
): Promise<LeadBotTickOutcome> {
  const now = deps.now?.() ?? new Date();
  let queued = 0;
  let copiesFailed = 0;
  if (!options.leadId) {
    queued = await deps.bots.queueForWaitingCopies(deps.api.environment);
    copiesFailed = await deps.bots.failCopiesOfFailedBots(now);
    if (queued) deps.logger.info('lead_bot_queued', { queued });
    if (copiesFailed) deps.logger.error('lead_bot_copies_failed', { copiesFailed });
  }
  const bot = await deps.bots.claimNext(now, new Date(now.getTime() - LEAD_BOT_STALE_MS), {
    tenantId: options.tenantId,
    leadId: options.leadId,
  });
  if (!bot) return { action: 'idle', queued, copiesFailed };
  return { action: 'ran', outcome: await createLeadBot(deps, bot, options.signal) };
}

export type LeadBotTrainOutcome =
  | { status: 'submitted'; leadId: string; botId: string; trainingId: string; documents: number; nextAt: Date }
  | { status: 'training'; leadId: string; botId: string; trainingStatus: string; nextAt: Date }
  | { status: 'trained'; leadId: string; botId: string; total: number | null; ready: number | null; failed: number | null }
  | { status: 'retry'; leadId: string; botId: string; error: string; nextAt: Date }
  | { status: 'failed'; leadId: string; botId: string; error: string; copiesFailed: number }
  /** Not this lead's fault (account problem, rate limit, discovery down): the try is given back. */
  | { status: 'paused'; leadId: string; botId: string; error: string; until: Date };

function isAccountError(e: ApiError): boolean {
  return ACCOUNT_CODES.has(e.code) || e.status === 401 || e.status === 402 || e.status === 403;
}

/**
 * The training step of one claimed bot. `discovering`: discover the website (once), save the ingest-bulk body and
 * key, then submit it. `training`: poll the training status until it is completed.
 */
export async function trainLeadBot(deps: LeadBotDeps, bot: LeadBotItem, signal?: AbortSignal): Promise<LeadBotTrainOutcome> {
  const now = deps.now ?? (() => new Date());
  const { tenantId, leadId, id: botId } = bot;
  const chatbotId = bot.chatbotId!;
  const at = (ms: number) => new Date(now().getTime() + ms);

  const giveBack = async (error: string, until: Date): Promise<LeadBotTrainOutcome> => {
    await deps.bots.update(tenantId, botId, {
      knowledgeStatus: bot.knowledgeStatus === 'training' ? 'training' : 'pending',
      knowledgeAttempts: bot.knowledgeStatus === 'training' ? bot.knowledgeAttempts : Math.max(0, bot.knowledgeAttempts - 1),
      knowledgeNextAt: until,
      knowledgeLockedAt: null,
      error,
    });
    deps.logger.error('lead_bot_training_paused', { tenantId, leadId, botId, error, until: until.toISOString() });
    return { status: 'paused', leadId, botId, error, until };
  };

  /** A failed try: the same request again after a backoff, or the final failure after the 3rd try. */
  const failTry = async (text: string, options: { final?: boolean; newRequest?: boolean } = {}): Promise<LeadBotTrainOutcome> => {
    const reset = options.newRequest ? { trainingPayload: null, trainingId: null } : {};
    if (options.final || bot.knowledgeAttempts >= LEAD_BOT_MAX_ATTEMPTS) {
      await deps.bots.update(tenantId, botId, {
        ...reset,
        knowledgeStatus: 'failed',
        knowledgeNextAt: null,
        knowledgeLockedAt: null,
        error: text,
      });
      const reason = options.final ? `Bot training failed: ${text}` : `Bot training failed after ${bot.knowledgeAttempts} attempts: ${text}`;
      const copiesFailed = await deps.bots.failWaitingCopies(tenantId, leadId, reason, now());
      deps.logger.error('lead_bot_training_failed', { tenantId, leadId, botId, error: text, attempts: bot.knowledgeAttempts, copiesFailed });
      return { status: 'failed', leadId, botId, error: text, copiesFailed };
    }
    const nextAt = at(LEAD_BOT_BACKOFF_MS[bot.knowledgeAttempts - 1] ?? LEAD_BOT_BACKOFF_MS.at(-1)!);
    await deps.bots.update(tenantId, botId, {
      ...reset,
      knowledgeStatus: 'pending',
      knowledgeNextAt: nextAt,
      knowledgeLockedAt: null,
      error: text,
    });
    deps.logger.error('lead_bot_training_retry', { tenantId, leadId, botId, error: text, attempts: bot.knowledgeAttempts, nextAt: nextAt.toISOString() });
    return { status: 'retry', leadId, botId, error: text, nextAt };
  };

  if (bot.knowledgeStatus === 'training' && bot.trainingId) {
    try {
      const t = await deps.api.training({ botId: chatbotId, trainingId: bot.trainingId, signal });
      const ready = t.ready ?? 0;
      if (t.status === 'completed' || (t.status === 'partial_failure' && ready > 0)) {
        const failed = t.failed ?? 0;
        const error = failed > 0 ? `${LEAD_BOT_TRAINED}: ${failed} of ${t.total ?? ready + failed} pages failed to train` : LEAD_BOT_TRAINED;
        await deps.bots.update(tenantId, botId, {
          knowledgeStatus: 'trained',
          knowledgeNextAt: null,
          knowledgeLockedAt: null,
          trainingResult: t.response,
          trainedAt: now(),
          error,
        });
        deps.logger.info('lead_bot_trained', { tenantId, leadId, botId, total: t.total, ready: t.ready, failed: t.failed });
        return { status: 'trained', leadId, botId, total: t.total, ready: t.ready, failed: t.failed };
      }
      if (t.status === 'failed' || t.status === 'partial_failure') {
        await deps.bots.update(tenantId, botId, { trainingResult: t.response });
        return failTry(`training_failed: ${t.failed ?? t.total ?? 'all'} pages failed to train`, { newRequest: true });
      }
      // Still running: keep polling. A slow training is never resubmitted (that would train the pages twice).
      const nextAt = at(Math.max(LEAD_BOT_POLL_MIN_MS, (t.pollAfterSeconds ?? 0) * 1000));
      await deps.bots.update(tenantId, botId, { trainingResult: t.response, knowledgeNextAt: nextAt, knowledgeLockedAt: null });
      return { status: 'training', leadId, botId, trainingStatus: t.status, nextAt };
    } catch (error) {
      const e = apiError(error);
      const text = `${e.code}: ${e.message}`.slice(0, 300);
      if (e.code === 'aborted' || signal?.aborted) return giveBack(text, now());
      if (isAccountError(e)) return giveBack(text, at(LEAD_BOT_ACCOUNT_PAUSE_MS));
      if (e.status === 429) return giveBack(text, e.retryAt ?? at(LEAD_BOT_BACKOFF_MS[0]!));
      if (e.code === 'training_not_found' || e.status === 404) return failTry(text, { newRequest: true });
      // A poll is a read: network errors and 5xx are tried again later without using up a try.
      await deps.bots.update(tenantId, botId, { knowledgeNextAt: at(LEAD_BOT_POLL_RETRY_MS), knowledgeLockedAt: null, error: text });
      return { status: 'training', leadId, botId, trainingStatus: 'poll_error', nextAt: at(LEAD_BOT_POLL_RETRY_MS) };
    }
  }

  try {
    let payload = bot.trainingPayload;
    let key = bot.trainingKey;
    if (!payload || !key) {
      const websiteUrl = bot.websiteUrl ?? bot.company.websiteUrl;
      if (!websiteUrl) return failTry('no_website: the lead has no website URL', { final: true });
      const found = await deps.api.discover({ botId: chatbotId, url: websiteUrl, maxPages: LEAD_BOT_DISCOVER_MAX_PAGES, signal });
      const documents: KnowledgeDocument[] = trainingUrls(found.urls, websiteUrl).map((url) => ({
        title: pageTitle(bot.company, url),
        url,
        source_type: 'url',
      }));
      payload = { documents };
      key = trainingIdempotencyKey(leadId, bot.trainingKey);
      // Saved before sending: a retry after a timeout sends exactly this request again.
      await deps.bots.update(tenantId, botId, {
        websiteUrl,
        discoveredUrls: found.urls,
        pagesFetched: found.pagesFetched,
        discoveryTruncated: found.truncated,
        discoveredAt: now(),
        trainingPayload: payload,
        trainingKey: key,
        trainingId: null,
      });
      deps.logger.info('lead_bot_discovered', { tenantId, leadId, botId, websiteUrl, urls: found.urls.length, documents: documents.length });
    }

    const queued = await deps.api.ingestBulk({ botId: chatbotId, documents: payload.documents, idempotencyKey: key, signal });
    const nextAt = at(LEAD_BOT_POLL_MIN_MS);
    await deps.bots.update(tenantId, botId, {
      knowledgeStatus: 'training',
      trainingId: queued.trainingId,
      trainingResult: queued.response,
      trainingSubmittedAt: now(),
      knowledgeNextAt: nextAt,
      knowledgeLockedAt: null,
    });
    deps.logger.info('lead_bot_training_submitted', { tenantId, leadId, botId, trainingId: queued.trainingId, documents: payload.documents.length });
    return { status: 'submitted', leadId, botId, trainingId: queued.trainingId, documents: payload.documents.length, nextAt };
  } catch (error) {
    const e = apiError(error);
    const text = `${e.code}: ${e.message}`.slice(0, 300);
    if (e.code === 'aborted' || signal?.aborted) return giveBack(text, now());
    if (isAccountError(e)) return giveBack(text, at(LEAD_BOT_ACCOUNT_PAUSE_MS));
    if (e.status === 429) return giveBack(text, e.retryAt ?? at(LEAD_BOT_BACKOFF_MS[0]!));
    if (e.code === 'discovery_unavailable') return giveBack(text, at(LEAD_BOT_ACCOUNT_PAUSE_MS));
    if (KNOWLEDGE_FINAL_CODES.has(e.code)) return failTry(text, { final: true });
    // The saved key no longer matches its body: start a new request (new discovery and key).
    return failTry(text, { newRequest: e.code === 'idempotency_conflict' });
  }
}

export type LeadBotTrainTickOutcome = { action: 'idle' } | { action: 'ran'; outcome: LeadBotTrainOutcome };

/** One training step per tick: the next created bot to discover and submit, or to poll. */
export async function runLeadBotTrainTick(
  deps: LeadBotDeps,
  options: { tenantId?: string; leadId?: string; signal?: AbortSignal } = {},
): Promise<LeadBotTrainTickOutcome> {
  const now = deps.now?.() ?? new Date();
  const bot = await deps.bots.claimNextKnowledge(now, new Date(now.getTime() - LEAD_BOT_STALE_MS), {
    tenantId: options.tenantId,
    leadId: options.leadId,
  });
  if (!bot) return { action: 'idle' };
  return { action: 'ran', outcome: await trainLeadBot(deps, bot, options.signal) };
}

export class LeadBotRequestError extends Error {
  constructor(readonly code: 'not_found' | 'not_failed' | 'bot_failed' | 'busy' | 'not_created' | 'training_failed') {
    super(code);
    this.name = 'LeadBotRequestError';
  }
}

/**
 * Creates the lead's bot now (the console or Postman): a created bot is returned as is, a pending one is created right
 * away. A failed bot needs retryLeadBot first.
 */
export async function createLeadBotNow(
  deps: LeadBotDeps,
  input: { tenantId: string; leadId: string; signal?: AbortSignal },
): Promise<{ bot: LeadBotItem; outcome: LeadBotOutcome | null }> {
  const existing = await deps.bots.ensure({ tenantId: input.tenantId, leadId: input.leadId, environment: deps.api.environment });
  if (existing.status === 'created') return { bot: existing, outcome: null };
  if (existing.status === 'failed') throw new LeadBotRequestError('bot_failed');
  const tick = await runLeadBotTick(deps, { tenantId: input.tenantId, leadId: input.leadId, signal: input.signal });
  if (tick.action === 'idle') throw new LeadBotRequestError('busy');
  const bot = await deps.bots.getForLead(input.tenantId, input.leadId);
  return { bot: bot ?? existing, outcome: tick.outcome };
}

/**
 * Runs the lead's training step now (the console or Postman): discover + submit when it waits, one poll while it
 * trains. A trained bot is returned as is; a failed training needs retryLeadBot first.
 */
export async function trainLeadBotNow(
  deps: LeadBotDeps,
  input: { tenantId: string; leadId: string; signal?: AbortSignal },
): Promise<{ bot: LeadBotItem; outcome: LeadBotTrainOutcome | null }> {
  const existing = await deps.bots.getForLead(input.tenantId, input.leadId);
  if (!existing) throw new LeadBotRequestError('not_found');
  if (existing.status !== 'created') throw new LeadBotRequestError('not_created');
  if (existing.knowledgeStatus === 'trained') return { bot: existing, outcome: null };
  if (existing.knowledgeStatus === 'failed') throw new LeadBotRequestError('training_failed');
  const tick = await runLeadBotTrainTick(deps, { tenantId: input.tenantId, leadId: input.leadId, signal: input.signal });
  if (tick.action === 'idle') throw new LeadBotRequestError('busy');
  const bot = await deps.bots.getForLead(input.tenantId, input.leadId);
  return { bot: bot ?? existing, outcome: tick.outcome };
}

/**
 * Gives a failed bot (creation or training) 3 new tries; a failed training starts over with a new discovery. When the
 * failure had failed the lead's copy, a new copy is queued; it starts once the bot is trained.
 */
export async function retryLeadBot(
  deps: { bots: LeadBotRepo; leads: LeadRepo; snapshots: SiteSnapshotRepo },
  input: { tenantId: string; leadId: string },
): Promise<{ bot: LeadBotItem; copyQueued: boolean }> {
  const bot = await deps.bots.getForLead(input.tenantId, input.leadId);
  if (!bot) throw new LeadBotRequestError('not_found');
  let reset: LeadBotItem | null;
  if (bot.status === 'failed') {
    reset = await deps.bots.update(input.tenantId, bot.id, {
      status: 'pending',
      attempts: 0,
      nextAt: null,
      lockedAt: null,
      error: null,
    });
  } else if (bot.knowledgeStatus === 'failed') {
    reset = await deps.bots.update(input.tenantId, bot.id, {
      knowledgeStatus: 'pending',
      knowledgeAttempts: 0,
      knowledgeNextAt: null,
      knowledgeLockedAt: null,
      trainingPayload: null,
      trainingId: null,
      error: null,
    });
  } else {
    throw new LeadBotRequestError('not_failed');
  }
  const [latest] = await deps.snapshots.listForLead(input.tenantId, input.leadId, 1);
  let copyQueued = false;
  if (latest?.status === 'failed' && latest.failureReason === LEAD_BOT_COPY_FAILURE) {
    const queued = await queueSiteSnapshot({ leads: deps.leads, snapshots: deps.snapshots }, input);
    copyQueued = !queued.deduped;
  }
  return { bot: reset ?? bot, copyQueued };
}
