import type { ColdEmailPayload, Mailer } from '../ports';
import { resolveCountry } from '../discovery/countries';

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

export type CrawlPipelineSettingsPatch = Partial<
  Omit<CrawlPipelineSettingsRecord, 'tenantId' | 'createdAt' | 'updatedAt'>
>;

export type CrawlPipelineCounters = {
  websitesCrawledToday: number;
  duplicatesFilteredToday: number;
  auditsPendingToday: number;
  auditsQualifiedToday: number;
  websitesCreatedToday: number;
  customersReachedToday: number;
  qualifiedWaitingInQueue: number;
  followUpsScheduled: number;
  followUpsDueToday: number;
  crawlsRunToday: number;
};

export type CrawlPipelineDecision = {
  shouldRecrawl: boolean;
  reason?: string;
  recommendedBatchSize?: number;
};

/**
 * Calculates a future due date for a follow-up email.
 * - In 'business_days' mode, skips Saturdays and Sundays.
 * - Sets the time to the tenant's preferred hour (local/UTC, defaults to 10:00).
 */
export function calculateFollowUpDueDate(
  sentAt: Date,
  delayDays: number,
  mode: 'business_days' | 'calendar_days' = 'business_days',
  preferredHour = 10,
): Date {
  const target = new Date(sentAt.getTime());
  const days = Math.max(1, delayDays);

  if (mode === 'calendar_days') {
    target.setUTCDate(target.getUTCDate() + days);
  } else {
    // business_days: add days skipping weekends
    let added = 0;
    while (added < days) {
      target.setUTCDate(target.getUTCDate() + 1);
      const dayOfWeek = target.getUTCDay();
      // 0 = Sunday, 6 = Saturday
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        added += 1;
      }
    }
  }

  target.setUTCHours(preferredHour, 0, 0, 0);
  return target;
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

  if (!settings.autoRecrawlEnabled) {
    return { shouldRecrawl: false, reason: 'Auto-recrawl is turned off' };
  }

  if (counters.crawlsRunToday >= settings.maxDailyCrawlRuns) {
    return {
      shouldRecrawl: false,
      reason: `Maximum daily crawl runs (${settings.maxDailyCrawlRuns}) reached for today`,
    };
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
