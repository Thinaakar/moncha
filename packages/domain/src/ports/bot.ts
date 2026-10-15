/** MonCha bot tiers, in the order a tie is broken (cheapest first). */
export const BOT_PLAN_TIERS = ['starter', 'growth', 'scale'] as const;
export type BotPlanTier = (typeof BOT_PLAN_TIERS)[number];

export type BotSlot = { allocated: number; used: number; available: number };
export type BotSlots = Record<BotPlanTier, BotSlot>;

/** `pending` waits for the worker (first try or a retry), `creating` is in progress, `failed` gave up after its tries. */
export type LeadBotStatus = 'pending' | 'creating' | 'created' | 'failed';

export type LeadBotRecord = {
  id: string;
  tenantId: string;
  leadId: string;
  siteSnapshotId: string | null;
  environment: string;
  status: LeadBotStatus;
  name: string | null;
  planTier: BotPlanTier | null;
  idempotencyKey: string | null;
  attempts: number;
  nextAt: Date | null;
  lockedAt: Date | null;
  error: string | null;
  chatbotId: string | null;
  monchaTenantId: string | null;
  connectionId: string | null;
  config: unknown;
  createdBotAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LeadBotItem = LeadBotRecord & { company: { id: string; name: string; domain: string | null } };

export type LeadBotPatch = Partial<
  Pick<
    LeadBotRecord,
    | 'status'
    | 'name'
    | 'planTier'
    | 'idempotencyKey'
    | 'attempts'
    | 'nextAt'
    | 'lockedAt'
    | 'error'
    | 'chatbotId'
    | 'monchaTenantId'
    | 'connectionId'
    | 'config'
    | 'createdBotAt'
  >
>;

export type LeadBotListQuery = { status?: LeadBotStatus; page?: number; pageSize?: number };

export interface LeadBotRepo {
  /** Adds a pending bot for every lead whose website copy waits for its first try and that has no bot yet. */
  queueForWaitingCopies(environment: string): Promise<number>;
  /** Backfill: adds a pending bot for every lead with a live website and no bot. `dryRun` only counts them. */
  queueForLiveWebsites(environment: string, options?: { tenantId?: string; dryRun?: boolean }): Promise<number>;
  /** The lead's bot, created as pending when it has none. */
  ensure(input: { tenantId: string; leadId: string; environment: string }): Promise<LeadBotItem>;
  /**
   * Atomically takes the next bot that is due (any tenant): `pending` with `nextAt` at or before `now` (bots whose lead
   * has a copy waiting first), or `creating` locked before `staleBefore`. It becomes `creating` with one more attempt.
   * With `leadId`, only that lead's bot, whatever its `nextAt`.
   */
  claimNext(now: Date, staleBefore: Date, options?: { tenantId?: string; leadId?: string }): Promise<LeadBotItem | null>;
  /** Also keeps Lead.botStatus (and botCreatedAt) in step with the bot. */
  update(tenantId: string, id: string, patch: LeadBotPatch): Promise<LeadBotItem | null>;
  getForLead(tenantId: string, leadId: string): Promise<LeadBotItem | null>;
  list(
    tenantId: string,
    query: LeadBotListQuery,
  ): Promise<{
    items: LeadBotItem[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    counts: Record<LeadBotStatus, number>;
  }>;
  /** Another lead's bot in this environment already uses the name. */
  nameTaken(tenantId: string, environment: string, name: string, exceptLeadId: string): Promise<boolean>;
  /** The lead's copies still waiting for their first try become failed (`bot_failed`) with `error`. */
  failWaitingCopies(tenantId: string, leadId: string, error: string, at: Date): Promise<number>;
  /** Same for every lead whose bot already gave up (copies queued after it failed). */
  failCopiesOfFailedBots(at: Date): Promise<number>;
}

/** MonCha internal lead API, as the bot step uses it. Errors carry `code`, `status` (null = no response) and `retryAt`. */
export interface MonchaBotApi {
  readonly environment: string;
  slots(signal?: AbortSignal): Promise<BotSlots>;
  createBot(input: {
    name: string;
    planTier: BotPlanTier;
    language?: string;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<{ botId: string; tenantId: string; connectionId: string | null; planTier: string | null; response: unknown }>;
}
