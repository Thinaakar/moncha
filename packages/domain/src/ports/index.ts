export type WebsiteStatus = 'UNCHECKED' | 'ACTIVE' | 'INACTIVE' | 'PARKED' | 'INACCESSIBLE' | 'MISSING';
export type AssistantVerdict = 'NO_ASSISTANT' | 'HAS_ASSISTANT' | 'UNCERTAIN' | 'NOT_APPLICABLE';
export type AssistantKind = 'AI_CHATBOT' | 'LIVE_CHAT' | 'MESSAGING_LINK' | 'NONE';
export type LeadQueue =
  | 'PENDING_AUDIT'
  | 'QUALIFIED'
  | 'HAS_ASSISTANT'
  | 'NO_WEBSITE'
  | 'NEEDS_REVIEW'
  | 'INACTIVE';
export type JobStatus = 'pending' | 'running' | 'done' | 'failed';
export type JobType = 'places_discovery' | 'csv_import' | 'website_audit' | 'country_discovery';
export type AuditMethod = 'html' | 'render' | 'llm';
export type EvidenceType =
  | 'script_src'
  | 'iframe_src'
  | 'dom_selector'
  | 'network_request'
  | 'window_global'
  | 'screenshot'
  | 'page_excerpt'
  | 'llm_reason';
export type ChannelType =
  | 'whatsapp'
  | 'messenger'
  | 'telegram'
  | 'line'
  | 'viber'
  | 'contact_form'
  | 'booking_link'
  | 'tel'
  | 'email';

export type AuthContext = {
  userId: string;
  tenantId: string;
  role: string;
};

export type DiscoveredCompany = {
  name: string;
  domain?: string;
  websiteUrl?: string;
  country?: string;
  city?: string;
  phone?: string;
  address?: string;
  source: string;
  externalId?: string;
  raw?: unknown;
};

export type CompanyRecord = {
  id: string;
  tenantId: string;
  name: string;
  domain?: string | null;
  country?: string | null;
  city?: string | null;
  phone?: string | null;
  address?: string | null;
};

export type LeadRecord = {
  id: string;
  tenantId: string;
  companyId: string;
  queue: LeadQueue;
  assistantVerdict?: AssistantVerdict | null;
  assistantVendor?: string | null;
  qualificationReason?: string | null;
  latestAuditId?: string | null;
  version: number;
  createdAt?: Date;
  updatedAt?: Date;
};

export type SourceRecord = {
  id: string;
  tenantId: string;
  companyId: string;
  source: string;
  externalId?: string | null;
  rawJson?: unknown;
};

export type WebsiteRecord = {
  id: string;
  tenantId: string;
  companyId: string;
  url: string;
  canonicalUrl?: string | null;
  status: WebsiteStatus;
  language?: string | null;
  finalUrl?: string | null;
  httpStatus?: number | null;
  title?: string | null;
  latestAuditId?: string | null;
  lastCheckedAt?: Date | null;
};

export type EvidenceItemInput = {
  type: EvidenceType;
  url?: string;
  selector?: string;
  excerpt?: string;
  vendor?: string;
  sourcePage?: string;
  objectUri?: string;
  contentHash?: string;
};

export type DetectedChannelInput = {
  type: ChannelType;
  url: string;
  selector?: string;
  sourcePage?: string;
};

export type WebsiteAuditArtifacts = {
  screenshot?: Uint8Array;
  renderedDom?: string;
};

export type WebsiteAuditResult = {
  websiteStatus: WebsiteStatus;
  finalUrl?: string;
  httpStatus?: number;
  httpsOk?: boolean;
  robotsAllowed?: boolean;
  title?: string;
  language?: string;
  canonicalUrl?: string;
  verdict: AssistantVerdict;
  kind: AssistantKind;
  vendor?: string;
  confidence: number;
  method: AuditMethod;
  renderRan: boolean;
  llmRan: boolean;
  evidence: EvidenceItemInput[];
  channels: DetectedChannelInput[];
  failureReason?: string;
  contentHash?: string;
  auditedAt: Date;
  classifierVersion: string;
  llmModel?: string;
  llmPromptVersion?: string;
  llmResult?: unknown;
  llmPromptTokens?: number;
  llmCompletionTokens?: number;
  /** In-memory only; persisted via EvidenceStore after audit insert. */
  artifacts?: WebsiteAuditArtifacts;
};

export type WebsiteAuditRecord = WebsiteAuditResult & {
  id: string;
  tenantId: string;
  websiteId: string;
  leadId: string;
};

export type JobRunRecord = {
  id: string;
  tenantId: string;
  type: JobType;
  status: JobStatus;
  payload?: unknown;
  result?: unknown;
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  lockedAt?: Date | null;
  lockedBy?: string | null;
  lastError?: string | null;
  dedupeKey?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  createdAt?: Date;
};

export type DiscoveryJobResult = {
  found: number;
  created: number;
  duplicates: number;
  skipped: number;
  auditsEnqueued: number;
  noWebsite: number;
};

export type LeadListQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  country?: string;
  queue?: LeadQueue;
  assistantVerdict?: AssistantVerdict;
  vendor?: string;
  method?: AuditMethod;
  /** When true, exclude HAS_ASSISTANT (omit_chatbot_sites). */
  omitChatbotSites?: boolean;
};

export type LeadListItem = LeadRecord & {
  company: CompanyRecord & {
    website?: WebsiteRecord | null;
    sourceRecords?: SourceRecord[];
  };
};

export type LeadListResult = {
  items: LeadListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type QueueCounts = {
  PENDING_AUDIT: number;
  QUALIFIED: number;
  HAS_ASSISTANT: number;
  NO_WEBSITE: number;
  NEEDS_REVIEW: number;
  INACTIVE: number;
  openReviewTasks: number;
};

export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

/** Optional provider hints; sources that do not support a field ignore it. */
export type DiscoverySearchOptions = {
  /** Result pages to fetch (Google Places: 20 per page, max 3). Defaults to 1. */
  maxPages?: number;
  /** CLDR region code used to bias results, e.g. SG, MY, JP. */
  regionCode?: string;
  /** Language for place names/addresses, e.g. en, ja. */
  languageCode?: string;
};

export type DiscoverInput = { country: string; city: string; keyword: string } & DiscoverySearchOptions;

export interface DiscoverySource {
  discover(input: DiscoverInput): Promise<DiscoveredCompany[]>;
}

export type DiscoveryTargetStatus = 'pending' | 'done' | 'failed';

export type DiscoveryTargetRecord = {
  id: string;
  tenantId: string;
  source: string;
  countryCode: string;
  city: string;
  keyword: string;
  status: DiscoveryTargetStatus;
  attempts: number;
  calls: number;
  found: number;
  created: number;
  lastError?: string | null;
  lastRunAt?: Date | null;
};

export type DiscoveryTargetKey = { tenantId: string; source: string; countryCode: string };

export interface DiscoveryTargetRepo {
  /** Inserts missing city × keyword targets; existing rows keep their progress. Returns rows inserted. */
  ensure(key: DiscoveryTargetKey, pairs: Array<{ city: string; keyword: string }>): Promise<number>;
  /** Pending targets plus failed ones still under maxAttempts, in plan order (largest city first). */
  nextBatch(
    key: DiscoveryTargetKey,
    limit: number,
    maxAttempts: number,
    filter?: { cities?: string[]; keywords?: string[] },
  ): Promise<DiscoveryTargetRecord[]>;
  markStarted(id: string): Promise<void>;
  markDone(id: string, stats: { calls: number; found: number; created: number }): Promise<void>;
  markFailed(id: string, error: string, calls: number): Promise<void>;
  counts(key: DiscoveryTargetKey): Promise<Record<DiscoveryTargetStatus, number>>;
  /** Sets every target for the country back to pending (re-crawl). Returns rows reset. */
  reset(key: DiscoveryTargetKey): Promise<number>;
}

export interface DiscoveryUsageRepo {
  get(tenantId: string, source: string, day: string): Promise<number>;
  /** Adds provider calls for the day and returns the new total. */
  add(tenantId: string, source: string, day: string, calls: number): Promise<number>;
}

export type DiscoveryScheduleRecord = {
  id: string;
  tenantId: string;
  countryCode: string;
  /** Local wall-clock time, "HH:mm". */
  timeOfDay: string;
  /** IANA time zone the time is in, e.g. Asia/Kuala_Lumpur. */
  timezone: string;
  enabled: boolean;
  nextRunAt: Date;
  lastRunAt?: Date | null;
  createdAt?: Date;
};

export type DiscoveryScheduleCreate = {
  tenantId: string;
  countryCode: string;
  timeOfDay: string;
  timezone: string;
  nextRunAt: Date;
};

export interface DiscoveryScheduleRepo {
  /** Returns null when the tenant already has a schedule for this country at this time. */
  create(data: DiscoveryScheduleCreate): Promise<DiscoveryScheduleRecord | null>;
  list(tenantId: string): Promise<DiscoveryScheduleRecord[]>;
  delete(tenantId: string, id: string): Promise<boolean>;
  deleteByCountry(tenantId: string, countryCode: string): Promise<number>;
  /** Enabled schedules of every tenant with nextRunAt <= now, oldest first. */
  due(now: Date, limit: number): Promise<DiscoveryScheduleRecord[]>;
  /**
   * Atomically moves nextRunAt from `expected` to `next` and, when `job` is given, creates that job
   * unless its dedupeKey already exists. `advanced` is false when another scheduler got there first.
   */
  advance(
    schedule: DiscoveryScheduleRecord,
    next: Date,
    ranAt: Date,
    job?: JobCreate,
  ): Promise<{ advanced: boolean; job: JobRunRecord | null }>;
  /** Newest country_discovery jobs for the tenant (scheduled and manual). */
  recentRuns(tenantId: string, limit: number): Promise<JobRunRecord[]>;
}

export interface WebsiteAuditor {
  audit(input: { tenantId: string; leadId: string; url: string }): Promise<WebsiteAuditResult>;
}

export type LlmCompleteJsonInput<T> = {
  system: string;
  user: string;
  schema: unknown;
  promptVersion: string;
  parse: (raw: unknown) => T;
};

export interface LlmProvider {
  completeJson<T>(input: LlmCompleteJsonInput<T>): Promise<{
    data: T;
    usage: { promptTokens: number; completionTokens: number };
    model: string;
  }>;
}

export type EvidenceStorePut = {
  tenantId: string;
  auditId: string;
  kind: 'screenshot' | 'dom';
  bytes: Uint8Array | string;
  contentHash: string;
  retentionClass: 'website_snapshot_90d';
};

export interface EvidenceStore {
  put(input: EvidenceStorePut): Promise<{ objectUri: string }>;
}

export type HostAuditCacheRecord = {
  tenantId: string;
  host: string;
  classifierVersion: string;
  result: WebsiteAuditResult;
  auditedAt: Date;
};

export interface HostAuditCacheRepo {
  get(
    tenantId: string,
    host: string,
    classifierVersion: string,
  ): Promise<HostAuditCacheRecord | null>;
  put(input: {
    tenantId: string;
    host: string;
    classifierVersion: string;
    result: WebsiteAuditResult;
  }): Promise<void>;
}

export type CompanyWrite = {
  tenantId: string;
  name: string;
  domain?: string | null;
  country?: string | null;
  city?: string | null;
  phone?: string | null;
  address?: string | null;
};

export type CompanyPatch = Partial<Omit<CompanyWrite, 'tenantId'>>;

export type SourceWrite = {
  tenantId: string;
  companyId: string;
  source: string;
  externalId?: string;
  rawJson?: unknown;
};

export interface CompanyRepo {
  findByDomain(tenantId: string, domain: string): Promise<CompanyRecord | null>;
  create(data: CompanyWrite): Promise<CompanyRecord>;
  update(tenantId: string, id: string, data: CompanyPatch): Promise<CompanyRecord | null>;
  upsertSource(data: SourceWrite): Promise<SourceRecord>;
}

export type LeadCreate = {
  tenantId: string;
  companyId: string;
  queue: LeadQueue;
  assistantVerdict?: AssistantVerdict | null;
  qualificationReason?: string | null;
};

export type LeadQualificationPatch = {
  queue: LeadQueue;
  assistantVerdict: AssistantVerdict;
  assistantVendor?: string | null;
  qualificationReason: string;
  latestAuditId?: string;
  expectedVersion: number;
};

export interface LeadRepo {
  create(data: LeadCreate): Promise<LeadRecord>;
  findByCompany(tenantId: string, companyId: string): Promise<LeadRecord | null>;
  get(tenantId: string, id: string): Promise<LeadListItem | null>;
  list(tenantId: string, query: LeadListQuery): Promise<LeadListResult>;
  applyQualification(tenantId: string, leadId: string, data: LeadQualificationPatch): Promise<LeadRecord | null>;
  queueCounts(tenantId: string): Promise<QueueCounts>;
}

export type JobCreate = {
  tenantId: string;
  type: JobType;
  payload: unknown;
  dedupeKey?: string | null;
  maxAttempts?: number;
  runAfter?: Date;
  /** "running" creates the job already claimed by the caller, so no queue worker picks it up. */
  status?: 'pending' | 'running';
};

export type JobPatch = {
  status?: JobStatus;
  lastError?: string | null;
  result?: unknown;
  attempts?: number;
  runAfter?: Date | null;
  lockedAt?: Date | null;
  lockedBy?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
};

export interface JobRepo {
  create(data: JobCreate): Promise<JobRunRecord>;
  update(tenantId: string, id: string, data: JobPatch): Promise<JobRunRecord | null>;
  get(tenantId: string, id: string): Promise<JobRunRecord | null>;
}

export type WebsiteUpsert = {
  tenantId: string;
  companyId: string;
  url: string;
  status?: WebsiteStatus;
  canonicalUrl?: string | null;
  language?: string | null;
  finalUrl?: string | null;
  httpStatus?: number | null;
  title?: string | null;
  latestAuditId?: string | null;
  lastCheckedAt?: Date | null;
};

export interface WebsiteRepo {
  upsert(data: WebsiteUpsert): Promise<WebsiteRecord>;
  getByCompany(tenantId: string, companyId: string): Promise<WebsiteRecord | null>;
  applyAuditPointers(
    tenantId: string,
    websiteId: string,
    data: {
      status: WebsiteStatus;
      canonicalUrl?: string | null;
      language?: string | null;
      finalUrl?: string | null;
      httpStatus?: number | null;
      title?: string | null;
      latestAuditId: string;
      lastCheckedAt: Date;
    },
  ): Promise<WebsiteRecord | null>;
}

export type PersistAuditInput = {
  tenantId: string;
  websiteId: string;
  leadId: string;
  result: WebsiteAuditResult;
};

export interface WebsiteAuditRepo {
  /** Insert-only. */
  create(data: PersistAuditInput): Promise<WebsiteAuditRecord>;
  get(tenantId: string, id: string): Promise<WebsiteAuditRecord | null>;
  latestForLead(tenantId: string, leadId: string): Promise<WebsiteAuditRecord | null>;
}

export interface ReviewTaskRepo {
  open(data: {
    tenantId: string;
    leadId: string;
    auditId: string;
    reason: string;
  }): Promise<{ id: string }>;
  resolve(
    tenantId: string,
    id: string,
    data: { resolvedBy: string; resolutionNote: string },
  ): Promise<void>;
  findOpenForLead(tenantId: string, leadId: string): Promise<{ id: string; reason: string } | null>;
}

export interface AuditLogRepo {
  append(data: {
    tenantId: string;
    leadId?: string;
    entityType: string;
    entityId: string;
    action: string;
    actorId?: string;
    note?: string;
    before?: unknown;
    after?: unknown;
  }): Promise<void>;
}

export interface LlmUsageRepo {
  /** Increments calls (and failedCalls when failed). Returns total calls for the day after increment. */
  increment(
    tenantId: string,
    day: string,
    opts: { failed: boolean },
  ): Promise<{ calls: number; failedCalls: number }>;
  get(tenantId: string, day: string): Promise<{ calls: number; failedCalls: number } | null>;
}

export const JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  pending: ['running', 'failed'],
  running: ['done', 'failed', 'pending'],
  done: [],
  failed: ['pending', 'running'],
};

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

export function clampPageSize(pageSize?: number, fallback = 25, max = 100): number {
  if (pageSize === undefined || Number.isNaN(pageSize) || pageSize < 1) return fallback;
  return Math.min(max, Math.floor(pageSize));
}

export function clampPage(page?: number): number {
  if (page === undefined || Number.isNaN(page) || page < 1) return 1;
  return Math.floor(page);
}

export function websiteAuditDedupeKey(leadId: string, classifierVersion: string, day = utcDay()): string {
  return `${leadId}:${classifierVersion}:${day}`;
}

export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
