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
export type ResolveReviewInput = z.infer<typeof resolveReviewSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type PasswordLoginInput = z.infer<typeof passwordLoginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type LlmAssistantOutput = z.infer<typeof llmAssistantOutputSchema>;
