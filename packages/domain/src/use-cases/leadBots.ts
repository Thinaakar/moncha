import {
  BOT_PLAN_TIERS,
  type BotPlanTier,
  type BotSlots,
  type LeadBotItem,
  type LeadBotRepo,
  type LeadRepo,
  type Logger,
  type MonchaBotApi,
  type SiteSnapshotRepo,
} from '../ports';
import { queueSiteSnapshot } from './siteSnapshots';

/**
 * Every lead that gets a website copy first gets a MonCha demo bot (internal lead API, POST /bots); the copy starts
 * only once the bot is created. A bot that fails 3 tries records its error and fails the lead's waiting copy, so the
 * pipeline moves on to the next lead.
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

export class LeadBotRequestError extends Error {
  constructor(readonly code: 'not_found' | 'not_failed' | 'bot_failed' | 'busy') {
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
 * Gives a failed bot 3 new tries. When the bot's failure had failed the lead's copy, a new copy is queued; it starts
 * once the bot is created.
 */
export async function retryLeadBot(
  deps: { bots: LeadBotRepo; leads: LeadRepo; snapshots: SiteSnapshotRepo },
  input: { tenantId: string; leadId: string },
): Promise<{ bot: LeadBotItem; copyQueued: boolean }> {
  const bot = await deps.bots.getForLead(input.tenantId, input.leadId);
  if (!bot) throw new LeadBotRequestError('not_found');
  if (bot.status !== 'failed') throw new LeadBotRequestError('not_failed');
  const reset = await deps.bots.update(input.tenantId, bot.id, {
    status: 'pending',
    attempts: 0,
    nextAt: null,
    lockedAt: null,
    error: null,
  });
  const [latest] = await deps.snapshots.listForLead(input.tenantId, input.leadId, 1);
  let copyQueued = false;
  if (latest?.status === 'failed' && latest.failureReason === LEAD_BOT_COPY_FAILURE) {
    const queued = await queueSiteSnapshot({ leads: deps.leads, snapshots: deps.snapshots }, input);
    copyQueued = !queued.deduped;
  }
  return { bot: reset ?? bot, copyQueued };
}
