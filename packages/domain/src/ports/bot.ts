/** MonCha bot tiers, in the order a tie is broken (cheapest first). */
export const BOT_PLAN_TIERS = ['starter', 'growth', 'scale'] as const;
export type BotPlanTier = (typeof BOT_PLAN_TIERS)[number];

export type BotSlot = { allocated: number; used: number; available: number };
export type BotSlots = Record<BotPlanTier, BotSlot>;

/** `pending` waits for the worker (first try or a retry), `creating` is in progress, `failed` gave up after its tries. */
export type LeadBotStatus = 'pending' | 'creating' | 'created' | 'failed';

/**
 * Website training of a created bot: `pending` waits for the worker, `discovering` runs discover + ingest-bulk,
 * `training` is submitted and polled, `trained` is done, `failed` gave up after its tries.
 */
export type LeadBotKnowledgeStatus = 'pending' | 'discovering' | 'training' | 'trained' | 'failed';

export type KnowledgeDocument = { title: string; url: string; source_type: 'url' };

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
  knowledgeStatus: LeadBotKnowledgeStatus;
  knowledgeAttempts: number;
  knowledgeNextAt: Date | null;
  knowledgeLockedAt: Date | null;
  websiteUrl: string | null;
  discoveredUrls: string[] | null;
  pagesFetched: number | null;
  discoveryTruncated: boolean | null;
  discoveredAt: Date | null;
  trainingKey: string | null;
  trainingPayload: { documents: KnowledgeDocument[] } | null;
  trainingId: string | null;
  trainingResult: unknown;
  trainingSubmittedAt: Date | null;
  trainedAt: Date | null;
  /** Widget primaryColor picked from the website's brand and saved with PUT widget. */
  widgetPrimaryColor: string | null;
  /** GET widget response before the change and PUT widget response after it. */
  widgetConfigBefore: unknown;
  widgetConfig: unknown;
  /** GET install response (tenantId, chatbotId, apiUrl, widgetUrl). */
  installValues: unknown;
  widgetConfiguredAt: Date | null;
  /** Hostnames from PUT /bots/:botId/domains (6.2), usually the live Worker hostname. */
  domains: string[] | null;
  domainsConfiguredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** `websiteUrl`: the lead's website (final URL of the audit, else its URL, else https://domain). */
export type LeadBotItem = LeadBotRecord & {
  company: { id: string; name: string; domain: string | null; websiteUrl: string | null };
};

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
    | 'knowledgeStatus'
    | 'knowledgeAttempts'
    | 'knowledgeNextAt'
    | 'knowledgeLockedAt'
    | 'websiteUrl'
    | 'discoveredUrls'
    | 'pagesFetched'
    | 'discoveryTruncated'
    | 'discoveredAt'
    | 'trainingKey'
    | 'trainingPayload'
    | 'trainingId'
    | 'trainingResult'
    | 'trainingSubmittedAt'
    | 'trainedAt'
    | 'widgetPrimaryColor'
    | 'widgetConfigBefore'
    | 'widgetConfig'
    | 'installValues'
    | 'widgetConfiguredAt'
    | 'domains'
    | 'domainsConfiguredAt'
  >
>;

/** Our side of a MonCha bot: the lead it was made for and that lead's latest live website copy. */
export type LeadBotLink = {
  chatbotId: string;
  leadId: string;
  company: { id: string; name: string; domain: string | null };
  status: LeadBotStatus;
  knowledgeStatus: LeadBotKnowledgeStatus;
  /** Latest deployed Worker URL of the lead's website copy. */
  liveUrl: string | null;
  /** That copy has the chatbot embed. */
  chatbotInstalled: boolean;
};

export type LeadBotListQuery = {
  status?: LeadBotStatus;
  knowledgeStatus?: LeadBotKnowledgeStatus;
  page?: number;
  pageSize?: number;
};

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
  claimNext(
    now: Date,
    staleBefore: Date,
    options?: { tenantId?: string; leadId?: string; /** Only resume stale `creating` locks; skip virgin `pending`. */ inFlightOnly?: boolean },
  ): Promise<LeadBotItem | null>;
  /**
   * Atomically takes the next created bot whose training step is due (leads with a waiting copy first, then polls):
   * `pending` (or `discovering` locked before `staleBefore`) becomes `discovering` with one more knowledge attempt;
   * `training` with `knowledgeNextAt` due is locked for one poll. With `leadId`, only that bot, whatever its next time.
   * `inFlightOnly` skips virgin `pending` (drain pause): only stale `discovering` and due `training`.
   */
  claimNextKnowledge(
    now: Date,
    staleBefore: Date,
    options?: { tenantId?: string; leadId?: string; inFlightOnly?: boolean },
  ): Promise<LeadBotItem | null>;
  /** Also keeps Lead.botStatus (and botCreatedAt) in step with the bot. */
  update(tenantId: string, id: string, patch: LeadBotPatch): Promise<LeadBotItem | null>;
  getForLead(tenantId: string, leadId: string): Promise<LeadBotItem | null>;
  /** Our lead bots for these MonCha bot ids (`chatbotId`); ids we never created are simply absent. */
  linksByChatbotIds(tenantId: string, chatbotIds: string[]): Promise<LeadBotLink[]>;
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
    knowledgeCounts: Record<LeadBotKnowledgeStatus, number>;
  }>;
  /** Another lead's bot in this environment already uses the name. */
  nameTaken(tenantId: string, environment: string, name: string, exceptLeadId: string): Promise<boolean>;
  /** The lead's copies still waiting for their first try become failed (`bot_failed`) with `error`. */
  failWaitingCopies(tenantId: string, leadId: string, error: string, at: Date): Promise<number>;
  /** Same for every lead whose bot creation or training already gave up (copies queued after it failed). */
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
  discover(input: {
    botId: string;
    url: string;
    maxPages?: number;
    signal?: AbortSignal;
  }): Promise<{ urls: string[]; pagesFetched: number | null; truncated: boolean; response: unknown }>;
  ingestBulk(input: {
    botId: string;
    documents: KnowledgeDocument[];
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<{ trainingId: string; status: string | null; total: number | null; response: unknown }>;
  training(input: { botId: string; trainingId: string; signal?: AbortSignal }): Promise<{
    status: string;
    total: number | null;
    ready: number | null;
    failed: number | null;
    pollAfterSeconds: number | null;
    response: unknown;
  }>;
}

/** Widget configuration as GET/PUT widget return it (saved values merged with defaults). */
export type WidgetConfig = Record<string, unknown>;

/** GET install: the public values of the embed. `widgetUrl` is null until MonCha configures it. */
export type MonchaInstallValues = { tenantId: string; chatbotId: string; apiUrl: string; widgetUrl: string | null };

/** MonCha internal lead API, as the website chatbot step uses it (5.1, 5.2, 6.1, 6.2, 6.3). */
export interface MonchaWidgetApi {
  widget(input: { botId: string; signal?: AbortSignal }): Promise<{ config: WidgetConfig; response: unknown }>;
  updateWidget(input: { botId: string; config: WidgetConfig; signal?: AbortSignal }): Promise<{ config: WidgetConfig; response: unknown }>;
  install(input: { botId: string; signal?: AbortSignal }): Promise<MonchaInstallValues & { response: unknown }>;
  domains(input: { botId: string; signal?: AbortSignal }): Promise<{ domains: string[]; response: unknown }>;
  updateDomains(input: { botId: string; domains: string[]; signal?: AbortSignal }): Promise<{ domains: string[]; response: unknown }>;
}
