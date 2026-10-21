import { z } from 'zod';

export const websiteStatusSchema = z.enum([
  'UNCHECKED',
  'ACTIVE',
  'INACTIVE',
  'PARKED',
  'INACCESSIBLE',
  'MISSING',
]);

export const assistantVerdictSchema = z.enum([
  'NO_ASSISTANT',
  'HAS_ASSISTANT',
  'UNCERTAIN',
  'NOT_APPLICABLE',
]);

export const assistantKindSchema = z.enum(['AI_CHATBOT', 'LIVE_CHAT', 'MESSAGING_LINK', 'NONE']);

export const leadQueueSchema = z.enum([
  'PENDING_AUDIT',
  'QUALIFIED',
  'HAS_ASSISTANT',
  'NO_WEBSITE',
  'NEEDS_REVIEW',
  'INACTIVE',
]);

export const auditMethodSchema = z.enum(['html', 'render', 'llm']);

export const evidenceTypeSchema = z.enum([
  'script_src',
  'iframe_src',
  'dom_selector',
  'network_request',
  'window_global',
  'screenshot',
  'page_excerpt',
  'llm_reason',
]);

export const channelTypeSchema = z.enum([
  'whatsapp',
  'messenger',
  'telegram',
  'line',
  'viber',
  'contact_form',
  'booking_link',
  'tel',
  'email',
]);

export const reviewTaskStatusSchema = z.enum(['open', 'resolved']);

export const liveDiscoverySourceSchema = z.enum([
  'google_places',
  'yelp',
  'foursquare',
  'search',
  'all',
]);

export const discoverPlacesSchema = z.object({
  source: liveDiscoverySourceSchema,
  country: z.string().trim().min(1),
  city: z.string().trim().min(1),
  keyword: z.string().trim().min(1),
});

export const csvRecordSchema = z.object({
  name: z.string().trim().min(1),
  domain: z.string().trim().optional(),
  website: z.string().trim().optional(),
  country: z.string().trim().optional(),
  city: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
});

export const discoverCsvSchema = z.object({
  source: z.literal('csv'),
  csv: z.string().min(1).optional(),
  records: z.array(csvRecordSchema).optional(),
});

export const sourceImportSchema = z
  .union([discoverPlacesSchema, discoverCsvSchema])
  .superRefine((value, ctx) => {
    if (value.source === 'csv' && !value.csv && !(value.records && value.records.length > 0)) {
      ctx.addIssue({ code: 'custom', message: 'CSV import requires csv text or records', path: ['csv'] });
    }
  });

export const discoverSchema = discoverPlacesSchema;

/** Country-wide crawl (worker): every city × industry in the country. City/keyword are not inputs. */
export const countryDiscoverySchema = z.object({
  country: z.string().trim().min(1),
  source: z.literal('google_places').default('google_places'),
  /** Optional subset of the country's search areas; default is all of them. */
  cities: z.array(z.string().trim().min(1)).min(1).optional(),
  /** Optional industry list; default is the built-in list. */
  industries: z.array(z.string().trim().min(1)).min(1).optional(),
  maxPages: z.coerce.number().int().min(1).max(3).default(3),
  maxSearches: z.coerce.number().int().min(1).optional(),
  maxCallsPerDay: z.coerce.number().int().min(1).optional(),
  reset: z.boolean().default(false),
});

/** Daily discovery schedule: run a slice of the country crawl every day at `time` in `timezone`. */
export const scheduleCreateSchema = z.object({
  country: z.string().trim().min(1),
  time: z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:mm'),
  /** IANA zone; the server defaults to Asia/Kuala_Lumpur. */
  timezone: z.string().trim().min(1).optional(),
});

export const scheduleDeleteCountrySchema = z.object({
  country: z.string().trim().min(1),
});

export const scheduleRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const manualLeadSchema = z.object({
  name: z.string().trim().min(1),
  domain: z.string().trim().optional(),
  country: z.string().trim().optional(),
  city: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
});

export const leadListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).optional(),
  country: z.string().trim().min(1).optional(),
  /** `ALL` lists every queue; omitted still means QUALIFIED. */
  queue: z
    .union([leadQueueSchema, z.literal('ALL')])
    .default('QUALIFIED')
    .transform((queue) => (queue === 'ALL' ? undefined : queue)),
  assistantVerdict: assistantVerdictSchema.optional(),
  vendor: z.string().trim().min(1).optional(),
  method: auditMethodSchema.optional(),
});

/** `GET /api/v1/leads/export`: the list filters without paging; the CSV holds every matching lead. */
export const leadExportQuerySchema = leadListQuerySchema.pick({ search: true, country: true, queue: true });

export const jobTypeSchema = z.enum([
  'places_discovery',
  'csv_import',
  'website_audit',
  'country_discovery',
  'site_snapshot',
]);

export const jobStatusSchema = z.enum(['pending', 'running', 'done', 'failed']);

/** Who started a website copy: by hand from the console, or the copy automation after a crawl. */
export const siteCopyOriginSchema = z.enum(['manual', 'auto']);

/**
 * Where a website copy is on the way to its live URL: `live` (deployed), `problem` (a step failed or is retrying
 * after an error), `in_progress` (copying, pushing or deploying), `not_deployed` (copy done, never deployed).
 */
export const siteDeployFilterSchema = z.enum(['live', 'in_progress', 'problem', 'not_deployed']);

export const jobListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  type: jobTypeSchema.optional(),
  status: jobStatusSchema.optional(),
  /** Website copy jobs only. */
  origin: siteCopyOriginSchema.optional(),
  /** Website copy jobs only. */
  deploy: siteDeployFilterSchema.optional(),
});

export const enqueueAuditSchema = z.object({
  force: z.boolean().optional(),
});

export const resolveReviewSchema = z.object({
  action: z.enum(['confirm_no_assistant', 'mark_has_assistant', 'request_reaudit']),
  note: z.string().trim().min(1),
  vendor: z.string().trim().min(1).optional(),
});

export const reviewListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  /** `all` lists open and resolved tasks; omitted means open. */
  status: z
    .enum(['open', 'resolved', 'all'])
    .default('open')
    .transform((status) => (status === 'all' ? undefined : status)),
  search: z.string().trim().min(1).optional(),
  country: z.string().trim().min(1).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
});

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8, 'Use at least 8 characters').max(128),
  name: z.string().trim().min(1).max(100).optional(),
});

export const passwordLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
});

const newPasswordSchema = z.string().min(8, 'Use at least 8 characters').max(128);

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(16).max(256),
  password: newPasswordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: newPasswordSchema,
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const llmAssistantOutputSchema = z.object({
  hasConversationalAssistant: z.enum(['yes', 'no', 'unsure']),
  kind: assistantKindSchema,
  vendor: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()).max(5),
  evidenceRefs: z.array(z.string()),
});

const hexColorSchema = z
  .string()
  .trim()
  .transform((v) => v.toLowerCase())
  .pipe(z.string().regex(/^#[0-9a-f]{6}$/));

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const nullableHex = hexColorSchema.nullish().catch(null).transform((v) => v ?? null);

/** Brand details for one website copy (Gemini output, validated). Gemini never returns HTML. */
export const siteBrandSchema = z.object({
  businessName: nullableText(200),
  logo: z
    .object({ assetId: z.string().trim().min(1).max(64) })
    .nullish()
    .transform((v) => v ?? null),
  colors: z
    .object({
      primary: nullableHex,
      secondary: nullableHex,
      accent: nullableHex,
      background: nullableHex,
      text: nullableHex,
    })
    .default({ primary: null, secondary: null, accent: null, background: null, text: null }),
  fonts: z
    .object({ heading: nullableText(100), body: nullableText(100) })
    .default({ heading: null, body: null }),
  contact: z
    .object({
      phones: z.array(z.string().trim().min(1).max(50)).max(5).default([]),
      emails: z.array(z.string().trim().min(3).max(254)).max(5).default([]),
      address: nullableText(300),
      whatsapp: nullableText(200),
    })
    .default({ phones: [], emails: [], address: null, whatsapp: null }),
  services: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  hours: z
    .array(
      z.object({
        days: z.string().trim().min(1).max(60),
        opens: z.string().trim().min(1).max(20),
        closes: z.string().trim().min(1).max(20),
      }),
    )
    .max(14)
    .default([]),
  hoursText: nullableText(300),
  socialLinks: z
    .array(z.object({ platform: z.string().trim().min(1).max(40), url: z.string().trim().min(1).max(500) }))
    .max(12)
    .default([]),
  language: nullableText(20),
  tone: nullableText(200),
  chatbot: z.object({
    greeting: z.string().trim().min(1).max(300),
    faqs: z
      .array(z.object({ question: z.string().trim().min(1).max(200), answer: z.string().trim().min(1).max(600) }))
      .max(8)
      .default([]),
  }),
  confidence: z.coerce.number().min(0).max(1).catch(0.5),
  notes: nullableText(500),
  source: z.enum(['llm', 'evidence']).default('llm'),
});

export const siteSnapshotListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: jobStatusSchema.optional(),
  search: z.string().trim().min(1).optional(),
  origin: siteCopyOriginSchema.optional(),
});

export const leadBotStatusSchema = z.enum(['pending', 'creating', 'created', 'failed']);
export const leadBotKnowledgeStatusSchema = z.enum(['pending', 'discovering', 'training', 'trained', 'failed']);

export const leadBotListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: leadBotStatusSchema.optional(),
  knowledgeStatus: leadBotKnowledgeStatusSchema.optional(),
});

/** `GET /api/v1/moncha/bots`: one page of MonCha's GET /bots, after `cursor` (a MonCha bot id). */
export const monchaBotListQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const siteAutomationUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    dailyCap: z.number().int().min(0).max(500).optional(),
  })
  .refine((v) => v.enabled !== undefined || v.dailyCap !== undefined, { message: 'Nothing to update' });

/** Operator drain pause for bots + website pipeline. Discovery schedules keep running. */
export const workerQueueUpdateSchema = z.object({
  paused: z.boolean(),
});

export const siteAutomationCrawlsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Costs window in days back from today (UTC); omitted = all time. */
export const siteCostSummaryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
});

export const siteCostSortSchema = z.enum(['cost', 'tokens', 'newest', 'size']);

export const siteCostWebsitesQuerySchema = siteCostSummaryQuerySchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).optional(),
  sort: siteCostSortSchema.default('cost'),
});

/** Derived: a lead is qualified iff its queue is QUALIFIED. */
export function isLeadQualified(queue: z.infer<typeof leadQueueSchema>): boolean {
  return queue === 'QUALIFIED';
}

export type WebsiteStatus = z.infer<typeof websiteStatusSchema>;
export type AssistantVerdict = z.infer<typeof assistantVerdictSchema>;
export type AssistantKind = z.infer<typeof assistantKindSchema>;
export type LeadQueue = z.infer<typeof leadQueueSchema>;
export type AuditMethod = z.infer<typeof auditMethodSchema>;
export type EvidenceType = z.infer<typeof evidenceTypeSchema>;
export type ChannelType = z.infer<typeof channelTypeSchema>;
export type DiscoverInput = z.infer<typeof discoverPlacesSchema>;
export type SourceImportInput = z.infer<typeof sourceImportSchema>;
export type CountryDiscoveryRequest = z.infer<typeof countryDiscoverySchema>;
export type ScheduleCreateRequest = z.infer<typeof scheduleCreateSchema>;
export type ScheduleRunsQuery = z.infer<typeof scheduleRunsQuerySchema>;
export type ManualLeadInput = z.infer<typeof manualLeadSchema>;
export type LeadListQueryInput = z.infer<typeof leadListQuerySchema>;
export type JobType = z.infer<typeof jobTypeSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type JobListQuery = z.infer<typeof jobListQuerySchema>;
export type SiteDeployFilter = z.infer<typeof siteDeployFilterSchema>;
export type ResolveReviewInput = z.infer<typeof resolveReviewSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type PasswordLoginInput = z.infer<typeof passwordLoginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type LlmAssistantOutput = z.infer<typeof llmAssistantOutputSchema>;
export type SiteBrand = z.infer<typeof siteBrandSchema>;
export type SiteSnapshotListQuery = z.infer<typeof siteSnapshotListQuerySchema>;
export type SiteCopyOrigin = z.infer<typeof siteCopyOriginSchema>;
export type SiteAutomationUpdate = z.infer<typeof siteAutomationUpdateSchema>;
export type WorkerQueueUpdate = z.infer<typeof workerQueueUpdateSchema>;
export type SiteAutomationCrawlsQuery = z.infer<typeof siteAutomationCrawlsQuerySchema>;

/** `GET/PUT /api/v1/queue`: worker-wide drain pause. */
export type WorkerQueueState = {
  paused: boolean;
  pausedAt: string | null;
  pausedBy: string | null;
  updatedAt: string | null;
};
export type SiteCostSort = z.infer<typeof siteCostSortSchema>;
export type SiteCostWebsitesQuery = z.infer<typeof siteCostWebsitesQuerySchema>;

export type SiteAssetKind = 'image' | 'css' | 'js' | 'font' | 'icon' | 'media' | 'manifest' | 'other';

export type SiteManifestAsset = {
  id: string;
  url: string;
  storedPath: string;
  contentType: string;
  bytes: number;
  sha256: string;
  kind: SiteAssetKind;
  discoveredBy: Array<'network' | 'html' | 'css'>;
};

export type SiteManifestSkipped = { url: string; reason: string; detail?: string };

export type SiteManifestException = { file: string; kind: string; detail?: string };

export type SiteManifest = {
  version: 1;
  snapshotId: string;
  sourceUrl: string;
  finalUrl: string;
  redirects: string[];
  capturedAt: string;
  source: { bytes: number; sha256: string; charset: string; charsetSource: string };
  assets: SiteManifestAsset[];
  skipped: SiteManifestSkipped[];
  rewrites: { index: number; css: number; unresolved: number };
  exceptions: SiteManifestException[];
  limits: { maxAssets: number; maxFileBytes: number; maxTotalBytes: number };
};

/** API shape of one snapshot row (dates as ISO strings). */
export type SiteSnapshotSummary = {
  id: string;
  leadId: string;
  jobId: string | null;
  status: JobStatus;
  sourceUrl: string;
  finalUrl: string | null;
  httpStatus: number | null;
  sourceHash: string | null;
  sourceBytes: number | null;
  sourceCharset: string | null;
  assetCount: number;
  skippedAssetCount: number;
  totalBytes: number;
  llmModel: string | null;
  llmPromptTokens: number | null;
  llmCompletionTokens: number | null;
  /** USD OpenRouter reported for this copy's AI calls; null = not reported (see the Costs API for an estimate). Older API versions omit it. */
  llmCostUsd?: number | null;
  warnings: string[];
  failureReason: string | null;
  /** The error message behind `failureReason`, e.g. "fetch failed: getaddrinfo ENOTFOUND example.com". Older API versions omit it. */
  failureDetail?: string | null;
  /** Copy attempts made so far. Older API versions omit it. */
  attempts?: number;
  /** Older API versions omit it; treat missing as `manual`. */
  origin?: SiteCopyOrigin;
  /** Country crawl that queued an automatic copy. */
  crawlJobId?: string | null;
  createdAt: string;
  finishedAt: string | null;
  company?: { id: string; name: string; domain: string | null };
  /** Proxy-relative path (`site-files/<token>/screenshot-desktop.png`) once done. */
  thumbnailPath: string | null;
  /**
   * The website's name, e.g. `ja-edu-sg` for ja.edu.sg: the name of its GitHub repo and Cloudflare Worker.
   * Older API versions omit it.
   */
  siteName?: string;
  /** Push to the website's own GitHub repo; null when never queued. Older API versions omit it. */
  github?: SiteGithubPush | null;
  /** Deploy to the website's own Cloudflare Worker; null when never queued. Older API versions omit it. */
  deploy?: SiteWorkerDeploy | null;
  /** MonCha chatbot added to index.html before the GitHub push; null when never queued. Older API versions omit it. */
  chatbot?: SiteChatbotInstall | null;
  /**
   * Public link once done: the Worker URL (`https://{siteName}.{subdomain}.workers.dev`) when deployed, else the older
   * shared Pages link when the worker has SITE_PUBLIC_BASE_URL; null otherwise. Older API versions omit it.
   */
  publicUrl?: string | null;
  /** Step-by-step progress from the queue to the live URL. Older API versions omit it. */
  progress?: SiteCopyProgress;
};

/**
 * Ordered steps of a website copy: queued, copying the website, reading its source code, building the files, adding
 * the MonCha chatbot, updating its GitHub repo, deploying its Worker URL, live. The Worker deploy starts only after
 * the GitHub push. `adding_chatbot` is new; older API versions never return it.
 */
export type SiteCopyStep =
  | 'queued'
  | 'copying'
  | 'reading_source'
  | 'building'
  | 'adding_chatbot'
  | 'updating_git'
  | 'deploying_url'
  | 'live';

/**
 * not_started = not reached yet (or never queued), waiting = queued for its turn, active = running now,
 * retrying = waiting to try again after an error, failed = stopped until someone retries, done = finished.
 */
export type SiteCopyStepState = 'not_started' | 'waiting' | 'active' | 'retrying' | 'failed' | 'done';

export type SiteCopyProgress = {
  /** First step that is not done; the last step once everything is done. */
  step: SiteCopyStep;
  state: SiteCopyStepState;
  /** Error behind a retrying or failed step. */
  error: string | null;
  /** When the current step started, or when the last step finished. */
  since: string | null;
  /** Next try of a waiting or retrying GitHub push or Worker deploy. */
  nextAt: string | null;
  /** GitHub and Worker steps are listed only when configured or already used by this copy. */
  steps: Array<{ step: SiteCopyStep; state: SiteCopyStepState }>;
};

/** Same lifecycle as SiteGithubStatus: pending, deploying, deployed, or failed after repeated errors. */
export type SiteWorkerStatus = 'pending' | 'deploying' | 'deployed' | 'failed';

/** Same lifecycle as SiteGithubStatus: pending, installing, installed, or failed after repeated errors. */
export type SiteChatbotStatus = 'pending' | 'installing' | 'installed' | 'failed';

/** The lead's MonCha chatbot on this copy: widget colour set (PUT widget) and the embed added to index.html. */
export type SiteChatbotInstall = {
  status: SiteChatbotStatus;
  attempts: number;
  maxAttempts: number;
  /** Next try while `pending`. */
  nextAt: string | null;
  /** Last error, `code: message`; `waiting_for_bot: …` while the lead's bot is still being trained. */
  error: string | null;
  installedAt: string | null;
};

export type SiteWorkerDeploy = {
  status: SiteWorkerStatus;
  attempts: number;
  maxAttempts: number;
  /** Next try while `pending`. */
  nextAt: string | null;
  /** Worker script name (the site name). */
  name: string | null;
  /** `https://{name}.{subdomain}.workers.dev` once deployed. */
  url: string | null;
  /** Last Cloudflare error; kept while a retry is waiting. */
  error: string | null;
  deployedAt: string | null;
  /**
   * MonCha widget allowed hostnames (PUT domains 6.2) for this lead's bot, filled after deploy.
   * Older API versions and list endpoints may omit it.
   */
  domains?: string[] | null;
  domainsConfiguredAt?: string | null;
};

/**
 * pending = waiting for the worker (first try or a retry after `error`), pushing = in progress,
 * pushed = committed, failed = gave up after repeated errors until someone retries.
 */
export type SiteGithubStatus = 'pending' | 'pushing' | 'pushed' | 'failed';

export type SiteGithubPush = {
  status: SiteGithubStatus;
  attempts: number;
  maxAttempts: number;
  /** Next try while `pending`. */
  nextAt: string | null;
  commitSha: string | null;
  commitUrl: string | null;
  /** The website's repo page (`https://github.com/{owner}/{siteName}`); older copies point at a folder of the shared repo. */
  folderUrl: string | null;
  /** `owner/name` of the website's own repo once pushed. Older API versions omit it. */
  repo?: string | null;
  /** Last GitHub error; kept while a retry is waiting. */
  error: string | null;
  pushedAt: string | null;
};

export type SiteSnapshotFiles = {
  index: string;
  /** Widget demo page; only older API versions return it. */
  demo?: string;
  source: string;
  rendered: string;
  desktop: string;
  mobile: string;
};

export type SiteSnapshotDetail = SiteSnapshotSummary & {
  brand: SiteBrand | null;
  previewBase: string | null;
  files: SiteSnapshotFiles | null;
  manifest: SiteManifest | null;
  /** The worker has a GitHub token and owner, so copies can be pushed. */
  githubConfigured?: boolean;
  /** Where this website's repo lives (or will live): `owner/siteName`. */
  githubRepo?: string | null;
  /** The worker has Cloudflare credentials, so copies can be deployed as Workers. Older API versions omit it. */
  deployConfigured?: boolean;
};

/** `GET /api/v1/site-automation/github-check`: GitHub connectivity. Key presence only, never values. */
export type SiteGithubCheckResult = {
  configured: boolean;
  keys: { GITHUB_TOKEN: boolean; GITHUB_SITES_REPO: boolean; GITHUB_SITES_BRANCH: boolean; GITHUB_SITES_OWNER?: boolean };
  /** `owner/{site}`: one private repo per website. */
  repo: string | null;
  branch: string | null;
  /** Site repos are always created private. */
  private: boolean | null;
  canPush: boolean | null;
  /** The token is valid and can see the owner. */
  canRead: boolean;
  canWrite: boolean;
  branchHead: string | null;
  /** Where each website goes: `{owner}/{siteName}` (one repo per website). */
  folderPattern: string;
  /** Account that owns the site repos. Older API versions omit it. */
  owner?: string | null;
  /** Login the token belongs to. */
  login?: string | null;
  ownerType?: 'user' | 'org' | null;
  error: string | null;
  checkedAt: string;
};

/** `GET /api/v1/site-automation/deploy-check`: Cloudflare Workers connectivity. Key presence only, never values. */
export type SiteDeployCheckResult = {
  configured: boolean;
  keys: { CLOUDFLARE_API_TOKEN: boolean; CLOUDFLARE_ACCOUNT_ID: boolean; R2_ACCOUNT_ID: boolean };
  /** `{subdomain}.workers.dev` of the account. */
  subdomain: string | null;
  /** `https://{siteName}.{subdomain}.workers.dev` */
  urlPattern: string | null;
  canRead: boolean;
  /** Site Workers already deployed. */
  siteWorkers: number | null;
  /** All Workers on the account; the plan limit (100 free, 500 paid) counts these. */
  totalWorkers: number | null;
  /** The Worker limit the worker deploys up to (CLOUDFLARE_WORKERS_LIMIT, default 100). Older API versions omit it. */
  workerLimit?: number | null;
  error: string | null;
  checkedAt: string;
};

export type MonchaSlotTier = 'starter' | 'growth' | 'scale';

/** `GET /api/v1/site-automation/moncha-check`: MonCha internal lead API connectivity. Key presence only, never values. */
export type MonchaInternalCheckResult = {
  configured: boolean;
  keys: { MONCHA_INTERNAL_BASE_URL: boolean; MONCHA_INTERNAL_KEY: boolean };
  /** `uat` and `production` are the two documented base URLs; anything else is `custom`. */
  environment: 'uat' | 'production' | 'custom' | null;
  baseUrl: string | null;
  /** `GET /slots` succeeded with the key. */
  canAuthenticate: boolean;
  slots: Record<MonchaSlotTier, { allocated: number; used: number; available: number }> | null;
  error: string | null;
  requestId: string | null;
  checkedAt: string;
};

export type LeadBotStatus = z.infer<typeof leadBotStatusSchema>;
export type LeadBotKnowledgeStatus = z.infer<typeof leadBotKnowledgeStatusSchema>;

/** One MonCha demo bot (GET /bots) with the lead we made it for, when it is ours. */
export type MonchaBotView = {
  botId: string;
  name: string;
  planTier: string | null;
  isActive: boolean;
  /** Set by POST /bots/:botId/deactivate (paused); null when not paused. */
  deactivatedAt: string | null;
  /** Holds a plan slot and is not paused (POST /bots/:botId/deactivate makes it false). */
  live: boolean;
  createdAt: string | null;
  /** Plan-tier quotas; -1 means unlimited. */
  limits: { messages: number | null; pages: number | null; voiceMinutes: number | null };
  /** Messages and voice minutes in the current monthly window; pages = total trained pages. */
  usage: { messages: number; pages: number; voiceMinutes: number };
  /** Knowledge documents queued or processing / failed in MonCha. */
  training: { pending: number; failed: number };
  /** Null when no lead bot of ours has this MonCha bot id. */
  lead: {
    leadId: string;
    company: { id: string; name: string; domain: string | null };
    status: LeadBotStatus;
    knowledgeStatus: LeadBotKnowledgeStatus;
    liveUrl: string | null;
    chatbotInstalled: boolean;
  } | null;
};

/** `GET /api/v1/moncha/bots`. Pass `nextCursor` back as `cursor`; null on the last page. */
export type MonchaBotPage = {
  items: MonchaBotView[];
  total: number | null;
  nextCursor: string | null;
  limit: number;
};

/** Training of the bot on the lead's website: knowledge/discover, knowledge/ingest-bulk, training status. */
export type LeadBotKnowledgeView = {
  status: LeadBotKnowledgeStatus;
  attempts: number;
  maxAttempts: number;
  /** Next try, or next training status poll. */
  nextAt: string | null;
  websiteUrl: string | null;
  /** `urls` of knowledge/discover. */
  discoveredUrls: string[] | null;
  pagesFetched: number | null;
  truncated: boolean | null;
  discoveredAt: string | null;
  /** The ingest-bulk documents (title, url, source_type). */
  documents: Array<{ title: string; url: string; source_type: string }> | null;
  trainingKey: string | null;
  trainingId: string | null;
  /** The latest training status response. */
  trainingResult: unknown;
  submittedAt: string | null;
  trainedAt: string | null;
};

/** The widget of the lead's bot as the website chatbot step set it (GET widget, PUT widget, GET install, PUT domains). */
export type LeadBotWidgetView = {
  /** primaryColor picked from the website's brand colours; every other widget field is kept as it was. */
  primaryColor: string | null;
  /** GET widget response before the change. */
  configBefore: unknown;
  /** PUT widget response after it. */
  config: unknown;
  /** GET install response: tenantId, chatbotId, apiUrl, widgetUrl (public values; never the internal key). */
  install: unknown;
  configuredAt: string | null;
  /** Hostnames from PUT /bots/:botId/domains (6.2), usually the live Worker hostname. Older API versions omit it. */
  domains?: string[] | null;
  domainsConfiguredAt?: string | null;
};

/** A lead's MonCha demo bot (`GET /api/v1/leads/:id/bot`). Created before the lead's website is copied. */
export type LeadBotView = {
  id: string;
  leadId: string;
  company: { id: string; name: string; domain: string | null };
  environment: string;
  status: LeadBotStatus;
  name: string | null;
  planTier: MonchaSlotTier | null;
  attempts: number;
  maxAttempts: number;
  /** When the next try starts (pending after an error or a pause). */
  nextAt: string | null;
  /** Last error, `code: message`; `success` once the bot is trained. */
  error: string | null;
  /** data.bot_id: the bot to use in settings, widget and training calls. */
  chatbotId: string | null;
  /** data.customer_tenant_id: the MonCha enterprise workspace (not our tenant). */
  monchaTenantId: string | null;
  connectionId: string | null;
  /** The entire POST /bots response. */
  config: unknown;
  createdBotAt: string | null;
  knowledge: LeadBotKnowledgeView;
  /** Widget colour and install values used for the website's chatbot. Older API versions omit it. */
  widget?: LeadBotWidgetView;
  createdAt: string;
  updatedAt: string;
};

/** `GET /api/v1/lead-bots` */
export type LeadBotPage = {
  items: LeadBotView[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  counts: Record<LeadBotStatus, number>;
  /** Training status of the created bots. */
  knowledgeCounts: Record<LeadBotKnowledgeStatus, number>;
};

export type SiteSnapshotSource = {
  text: string;
  charset: string;
  bytes: number;
  sha256: string;
  truncated: boolean;
};

export type SiteSnapshotQueued = {
  snapshotId: string;
  jobId: string;
  status: JobStatus;
  deduped?: boolean;
};

/** One copy in the website copy queue (`GET /api/v1/site-snapshots/queue`). */
export type SiteQueueItem = SiteSnapshotSummary & {
  /** 1-based place among copies that have not started; null while running. */
  position: number | null;
  /** Expected start (waiting) or finish (running), ISO. */
  estimatedAt: string;
  /** Waiting for a retry after a failed attempt. */
  retrying: boolean;
  attempts: number;
  maxAttempts: number;
  runAfter: string | null;
  /** When the current attempt started (running copies). */
  startedAt: string | null;
  lastError: string | null;
};

export type SiteQueue = {
  running: SiteQueueItem[];
  waiting: SiteQueueItem[];
  averageRunMs: number;
  /** True when the average comes from finished copies; false means a default guess. */
  measured: boolean;
};

/** `chatbot` is new; older API versions never return it. */
export type SitePipelineStep = 'copy' | 'chatbot' | 'github' | 'deploy';

/** `working` runs now or is about to; `retrying` waits before its next try; `paused` waits for a GitHub or Cloudflare limit. */
export type SitePipelineState = 'working' | 'retrying' | 'paused';

/**
 * `GET /api/v1/site-pipeline`: the worker takes one website at a time through copy, GitHub push and Worker deploy,
 * and starts the next only when it is live or a step gave up.
 */
export type SitePipelineStatus = {
  /** False when the worker cannot copy websites (R2 or the preview secret is missing). */
  enabled: boolean;
  /** `chatbot`: MonCha is configured, so each website gets its chatbot before the push. Older API versions omit it. */
  steps: { github: boolean; deploy: boolean; chatbot?: boolean };
  /**
   * Operator drain pause. When true, the current website finishes; new bots/copies/publishes wait.
   * Discovery schedules keep running. Older API versions omit this.
   */
  queue?: WorkerQueueState;
  /** Null when idle, or busy with another tenant's website. */
  current: {
    site: SiteSnapshotSummary;
    step: SitePipelineStep;
    state: SitePipelineState;
    /** Tries of this step so far, the running one included. */
    attempts: number;
    maxAttempts: number;
    /** When the next try starts (retrying or paused), ISO. */
    nextAt: string | null;
    /** Last error of this step, `code: message`. */
    error: string | null;
  } | null;
  /** Finished copies still waiting for their chatbot, GitHub push or Worker deploy (the current website not counted). */
  toPublish: number;
  /** Copies waiting for their first try. */
  waitingCopies: number;
};

export type SiteAutomationCrawlStatus = 'waiting_audits' | 'queuing' | 'complete';

/** `GET /api/v1/site-automation`. */
export type SiteAutomationState = {
  enabled: boolean;
  /** @deprecated No longer enforced: every qualified lead of a crawl is queued. */
  dailyCap: number;
  enabledAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  /** `used` = automatic copies queued this UTC day. `cap` and `remaining` are deprecated and not enforced. */
  today: { day: string; used: number; cap: number; remaining: number; resetsAt: string };
  /** @deprecated Always 0 now that copies are not capped. */
  carriedOver: number;
  /** Finished crawls whose website audits are still running. */
  waitingCrawls: number;
  /** False when website copies are not configured on the worker (R2), so nothing will be queued. */
  agentReady: boolean;
  /** False when the worker has automation switched off with SITE_AUTO_COPY=false. */
  workerEnabled: boolean;
};

/** One crawl followed by the copy automation (`GET /api/v1/site-automation/crawls`). */
export type SiteAutomationCrawl = {
  crawlJobId: string;
  country: string | null;
  countryCode: string | null;
  trigger: 'schedule' | 'manual';
  crawlStatus: JobStatus;
  status: SiteAutomationCrawlStatus;
  crawlFinishedAt: string;
  lastCheckedAt: string;
  completedAt: string | null;
  leadsCreated: number;
  auditsEnqueued: number;
  auditsTotal: number;
  auditsPending: number;
  qualified: number;
  queued: number;
  /** @deprecated Always 0 now that copies are not capped. */
  carriedOver: number;
  copies: { pending: number; running: number; done: number; failed: number };
};

export type CostTokens = { input: number; output: number };

/** Listed price of one model in USD per million tokens. */
export type SiteCostModelPrice = { model: string; inputPerMillionUsd: number; outputPerMillionUsd: number };

/** Where the per-token prices came from; rows without an OpenRouter charge are priced with them. */
export type SiteCostPricing = {
  source: 'openrouter' | 'overrides' | 'unavailable';
  fetchedAt: string | null;
  models: SiteCostModelPrice[];
  /** Models seen on copies or audits without a known price; their tokens are left out of the cost. */
  unpricedModels: string[];
  r2StorageUsdPerGbMonth: number;
};

/**
 * AI and storage spend of one website. AI cost is one-time (copy brand extraction plus the lead's AI audits);
 * storage is what its copies in R2 cost per month. GitHub repos and Cloudflare Workers are free on the current plans.
 */
export type SiteCostWebsite = {
  leadId: string;
  company: { id: string; name: string; domain: string | null };
  copies: number;
  aiAudits: number;
  copyTokens: CostTokens;
  auditTokens: CostTokens;
  copyCostUsd: number;
  auditCostUsd: number;
  aiCostUsd: number;
  /** Part of the AI cost was computed from tokens × price instead of OpenRouter's reported charge. */
  estimated: boolean;
  /** Some tokens have no known price, so the cost is a lower bound. */
  unpriced: boolean;
  storageBytes: number;
  storageUsdPerMonth: number;
  firstCopyAt: string;
  lastCopyAt: string;
  latest: {
    snapshotId: string;
    status: JobStatus;
    workerStatus: string | null;
    workerUrl: string | null;
    githubRepo: string | null;
  };
};

/** `GET /api/v1/costs/summary`: totals over websites whose copies were made in the window. */
export type SiteCostSummary = {
  days: number | null;
  since: string | null;
  websites: number;
  copies: number;
  aiAudits: number;
  copyTokens: CostTokens;
  auditTokens: CostTokens;
  copyCostUsd: number;
  auditCostUsd: number;
  aiCostUsd: number;
  exactCostUsd: number;
  estimatedCostUsd: number;
  averagePerWebsiteUsd: number | null;
  averageTokensPerWebsite: number | null;
  storageBytes: number;
  storageUsdPerMonth: number;
  byModel: Array<{
    model: string | null;
    kind: 'copy' | 'audit';
    calls: number;
    tokens: CostTokens;
    costUsd: number;
    price: SiteCostModelPrice | null;
  }>;
  /** UTC days on which websites were first copied in the window, oldest first. */
  byDay: Array<{ day: string; websites: number; costUsd: number; tokens: number }>;
  pricing: SiteCostPricing;
};

/** `GET /api/v1/costs/websites`. */
export type SiteCostWebsitePage = {
  items: SiteCostWebsite[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  pricing: SiteCostPricing;
};

/** `GET /api/v1/costs/websites/:leadId`: one website with every AI call behind its cost. */
export type SiteCostWebsiteDetail = SiteCostWebsite & {
  copyRuns: Array<{
    snapshotId: string;
    createdAt: string;
    status: JobStatus;
    model: string | null;
    tokens: CostTokens;
    costUsd: number | null;
    estimated: boolean;
    totalBytes: number;
    attempts: number;
  }>;
  auditRuns: Array<{
    auditId: string;
    auditedAt: string;
    method: string;
    verdict: string;
    model: string | null;
    tokens: CostTokens;
    costUsd: number | null;
    estimated: boolean;
  }>;
  pricing: SiteCostPricing;
};

export const coldEmailStatusSchema = z.enum(['draft', 'queued', 'sent', 'failed', 'suppressed']);

export const coldEmailListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  status: coldEmailStatusSchema.optional(),
});

export const coldEmailCandidatesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  readyOnly: z
    .union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

export const coldEmailPreviewSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  demoUrl: z.string().trim().url().max(2000),
  note: z.string().trim().max(500).optional(),
});

export const coldEmailDraftSchema = z.object({
  leadId: z.string().trim().min(1).optional(),
  companyName: z.string().trim().min(1).max(200),
  toEmail: z.string().trim().email().max(320),
  demoUrl: z.string().trim().url().max(2000),
  subject: z.string().trim().min(1).max(300).optional(),
});

/** Send cold email. In dev mode, deliverTo must be approved dev inboxes; otherwise must pass COLD_EMAIL_ALLOWLIST. */
export const coldEmailSendSchema = z.object({
  leadId: z.string().trim().min(1).optional(),
  companyName: z.string().trim().min(1).max(200),
  /** Intended company contact (audit only; not used as Resend recipient unless deliverTo omitted and allowlisted). */
  toEmail: z.string().trim().email().max(320).optional(),
  /** Resend recipient(s) — string (single or comma-separated) or array of emails. */
  deliverTo: z.union([
    z.string().trim().min(1).max(1000),
    z.array(z.string().trim().email().max(320)).min(1),
  ]),
  demoUrl: z.string().trim().url().max(2000),
  note: z.string().trim().max(500).optional(),
  subject: z.string().trim().min(1).max(300).optional(),
});

/** `POST /api/v1/cold-emails/:id/send` optional body to override delivery recipients without altering lead data. */
export const coldEmailDraftSendSchema = z.object({
  deliverToOverride: z
    .union([
      z.string().trim().min(1).max(1000),
      z.array(z.string().trim().email().max(320)).min(1),
    ])
    .optional(),
});

/** `PUT /api/v1/cold-emails/automation`. `send` still only sends to addresses the gate allows; others stay drafts. */
export const coldEmailAutomationUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: z.enum(['draft', 'send']).optional(),
    dailyCap: z.number().int().min(0).max(500).optional(),
  })
  .refine((v) => v.enabled !== undefined || v.mode !== undefined || v.dailyCap !== undefined, { message: 'Nothing to update' });

export type ColdEmailStatus = z.infer<typeof coldEmailStatusSchema>;
/** manual (console/API), auto (automation) or test (sent to an allowlisted test inbox, not the lead). */
export type ColdEmailOrigin = 'manual' | 'auto' | 'test';

export type ColdEmailView = {
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
  origin: ColdEmailOrigin;
  createdAt: string;
  updatedAt: string;
};

/** `GET/PUT /api/v1/cold-emails/automation`. */
export type ColdEmailAutomationView = {
  enabled: boolean;
  mode: 'draft' | 'send';
  dailyCap: number;
  enabledAt: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  /** Automated emails (drafts included) created today, UTC. */
  usedToday: number;
  /** Leads ready right now: trained bot, chatbot on the live demo, domain locked, company email, never emailed. */
  readyNow: number;
};

export type ColdEmailCandidateView = {
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

export type ColdEmailGateView = {
  sendingEnabled: boolean;
  allowlist: string[];
  allowlistOpen: boolean;
  resendConfigured: boolean;
  from: string;
  isDevMode: boolean;
  devInboxes: string[];
};

export type ColdEmailPreviewView = {
  subject: string;
  text: string;
  html: string;
};

export type ColdEmailPage = {
  items: ColdEmailView[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type ColdEmailCandidatePage = {
  items: ColdEmailCandidateView[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
