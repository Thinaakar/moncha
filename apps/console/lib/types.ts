import type {
  CostTokens,
  SiteCostModelPrice,
  SiteCostPricing,
  SiteCostSort,
  SiteCostSummary,
  SiteCostWebsite,
  SiteCostWebsiteDetail,
  SiteCostWebsitePage,
} from '@moncha/contracts';
import type {
  AssistantKind,
  AssistantVerdict,
  AuditMethod,
  JobStatus,
  JobType,
  LeadQueue,
  MonchaBotPage,
  MonchaBotView,
  MonchaInternalCheckResult,
  MonchaSlotTier,
  SiteAssetKind,
  SiteAutomationCrawl,
  SiteAutomationCrawlStatus,
  SiteAutomationState,
  SiteAutomationUpdate,
  WorkerQueueState,
  WorkerQueueUpdate,
  SiteBrand,
  SiteCopyOrigin,
  SiteCopyProgress,
  SiteCopyStep,
  SiteCopyStepState,
  SiteDeployFilter,
  SiteGithubPush,
  SiteGithubStatus,
  SiteManifest,
  SiteManifestAsset,
  SiteManifestException,
  SiteManifestSkipped,
  SitePipelineState,
  SitePipelineStatus,
  SitePipelineStep,
  SiteQueue,
  SiteQueueItem,
  SiteSnapshotDetail,
  SiteSnapshotFiles,
  SiteSnapshotQueued,
  SiteSnapshotSource,
  SiteSnapshotSummary,
  SiteWorkerDeploy,
  SiteWorkerStatus,
  WebsiteStatus,
} from '@moncha/contracts';

export type { AssistantKind, AssistantVerdict, AuditMethod, JobStatus, JobType, LeadQueue, WebsiteStatus };
export type { MonchaBotPage, MonchaBotView, MonchaInternalCheckResult, MonchaSlotTier };
export type {
  SiteAssetKind,
  SiteAutomationCrawl,
  SiteAutomationCrawlStatus,
  SiteAutomationState,
  SiteAutomationUpdate,
  WorkerQueueState,
  WorkerQueueUpdate,
  SiteBrand,
  SiteCopyOrigin,
  SiteCopyProgress,
  SiteCopyStep,
  SiteCopyStepState,
  SiteDeployFilter,
  SiteGithubPush,
  SiteGithubStatus,
  SiteManifest,
  SiteManifestAsset,
  SiteManifestException,
  SiteManifestSkipped,
  SitePipelineState,
  SitePipelineStatus,
  SitePipelineStep,
  SiteQueue,
  SiteQueueItem,
  SiteSnapshotDetail,
  SiteSnapshotFiles,
  SiteSnapshotQueued,
  SiteSnapshotSource,
  SiteSnapshotSummary,
  SiteWorkerDeploy,
  SiteWorkerStatus,
};
export type {
  CostTokens,
  SiteCostModelPrice,
  SiteCostPricing,
  SiteCostSort,
  SiteCostSummary,
  SiteCostWebsite,
  SiteCostWebsiteDetail,
  SiteCostWebsitePage,
};

/** Result the worker stores on a finished `site_snapshot` job. */
export type SiteSnapshotJobResult = {
  snapshotId?: string;
  finalUrl?: string;
  skipped?: string;
  assetCount?: number;
  skippedAssetCount?: number;
  totalBytes?: number;
  brandSource?: 'llm' | 'evidence';
  warnings?: number;
};

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type UserRole = 'admin' | 'operator' | 'viewer';

export type User = {
  id: string;
  tenantId: string;
  email: string;
  name: string | null;
  role: UserRole;
  createdAt: string;
};

export type Website = {
  id: string;
  url: string;
  canonicalUrl: string | null;
  status: WebsiteStatus;
  language: string | null;
  finalUrl: string | null;
  httpStatus: number | null;
  title: string | null;
  latestAuditId: string | null;
  lastCheckedAt: string | null;
};

export type SourceRecord = {
  id: string;
  source: string;
  externalId: string | null;
  rawJson?: unknown;
  createdAt: string;
};

export type Company = {
  id: string;
  name: string;
  domain: string | null;
  country: string | null;
  city: string | null;
  phone: string | null;
  /** Primary contact email from the website copy brand extraction. */
  email: string | null;
  address: string | null;
  createdAt: string;
  updatedAt: string;
  website: Website | null;
  sourceRecords: SourceRecord[];
};

export type Lead = {
  id: string;
  tenantId: string;
  companyId: string;
  queue: LeadQueue;
  assistantVerdict: AssistantVerdict | null;
  assistantVendor: string | null;
  qualificationReason: string | null;
  latestAuditId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  company: Company;
};

export type QueueCounts = Record<LeadQueue, number> & { openReviewTasks: number };

export type ManualLeadResult = {
  skipped: boolean;
  created: boolean;
  duplicate: boolean;
  auditEnqueued: boolean;
  company: { id: string; name: string } | null;
  lead: { id: string; queue: LeadQueue } | null;
};

export type ReviewAudit = {
  id: string;
  method: AuditMethod;
  verdict: AssistantVerdict;
  kind: AssistantKind;
  vendor: string | null;
  confidence: number;
  classifierVersion: string;
  failureReason: string | null;
  finalUrl: string | null;
  auditedAt: string;
};

export type ReviewTask = {
  id: string;
  leadId: string;
  auditId: string;
  reason: string;
  status: 'open' | 'resolved';
  resolvedBy: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  lead: Omit<Lead, 'company'> & { company: Omit<Company, 'sourceRecords'> };
  audit: ReviewAudit;
};

export type ReviewAction = 'confirm_no_assistant' | 'mark_has_assistant' | 'request_reaudit';

export type QueuedJob = { id: string; status: JobStatus; type?: JobType; deduped?: boolean };

export type Job = {
  id: string;
  type: JobType;
  status: JobStatus;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  /** Website copy jobs: the copy with its GitHub push, Worker deploy and live URL. Older API versions omit it. */
  site?: SiteSnapshotSummary | null;
};

export type CountryDiscoveryResult = {
  country?: string;
  countryCode?: string;
  plannedTargets?: number;
  newTargets?: number;
  searches?: number;
  failedSearches?: number;
  calls?: number;
  callsToday?: number;
  found?: number;
  created?: number;
  duplicates?: number;
  auditsEnqueued?: number;
  noWebsite?: number;
  stoppedReason?: string;
};

export type DiscoveryOptions = {
  countries: Array<{ code: string; name: string; cities: string[] }>;
  industries: string[];
  defaults: { source: string; maxPages: number; timezone: string };
};

export type Schedule = {
  id: string;
  countryCode: string;
  country: string;
  time: string;
  timezone: string;
  nextRunAt: string;
  nextRunDay: string;
  lastRunAt: string | null;
  industries?: string[];
};

export type ScheduleGroup = {
  countryCode: string;
  country: string;
  timesPerDay: number;
  schedules: Schedule[];
};

export type ScheduleRun = {
  id: string;
  day: string;
  countryCode: string;
  country: string;
  time: string;
  timezone: string;
  trigger: 'schedule' | 'manual';
  status: JobStatus;
  found: number;
  saved: number;
  skipped: number;
  stoppedReason: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type CsvImportResult = {
  found: number;
  created: number;
  duplicates: number;
  skipped: number;
  auditsEnqueued: number;
  noWebsite: number;
};

export type StartedImport = {
  id: string;
  status: JobStatus;
  mode: 'inline' | 'queued';
  rows: number;
  result?: CsvImportResult;
};

export type SourceImport = {
  id: string;
  status: JobStatus;
  source: string;
  type: JobType;
  mode: string | null;
  rows: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string | null;
  result: Partial<CsvImportResult> | null;
  error: string | null;
};

type QueuedTypeCounts = Record<'website_audit' | 'country_discovery' | 'csv_import', number> & { site_snapshot?: number };

export type WorkerHealth = {
  running: boolean;
  status: 'online' | 'offline';
  message: string;
  lastSeenAt: string | null;
  secondsSinceLastSeen: number | null;
  staleAfterSeconds: number;
  workers: Array<{
    workerId: string;
    hostname: string | null;
    lastSeenAt: string;
    secondsSinceLastSeen: number;
    online: boolean;
  }>;
  jobs: { pending: QueuedTypeCounts; running: QueuedTypeCounts };
};

export type SystemHealth = {
  ok: boolean;
  db: string;
  tenantId: string;
  countries: string[];
};

export type ColdEmailStatus = 'draft' | 'queued' | 'sent' | 'failed' | 'suppressed';

export type ColdEmail = {
  id: string;
  tenantId: string;
  leadId: string | null;
  companyName: string;
  toEmail: string;
  deliveredTo: string | null;
  demoUrl: string | null;
  subject: string;
  status: ColdEmailStatus;
  resendId: string | null;
  error: string | null;
  sentAt: string | null;
  /** manual, auto (automation) or test (an allowlisted test inbox, not the lead). Older API versions omit it. */
  origin?: 'manual' | 'auto' | 'test';
  createdAt: string;
  updatedAt: string;
};

export type ColdEmailAutomation = {
  enabled: boolean;
  mode: 'draft' | 'send';
  dailyCap: number;
  enabledAt: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  usedToday: number;
  readyNow: number;
};

export type ColdEmailCandidate = {
  leadId: string;
  companyId: string;
  companyName: string;
  companyEmail: string | null;
  domain: string | null;
  demoUrl: string | null;
  botTrained: boolean;
  lastColdEmail: {
    id: string;
    status: ColdEmailStatus;
    sentAt: string | null;
    createdAt: string;
  } | null;
};

export type ColdEmailGate = {
  sendingEnabled: boolean;
  allowlist: string[];
  allowlistOpen: boolean;
  resendConfigured: boolean;
  from: string;
  isDevMode: boolean;
  devInboxes: string[];
};

export type ColdEmailPreview = {
  subject: string;
  text: string;
  html: string;
};

export type ColdEmailPage = {
  items: ColdEmail[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type ColdEmailCandidatePage = {
  items: ColdEmailCandidate[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type {
  CrawlPipelineSettingsUpdate,
  CrawlPipelineTrigger,
  CrawlPipelineSettingsView,
  CrawlPipelineProgressView,
  CrawlPipelineStatusView,
  FollowUpEmailPreviewView,
} from '@moncha/contracts';

export type IndustryItem = {
  id: string;
  name: string;
  slug: string;
  category: string;
  isDefault: boolean;
  isActive: boolean;
  isCustom?: boolean;
  tenantId?: string | null;
};
