import type { JobRunRecord, JobStatus } from './index';

export type SiteAssetKind = 'image' | 'css' | 'js' | 'font' | 'icon' | 'media' | 'manifest' | 'other';

export type SiteAssetSource = 'network' | 'html' | 'css';

export type SiteSkipReason =
  | 'tracking'
  | 'too_large'
  | 'limit_reached'
  | 'blocked_host'
  | 'http_4xx'
  | 'http_5xx'
  | 'timeout'
  | 'fetch_error'
  | 'blob_url'
  | 'iframe_embed'
  | 'unsupported_scheme';

export type SiteManifestAsset = {
  id: string;
  url: string;
  storedPath: string;
  contentType: string;
  bytes: number;
  sha256: string;
  kind: SiteAssetKind;
  discoveredBy: SiteAssetSource[];
};

export type SiteManifestSkipped = {
  url: string;
  reason: SiteSkipReason;
  detail?: string;
};

export type SiteManifestException = {
  file: string;
  kind: 'base_href_neutralized' | 'meta_csp_neutralized' | 'rewrite_skipped_utf16' | 'css_unparsable';
  detail?: string;
};

export type SiteManifest = {
  version: 1;
  snapshotId: string;
  sourceUrl: string;
  finalUrl: string;
  redirects: string[];
  capturedAt: string;
  source: { bytes: number; sha256: string; charset: string; charsetSource: CharsetSource };
  assets: SiteManifestAsset[];
  skipped: SiteManifestSkipped[];
  rewrites: { index: number; css: number; unresolved: number };
  exceptions: SiteManifestException[];
  limits: { maxAssets: number; maxFileBytes: number; maxTotalBytes: number };
};

export type CharsetSource = 'header' | 'bom' | 'meta' | 'default';

export type SiteBrand = {
  businessName: string | null;
  logo: { assetId: string } | null;
  colors: {
    primary: string | null;
    secondary: string | null;
    accent: string | null;
    background: string | null;
    text: string | null;
  };
  fonts: { heading: string | null; body: string | null };
  contact: { phones: string[]; emails: string[]; address: string | null; whatsapp: string | null };
  services: string[];
  hours: Array<{ days: string; opens: string; closes: string }>;
  hoursText: string | null;
  socialLinks: Array<{ platform: string; url: string }>;
  language: string | null;
  tone: string | null;
  chatbot: { greeting: string; faqs: Array<{ question: string; answer: string }> };
  confidence: number;
  notes: string | null;
  /** `llm` when Gemini produced it, `evidence` for the no-LLM fallback. */
  source: 'llm' | 'evidence';
};

export type SiteLogoCandidate = {
  /** Manifest asset id when the logo file was captured. */
  assetId?: string;
  url: string;
  alt?: string;
  width?: number;
  height?: number;
  inHeader: boolean;
  source: 'img' | 'svg' | 'icon' | 'apple-touch-icon' | 'og:image';
};

export type SiteEvidence = {
  title: string | null;
  description: string | null;
  lang: string | null;
  visibleText: string;
  meta: Record<string, string>;
  jsonLd: unknown[];
  links: { tel: string[]; mailto: string[]; whatsapp: string[]; social: string[] };
  colors: Array<{ value: string; usage: string; count: number }>;
  fonts: Array<{ family: string; usage: string }>;
  logoCandidates: SiteLogoCandidate[];
  /** Visible text length of the raw source vs the rendered DOM (JS-rendered site hint). */
  sourceTextLength: number;
  renderedTextLength: number;
};

export type SiteCapturedFile = { path: string; bytes: Uint8Array; contentType: string };

export type SiteCaptureResult = {
  sourceUrl: string;
  finalUrl: string;
  httpStatus: number;
  redirects: string[];
  source: { bytes: Uint8Array; sha256: string; charset: string; charsetSource: CharsetSource };
  renderedHtml: string;
  /** source.html with only asset URLs rewritten. */
  indexHtml: Uint8Array;
  /** Stored assets (CSS already rewritten), paths relative to the snapshot root. */
  files: SiteCapturedFile[];
  screenshots: {
    desktop?: Uint8Array;
    mobile?: Uint8Array;
    /** First-viewport JPEGs sent to the LLM. */
    desktopViewport?: Uint8Array;
    mobileViewport?: Uint8Array;
  };
  evidence: SiteEvidence;
  manifest: Omit<SiteManifest, 'snapshotId'>;
  warnings: string[];
};

export type SiteCaptureErrorCode =
  | 'blocked_host'
  | 'robots_disallowed'
  | 'blocked_or_captcha'
  | 'too_many_redirects'
  | 'not_html'
  | 'source_too_large'
  | 'fetch_failed'
  | 'timeout'
  | 'render_failed'
  | `http_${number}`;

/** Fatal capture failure; `code` becomes SiteSnapshot.failureReason. */
export class SiteCaptureError extends Error {
  constructor(
    readonly code: SiteCaptureErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'SiteCaptureError';
  }
}

export interface SiteCapturer {
  capture(input: { url: string; signal?: AbortSignal }): Promise<SiteCaptureResult>;
}

/** Daily LLM budget gate: checked before every call, recorded after every call (failed or not). */
export type LlmBudget = {
  allow(): Promise<boolean>;
  record(failed: boolean): Promise<void>;
};

export type BrandExtractionInput = {
  evidence: SiteEvidence;
  company: { name: string; domain?: string | null; phone?: string | null; address?: string | null; country?: string | null };
  screenshots: { desktopViewport?: Uint8Array; mobileViewport?: Uint8Array };
  budget?: LlmBudget;
};

/** Thrown by a BrandExtractor when no LLM call could be made or completed; the caller falls back to evidence. */
export class BrandExtractionError extends Error {
  constructor(
    readonly reason: 'budget_exhausted' | 'llm_failed' | 'invalid_output',
    message?: string,
    readonly usage: { promptTokens: number; completionTokens: number } = { promptTokens: 0, completionTokens: 0 },
  ) {
    super(message ?? reason);
    this.name = 'BrandExtractionError';
  }
}

export type BrandExtractionResult = {
  brand: SiteBrand;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
  warnings: string[];
};

export interface BrandExtractor {
  extract(input: BrandExtractionInput): Promise<BrandExtractionResult>;
}

export type SiteStoreObject = {
  body: AsyncIterable<Uint8Array>;
  contentType: string;
  contentLength?: number;
};

export interface SiteStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<SiteStoreObject | null>;
  getBytes(key: string): Promise<Uint8Array | null>;
}

export type SiteSnapshotRecord = {
  id: string;
  tenantId: string;
  leadId: string;
  jobId: string | null;
  status: JobStatus;
  sourceUrl: string;
  finalUrl: string | null;
  httpStatus: number | null;
  storagePrefix: string;
  sourceHash: string | null;
  sourceBytes: number | null;
  sourceCharset: string | null;
  assetCount: number;
  skippedAssetCount: number;
  totalBytes: number;
  brand: SiteBrand | null;
  llmModel: string | null;
  llmPromptTokens: number | null;
  llmCompletionTokens: number | null;
  warnings: string[];
  failureReason: string | null;
  origin: SiteCopyOrigin;
  crawlJobId: string | null;
  githubStatus: SiteGithubStatus | null;
  githubAttempts: number;
  githubNextAt: Date | null;
  githubCommitSha: string | null;
  githubCommitUrl: string | null;
  githubFolderUrl: string | null;
  githubError: string | null;
  githubPushedAt: Date | null;
  createdAt: Date;
  finishedAt: Date | null;
};

/** manual = started from the console; auto = queued by the copy automation after a crawl. */
export type SiteCopyOrigin = 'manual' | 'auto';

/**
 * GitHub push of a finished copy's code files. `pending` waits for the worker (first try or a retry
 * after an error), `pushing` is in progress, `failed` means the worker gave up until someone retries.
 */
export type SiteGithubStatus = 'pending' | 'pushing' | 'pushed' | 'failed';

export type SiteSnapshotListItem = SiteSnapshotRecord & {
  company: { id: string; name: string; domain: string | null };
};

/** A pending or running copy with the job fields needed to show its place in the queue. */
export type SiteQueueEntry = SiteSnapshotListItem & {
  job: {
    id: string;
    status: JobStatus;
    attempts: number;
    maxAttempts: number;
    runAfter: Date;
    lockedAt: Date | null;
    startedAt: Date | null;
    lastError: string | null;
    createdAt: Date;
  } | null;
};

export type SiteCancelResult = 'cancelled' | 'not_found' | 'not_pending';

export type SiteSnapshotPatch = Partial<
  Pick<
    SiteSnapshotRecord,
    | 'status'
    | 'finalUrl'
    | 'httpStatus'
    | 'sourceHash'
    | 'sourceBytes'
    | 'sourceCharset'
    | 'assetCount'
    | 'skippedAssetCount'
    | 'totalBytes'
    | 'brand'
    | 'llmModel'
    | 'llmPromptTokens'
    | 'llmCompletionTokens'
    | 'warnings'
    | 'failureReason'
    | 'finishedAt'
    | 'githubStatus'
    | 'githubAttempts'
    | 'githubNextAt'
    | 'githubCommitSha'
    | 'githubCommitUrl'
    | 'githubFolderUrl'
    | 'githubError'
    | 'githubPushedAt'
  >
> & { githubLockedAt?: Date | null };

export type SiteGithubRequestResult = 'queued' | 'not_found' | 'not_done' | 'busy';

export type SiteSnapshotListQuery = {
  page?: number;
  pageSize?: number;
  status?: JobStatus;
  search?: string;
  origin?: SiteCopyOrigin;
};

export interface SiteSnapshotRepo {
  /** Creates the snapshot (pending) and its site_snapshot JobRun in one transaction. */
  createWithJob(input: {
    tenantId: string;
    leadId: string;
    sourceUrl: string;
    maxAttempts: number;
    origin?: SiteCopyOrigin;
    crawlJobId?: string | null;
    /** Defaults to a unique key per call; automatic copies pass one key per lead so a lead is never queued twice. */
    dedupeKey?: string;
  }): Promise<{ snapshot: SiteSnapshotRecord; job: JobRunRecord }>;
  get(tenantId: string, id: string): Promise<SiteSnapshotListItem | null>;
  update(tenantId: string, id: string, patch: SiteSnapshotPatch): Promise<SiteSnapshotRecord | null>;
  /** Pending or running snapshot for the lead, newest first. */
  findOpenForLead(tenantId: string, leadId: string): Promise<SiteSnapshotRecord | null>;
  listForLead(tenantId: string, leadId: string, limit: number): Promise<SiteSnapshotRecord[]>;
  list(
    tenantId: string,
    query: SiteSnapshotListQuery,
  ): Promise<{ items: SiteSnapshotListItem[]; total: number; page: number; pageSize: number; totalPages: number }>;
  /** Pending and running copies in the order the worker claims them (runAfter, then createdAt). */
  queue(tenantId: string): Promise<SiteQueueEntry[]>;
  /** Cancels a copy that has not started yet: its job and the snapshot both become failed with reason `cancelled`. */
  cancel(tenantId: string, id: string, at: Date): Promise<SiteCancelResult>;
  /** Mean run time of the most recent finished copies, or null when there are none. */
  averageRunMs(tenantId: string, sample: number): Promise<number | null>;
  /**
   * Atomically takes the next copy whose GitHub push is due (any tenant): `pending` with `githubNextAt`
   * at or before `now`, or `pushing` locked before `staleBefore`. It becomes `pushing` with one more attempt.
   */
  claimGithubPush(now: Date, staleBefore: Date): Promise<SiteSnapshotListItem | null>;
  /** Queues a push of a done copy now (first push, or again after `failed` or `pushed`). */
  requestGithubPush(tenantId: string, id: string, now: Date): Promise<SiteGithubRequestResult>;
}

export type SiteGithubFile = { path: string; bytes: Uint8Array };

export type SiteGithubPublishResult = { commitSha: string; commitUrl: string; folderUrl: string };

/** Pushes one folder of files to a git repo as a single commit. */
export interface SiteGithubPublisher {
  readonly repo: string;
  readonly branch: string;
  publish(input: { folder: string; files: SiteGithubFile[]; message: string; signal?: AbortSignal }): Promise<SiteGithubPublishResult>;
}

/** `retryable` is false when trying again cannot help without someone changing something (e.g. the copy's files are gone). */
export class SiteGithubError extends Error {
  constructor(
    readonly code: string,
    message?: string,
    readonly retryable = true,
  ) {
    super(message ?? code);
    this.name = 'SiteGithubError';
  }
}

export function siteStoragePrefix(tenantId: string, snapshotId: string): string {
  return `sites/${tenantId}/${snapshotId}/`;
}

export type SiteSnapshotJobPayload = {
  snapshotId: string;
  leadId: string;
  url: string;
  origin?: SiteCopyOrigin;
  crawlJobId?: string;
};

export type SiteAutomationSettingsRecord = {
  tenantId: string;
  enabled: boolean;
  dailyCap: number;
  enabledAt: Date | null;
  updatedBy: string | null;
  updatedAt: Date | null;
};

export type SiteAutomationCrawlStatus = 'waiting_audits' | 'queuing' | 'complete';

export type SiteAutomationCrawlRecord = {
  crawlJobId: string;
  tenantId: string;
  status: SiteAutomationCrawlStatus;
  auditsTotal: number;
  auditsPending: number;
  qualified: number;
  queued: number;
  carriedOver: number;
  crawlFinishedAt: Date;
  lastCheckedAt: Date;
  completedAt: Date | null;
};

export type SiteAutomationCrawlPatch = Partial<
  Pick<
    SiteAutomationCrawlRecord,
    'status' | 'auditsTotal' | 'auditsPending' | 'qualified' | 'queued' | 'carriedOver' | 'lastCheckedAt' | 'completedAt'
  >
>;

/** A qualified lead from a crawl that has never had a website copy. */
export type SiteAutomationCandidate = {
  leadId: string;
  websiteUrl: string | null;
  websiteFinalUrl: string | null;
  domain: string | null;
};

export type SiteAutomationCrawlListItem = SiteAutomationCrawlRecord & {
  country: string | null;
  countryCode: string | null;
  trigger: 'schedule' | 'manual';
  crawlStatus: JobStatus;
  leadsCreated: number;
  auditsEnqueued: number;
  /** Copies from this crawl by current status. */
  copies: { pending: number; running: number; done: number; failed: number };
};

export interface SiteAutomationRepo {
  /** Stored settings, or the defaults (off, cap 20) when the tenant has none. */
  getSettings(tenantId: string): Promise<SiteAutomationSettingsRecord>;
  /** Saves settings; `enabledAt` is set to `at` whenever automation goes from off to on. */
  saveSettings(
    tenantId: string,
    patch: { enabled?: boolean; dailyCap?: number; updatedBy?: string | null },
    at: Date,
  ): Promise<SiteAutomationSettingsRecord>;
  listEnabled(): Promise<SiteAutomationSettingsRecord[]>;
  /** Starts tracking done or failed country crawls that finished at or after `since`. Returns how many were added. */
  trackFinishedCrawls(tenantId: string, since: Date): Promise<number>;
  /** Tracked crawls that are not complete, oldest finish first. */
  listOpenCrawls(tenantId: string): Promise<SiteAutomationCrawlRecord[]>;
  updateCrawl(crawlJobId: string, patch: SiteAutomationCrawlPatch): Promise<void>;
  auditCounts(tenantId: string, crawlJobId: string): Promise<{ total: number; pending: number }>;
  /** Qualified leads audited for this crawl with no website copy at all, oldest lead first. */
  candidates(tenantId: string, crawlJobId: string): Promise<SiteAutomationCandidate[]>;
  /** Automatic copies created at or after `since`. */
  countAutoSince(tenantId: string, since: Date): Promise<number>;
  listCrawls(tenantId: string, limit: number): Promise<SiteAutomationCrawlListItem[]>;
  getCrawls(tenantId: string, crawlJobIds: string[]): Promise<SiteAutomationCrawlRecord[]>;
}
