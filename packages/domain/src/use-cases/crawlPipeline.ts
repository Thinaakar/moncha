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

/**
 * Builds follow-up email content, substituting template variables if a custom
 * template is provided, or falling back to a structured default follow-up format.
 */
export function buildFollowUpContent(input: {
  companyName: string;
  demoUrl: string;
  customSubject?: string | null;
  customTemplate?: string | null;
}): FollowUpContent {
  const company = input.companyName.trim() || 'there';
  const url = input.demoUrl.trim();

  const defaultSubject = `Quick follow up regarding ${company}'s MonCha chatbot demo`;

  if (input.customTemplate?.trim()) {
    let body = input.customTemplate
      .replace(/\{companyName\}/gi, company)
      .replace(/\{demoUrl\}/gi, url);

    const subject = (input.customSubject?.trim() || defaultSubject)
      .replace(/\{companyName\}/gi, company)
      .replace(/\{demoUrl\}/gi, url);

    return {
      subject,
      text: body,
      html: `<div style="font-family: sans-serif; font-size: 15px; line-height: 1.6; color: #1e293b;">
        ${body.replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>')}
      </div>`,
    };
  }

  // Default professional follow-up format
  const subject = input.customSubject?.trim()
    ? input.customSubject.replace(/\{companyName\}/gi, company)
    : defaultSubject;

  const text = `Hi ${company} team,\n\nI wanted to quickly follow up on the interactive AI support assistant demo we generated for your website:\n${url}\n\nHave you had a chance to test it out? We built it using your brand style and existing site info.\n\nLet us know if you'd like us to customize its answers or adjust its design!\n\nBest regards,\nMonCha Team`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.6; color: #1e293b; max-width: 560px;">
      <p>Hi ${company} team,</p>
      <p>I wanted to quickly follow up on the interactive AI support assistant demo we created for your business.</p>
      <div style="margin: 20px 0; padding: 16px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
        <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748b; font-weight: 500;">YOUR PREVIEW LINK</p>
        <a href="${url}" style="color: #2563eb; font-weight: 600; text-decoration: underline; word-break: break-all;">${url}</a>
      </div>
      <p>Have you had a moment to test it? It is trained directly on your website content and tailored to your brand.</p>
      <p>Feel free to reply directly to this email if you'd like us to tune its answers or add custom features.</p>
      <p style="margin-top: 24px; color: #64748b; font-size: 14px;">Best regards,<br/><strong>MonCha Team</strong></p>
    </div>
  `;

  return { subject, text, html };
}
