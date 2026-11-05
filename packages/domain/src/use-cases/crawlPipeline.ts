import type { CrawlRunClaim, CrawlRunKind, CrawlRunUsage, SiteAutomationSettingsRecord } from '../ports';
import { resolveCountry } from '../discovery/countries';
import { localCalendarDate, zonedTimeToUtc } from '../discovery/schedule-time';
import type { ColdEmailAutomationSettings } from './coldEmails';

/** Which triggers may start crawls. Manual runs are always allowed (within the daily limit). */
export type CrawlMode = 'both' | 'scheduled_only' | 'auto_only';
export const CRAWL_MODES: readonly CrawlMode[] = ['both', 'scheduled_only', 'auto_only'];

export type CrawlPipelineSettingsRecord = {
  tenantId: string;
  active: boolean;
  crawlBatchSize: number;
  targetCountry: string;
  targetCities: string[];
  targetIndustries: string[];
  maxPagesPerSearch: number;
  dailyWebsiteCreationLimit: number;
  dailyCustomerReachLimit: number;
  autoRecrawlEnabled: boolean;
  minQueueBuffer: number;
  maxDailyCrawlRuns: number;
  crawlMode: CrawlMode;
  /** Of maxDailyCrawlRuns, runs only schedules may use. */
  scheduleReservedRuns: number;
  followUpEnabled: boolean;
  followUpDelayDays: number;
  followUpMode: 'business_days' | 'calendar_days';
  followUpPreferredHour: number;
  followUpSubject: string | null;
  followUpBodyTemplate: string | null;
  lastRecrawlAt: Date | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** The daily run claim a trigger makes, from the crawl settings. */
export function crawlRunClaim(
  settings: Pick<CrawlPipelineSettingsRecord, 'maxDailyCrawlRuns' | 'scheduleReservedRuns'>,
  kind: CrawlRunKind,
): CrawlRunClaim {
  return {
    kind,
    maxRuns: settings.maxDailyCrawlRuns,
    reservedForSchedules: Math.min(settings.maxDailyCrawlRuns, Math.max(0, settings.scheduleReservedRuns)),
  };
}

/**
 * Whether one more run may be claimed today. Schedules may use every run of the limit; auto-recrawl and manual runs
 * only the unreserved ones. The database applies the same rule atomically (claimCrawlRun).
 */
export function canClaimCrawlRun(usage: Pick<CrawlRunUsage, 'runs' | 'scheduledRuns'>, claim: CrawlRunClaim): boolean {
  if (usage.runs >= claim.maxRuns) return false;
  if (claim.kind === 'schedule') return true;
  return usage.runs - usage.scheduledRuns < claim.maxRuns - claim.reservedForSchedules;
}

/** Runs a trigger of this kind may still start today. */
export function crawlRunsLeft(usage: Pick<CrawlRunUsage, 'runs' | 'scheduledRuns'>, claim: CrawlRunClaim): number {
  const total = Math.max(0, claim.maxRuns - usage.runs);
  if (claim.kind === 'schedule') return total;
  return Math.max(0, Math.min(total, claim.maxRuns - claim.reservedForSchedules - (usage.runs - usage.scheduledRuns)));
}

/** "Daily run limit reached: …" for a failed claim. */
export function crawlRunLimitMessage(usage: Pick<CrawlRunUsage, 'runs' | 'scheduledRuns'>, claim: CrawlRunClaim): string {
  if (usage.runs >= claim.maxRuns) return `Daily run limit reached: ${usage.runs} of ${claim.maxRuns} runs used today (UTC)`;
  const unreserved = claim.maxRuns - claim.reservedForSchedules;
  return `Daily run limit reached: ${usage.runs - usage.scheduledRuns} of ${unreserved} unreserved runs used today (UTC); ${claim.reservedForSchedules} reserved for schedules`;
}

export type CrawlPipelineSettingsPatch = Partial<
  Omit<CrawlPipelineSettingsRecord, 'tenantId' | 'createdAt' | 'updatedAt'>
>;

/** Counts for the current UTC day (the day the daily limits reset on), except the queue and follow-up backlog. */
export type CrawlPipelineCounters = {
  /** Places today's country crawls found (from their results; a running crawl adds its total when it ends). */
  websitesCrawledToday: number;
  /** Places today's crawls skipped because the company was already in the database. */
  duplicatesFilteredToday: number;
  auditsPendingToday: number;
  /** Leads created today whose audit qualified them. */
  auditsQualifiedToday: number;
  /** Automatic website copies queued today. */
  websitesCreatedToday: number;
  /** Automatic cold emails created today, drafts included. */
  customersReachedToday: number;
  qualifiedWaitingInQueue: number;
  followUpsScheduled: number;
  /** Scheduled follow-ups due before the end of today, overdue ones included. */
  followUpsDueToday: number;
  /** Scheduled follow-ups whose due time has passed. */
  followUpsOverdue: number;
  followUpsSentToday: number;
  /** Runs claimed today (CrawlRunUsage; before the first claim, country crawls created today). */
  crawlsRunToday: number;
  /** Of crawlsRunToday, the runs started by a schedule. */
  scheduledRunsToday: number;
};

export type CrawlPipelineDecision = {
  shouldRecrawl: boolean;
  reason?: string;
  recommendedBatchSize?: number;
};

/** Places results per search page; a crawl batch of N websites gets ceil(N / 20) searches. */
const RESULTS_PER_SEARCH = 20;
/** Google Places returns at most 3 pages per search. */
const MAX_PAGES_PER_SEARCH = 3;

/** Search limits of one crawl run (auto-recrawl, manual trigger or schedule) from the crawl settings. */
export function crawlBatchLimits(
  settings: Pick<CrawlPipelineSettingsRecord, 'crawlBatchSize' | 'maxPagesPerSearch'>,
  batchSize = settings.crawlBatchSize,
): { maxSearches: number; maxPages: number } {
  return {
    maxSearches: Math.max(1, Math.ceil((batchSize || RESULTS_PER_SEARCH) / RESULTS_PER_SEARCH)),
    maxPages: Math.min(MAX_PAGES_PER_SEARCH, Math.max(1, settings.maxPagesPerSearch || MAX_PAGES_PER_SEARCH)),
  };
}

/**
 * Copy automation as driven by the crawl settings: on while the engine is active, at most
 * `dailyWebsiteCreationLimit` automatic copies per UTC day, for crawls that finished after the settings were created.
 */
export function copyAutomationFromCrawlSettings(settings: CrawlPipelineSettingsRecord): SiteAutomationSettingsRecord {
  return {
    tenantId: settings.tenantId,
    enabled: settings.active,
    dailyCap: settings.dailyWebsiteCreationLimit,
    enabledAt: settings.createdAt,
    updatedBy: settings.updatedBy,
    updatedAt: settings.updatedAt,
  };
}

/**
 * Cold email automation as driven by the crawl settings: on while the engine is active, at most
 * `dailyCustomerReachLimit` new businesses per UTC day, sent when the env gates allow it (drafts otherwise).
 */
export function outreachAutomationFromCrawlSettings(settings: CrawlPipelineSettingsRecord): ColdEmailAutomationSettings {
  return {
    tenantId: settings.tenantId,
    enabled: settings.active,
    mode: 'send',
    dailyCap: settings.dailyCustomerReachLimit,
    enabledAt: null,
    updatedBy: settings.updatedBy,
    updatedAt: settings.updatedAt,
  };
}

/** Zone used when neither the lead's country nor the target country is known. */
export const FOLLOW_UP_FALLBACK_TIMEZONE = 'UTC';

/** Follow-ups go out on the business's clock: its own country, else the crawl settings' target country. */
export function followUpTimezone(leadCountry: string | null | undefined, targetCountry?: string | null): string {
  return (
    (leadCountry && resolveCountry(leadCountry)?.timezone) ||
    (targetCountry && resolveCountry(targetCountry)?.timezone) ||
    FOLLOW_UP_FALLBACK_TIMEZONE
  );
}

/**
 * Calculates a future due date for a follow-up email, on the wall clock of `timezone`.
 * - Days are counted on the zone's calendar, starting the day after `sentAt` there (at least 1 day).
 * - In 'business_days' mode, local Saturdays and Sundays are skipped.
 * - The time is `preferredHour`:00 local time.
 */
export function calculateFollowUpDueDate(
  sentAt: Date,
  delayDays: number,
  mode: 'business_days' | 'calendar_days' = 'business_days',
  preferredHour = 10,
  timezone: string = FOLLOW_UP_FALLBACK_TIMEZONE,
): Date {
  const start = localCalendarDate(sentAt, timezone);
  const day = new Date(Date.UTC(start.year, start.month - 1, start.day));
  const days = Math.max(1, delayDays);

  if (mode === 'calendar_days') {
    day.setUTCDate(day.getUTCDate() + days);
  } else {
    let added = 0;
    while (added < days) {
      day.setUTCDate(day.getUTCDate() + 1);
      const dayOfWeek = day.getUTCDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) added += 1;
    }
  }

  return zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), preferredHour, 0, timezone);
}

/**
 * Evaluates whether an automated re-crawl cycle should be triggered to replenish
 * the queue and satisfy daily website creation & customer reach targets.
 */
export function evaluateAutoRecrawl(
  settings: CrawlPipelineSettingsRecord,
  counters: CrawlPipelineCounters,
  now = new Date(),
): CrawlPipelineDecision {
  if (!settings.active) {
    return { shouldRecrawl: false, reason: 'Pipeline is paused' };
  }

  if (settings.crawlMode === 'scheduled_only') {
    return { shouldRecrawl: false, reason: 'Crawl mode is Scheduled only: crawls start from Target region schedules' };
  }

  if (!settings.autoRecrawlEnabled) {
    return { shouldRecrawl: false, reason: 'Auto-recrawl is turned off' };
  }

  const usage = { runs: counters.crawlsRunToday, scheduledRuns: counters.scheduledRunsToday };
  const claim = crawlRunClaim(settings, 'auto');
  if (!canClaimCrawlRun(usage, claim)) {
    return { shouldRecrawl: false, reason: crawlRunLimitMessage(usage, claim) };
  }

  // Check if daily website creation limit is already fulfilled
  if (counters.websitesCreatedToday >= settings.dailyWebsiteCreationLimit) {
    return {
      shouldRecrawl: false,
      reason: `Daily website creation quota (${settings.dailyWebsiteCreationLimit}) already fulfilled today`,
    };
  }

  const remainingCreationsNeeded = Math.max(
    0,
    settings.dailyWebsiteCreationLimit - counters.websitesCreatedToday,
  );

  // If there are audits actively pending/running, wait for them to finish before triggering a new crawl
  if (counters.auditsPendingToday > 0) {
    return {
      shouldRecrawl: false,
      reason: `${counters.auditsPendingToday} website audits currently running; awaiting qualification`,
    };
  }

  // If qualified leads in queue are below the remaining needed creations + buffer
  const requiredBuffer = Math.max(remainingCreationsNeeded, settings.minQueueBuffer);
  if (counters.qualifiedWaitingInQueue < requiredBuffer) {
    return {
      shouldRecrawl: true,
      reason: `Queue has ${counters.qualifiedWaitingInQueue} qualified leads, but ${requiredBuffer} needed to fulfill today's target of ${settings.dailyWebsiteCreationLimit} creations.`,
      recommendedBatchSize: settings.crawlBatchSize,
    };
  }

  return {
    shouldRecrawl: false,
    reason: `Queue is sufficiently buffered (${counters.qualifiedWaitingInQueue} qualified leads waiting)`,
  };
}

export type FollowUpContent = {
  subject: string;
  text: string;
  html: string;
};

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const FOLLOWUP_BENEFITS: Array<{ title: string; text: string }> = [
  { title: 'Accurate answers', text: 'Replies only from your own website content and shows where each answer comes from.' },
  { title: 'Available 24/7', text: 'Answers common questions instantly, day or night, in 24 languages.' },
  { title: 'Leads and bookings', text: 'Captures enquiries and appointment requests and passes them to your team.' },
];

const FOLLOWUP_LOGO_URL = 'https://moncha-console.vinothjv4-tech.workers.dev/brand/mark-email.png';

/**
 * Builds follow-up email content, substituting template variables if a custom
 * template is provided, or falling back to a structured default follow-up format.
 */
export function buildFollowUpContent(input: {
  companyName: string;
  demoUrl: string;
  customSubject?: string | null;
  customTemplate?: string | null;
  logoUrl?: string;
}): FollowUpContent {
  const company = input.companyName.trim() || 'there';
  const url = input.demoUrl.trim();
  const greeting = company === 'there' ? 'Hi there,' : `Hi ${company} team,`;

  const defaultSubject = 'Have you had a chance to explore your AI assistant?';
  const subject = input.customSubject?.trim()
    ? input.customSubject
        .replace(/\{companyName\}/gi, company)
        .replace(/\{demoUrl\}/gi, url)
    : defaultSubject;

  let introHtml: string;
  let introTextLines: string[];

  if (input.customTemplate?.trim()) {
    const customized = input.customTemplate
      .replace(/\{companyName\}/gi, company)
      .replace(/\{demoUrl\}/gi, url);
    const paragraphs = customized.split('\n\n').map((p) => p.trim()).filter(Boolean);
    introHtml = paragraphs
      .map(
        (p) =>
          `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`,
      )
      .join('');
    introTextLines = paragraphs;
  } else {
    introHtml = `
      <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155">I wanted to follow up on the AI support assistant demo we shared with you recently.</p>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155">The assistant is designed to answer visitors&#39; questions around the clock using your website content and help your team capture customer enquiries.</p>
      <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#334155">If you haven&#39;t had a chance to explore it yet, you can view your personalised demo below.</p>
    `.trim();
    introTextLines = [
      'I wanted to follow up on the AI support assistant demo we shared with you recently.',
      "The assistant is designed to answer visitors' questions around the clock using your website content and help your team capture customer enquiries.",
      "If you haven't had a chance to explore it yet, you can view your personalised demo below.",
    ];
  }

  const benefits = FOLLOWUP_BENEFITS.map(
    (b, i) => `
<tr>
  <td width="28" style="width:28px;padding:${i ? '14px' : '0'} 0 0;vertical-align:top">
    <div style="width:20px;height:20px;border-radius:10px;background:#e8f0fe;color:#2563eb;font-size:12px;font-weight:700;line-height:20px;text-align:center">&#10003;</div>
  </td>
  <td style="padding:${i ? '14px' : '0'} 0 0;vertical-align:top">
    <p style="margin:0;font-size:15px;line-height:20px;font-weight:600;color:#0f172a">${escapeHtml(b.title)}</p>
    <p style="margin:2px 0 0;font-size:14px;line-height:1.5;color:#475569">${escapeHtml(b.text)}</p>
  </td>
</tr>`,
  ).join('');

  const text = [
    greeting,
    '',
    ...introTextLines,
    '',
    'HOW IT HELPS YOUR BUSINESS',
    ...FOLLOWUP_BENEFITS.map((b) => `- ${b.title}: ${b.text}`),
    '',
    'Click to view your demo:',
    url,
    '',
    "We'd love to hear what you think. Please feel free to reply if you have any questions.",
    '',
    'Best regards,',
    'The MonCha team',
    'https://moncha.co/',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
        <tr>
          <td style="background:#2563eb;padding:20px 28px">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="width:28px;height:28px;vertical-align:middle"><img src="${escapeHtml(input.logoUrl?.trim() || FOLLOWUP_LOGO_URL)}" width="28" height="28" alt="MonCha" style="display:block;width:28px;height:28px;border:0;border-radius:6px"></td>
              <td style="padding-left:10px;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.02em">MonCha</td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 32px 8px">
            <h1 style="margin:0 0 24px;font-size:22px;line-height:1.35;color:#0f172a;font-weight:700">Have you had a chance to explore your AI assistant?</h1>
            <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#0f172a">${escapeHtml(greeting)}</p>
            ${introHtml}
            <p style="margin:0 0 16px;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#64748b">HOW IT HELPS YOUR BUSINESS</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px">
              ${benefits}
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px">
              <tr><td style="padding:20px 22px">
                <p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#0f172a">Click to view your demo:</p>
                <p style="margin:0 0 18px;font-size:14px;line-height:1.5;word-break:break-all"><a href="${escapeHtml(url)}" style="color:#2563eb;text-decoration:underline">${escapeHtml(url)}</a></p>
                <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">Open demo</a>
              </td></tr>
            </table>
            <p style="margin:24px 0 0;font-size:15px;line-height:1.6;color:#334155">We&#39;d love to hear what you think. Please feel free to reply if you have any questions.</p>
            <p style="margin:20px 0 0;font-size:15px;line-height:1.6;color:#334155">Best regards,<br><span style="color:#0f172a;font-weight:600">The MonCha team</span></p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 32px">
            <p style="margin:0;padding-top:20px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#94a3b8">
              MonCha · AI customer support for your website ·
              <a href="https://moncha.co/" style="color:#64748b;text-decoration:underline">moncha.co</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
