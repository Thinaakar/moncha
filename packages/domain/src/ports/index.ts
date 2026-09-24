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
export type JobType = 'places_discovery' | 'csv_import' | 'website_audit';
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
export type ChannelType = 'whatsapp' | 'contact_form' | 'booking_link' | 'tel' | 'email';

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

export interface DiscoverySource {
  discover(input: { country: string; city: string; keyword: string }): Promise<DiscoveredCompany[]>;
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
