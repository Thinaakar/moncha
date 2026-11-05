import { describe, expect, it } from 'vitest';
import {
  buildFollowUpContent,
  calculateFollowUpDueDate,
  copyAutomationFromCrawlSettings,
  crawlBatchLimits,
  evaluateAutoRecrawl,
  followUpTimezone,
  outreachAutomationFromCrawlSettings,
  type CrawlPipelineCounters,
  type CrawlPipelineSettingsRecord,
} from './crawlPipeline';
import { crawlTargetError } from './runCountryDiscovery';

describe('calculateFollowUpDueDate', () => {
  it('adds calendar days correctly', () => {
    // Thursday 2026-10-22 10:00 UTC
    const sentAt = new Date('2026-10-22T10:00:00Z');
    const due = calculateFollowUpDueDate(sentAt, 3, 'calendar_days', 10);
    // 3 calendar days later = Sunday 2026-10-25 10:00 UTC
    expect(due.toISOString()).toBe('2026-10-25T10:00:00.000Z');
  });

  it('skips weekends in business_days mode', () => {
    // Thursday 2026-10-22 10:00 UTC
    const thursday = new Date('2026-10-22T10:00:00Z');
    // +1 business day = Friday 2026-10-23
    const due1 = calculateFollowUpDueDate(thursday, 1, 'business_days', 10);
    expect(due1.toISOString()).toBe('2026-10-23T10:00:00.000Z');

    // Friday 2026-10-23 10:00 UTC
    const friday = new Date('2026-10-23T10:00:00Z');
    // +1 business day from Friday = Monday 2026-10-26 (skips Sat & Sun)
    const dueMon = calculateFollowUpDueDate(friday, 1, 'business_days', 10);
    expect(dueMon.toISOString()).toBe('2026-10-26T10:00:00.000Z');

    // Friday + 3 business days = Wednesday 2026-10-28
    const dueWed = calculateFollowUpDueDate(friday, 3, 'business_days', 14);
    expect(dueWed.toISOString()).toBe('2026-10-28T14:00:00.000Z');
  });

  it('sends at the preferred hour on the business clock', () => {
    // Thursday 2026-10-22 03:00 UTC = 11:00 Singapore, 12:00 Tokyo
    const sentAt = new Date('2026-10-22T03:00:00Z');
    expect(calculateFollowUpDueDate(sentAt, 1, 'business_days', 10, 'Asia/Singapore').toISOString()).toBe(
      '2026-10-23T02:00:00.000Z',
    );
    expect(calculateFollowUpDueDate(sentAt, 1, 'business_days', 10, 'Asia/Tokyo').toISOString()).toBe(
      '2026-10-23T01:00:00.000Z',
    );
  });

  it('counts days and skips weekends on the local calendar, not the UTC one', () => {
    // Friday 2026-10-23 17:00 UTC is already Saturday 01:00 in Singapore.
    const sentAt = new Date('2026-10-23T17:00:00Z');
    // Next local business day is Monday 26 Oct, 10:00 Singapore = 02:00 UTC.
    expect(calculateFollowUpDueDate(sentAt, 1, 'business_days', 10, 'Asia/Singapore').toISOString()).toBe(
      '2026-10-26T02:00:00.000Z',
    );
    // One local calendar day later is Sunday 25 Oct.
    expect(calculateFollowUpDueDate(sentAt, 1, 'calendar_days', 10, 'Asia/Singapore').toISOString()).toBe(
      '2026-10-25T02:00:00.000Z',
    );
    // In UTC the same email was sent on Friday, so +1 business day is Monday 10:00 UTC.
    expect(calculateFollowUpDueDate(sentAt, 1, 'business_days', 10).toISOString()).toBe('2026-10-26T10:00:00.000Z');
  });

  it('waits at least one day even with a zero delay', () => {
    const sentAt = new Date('2026-10-22T03:00:00Z');
    expect(calculateFollowUpDueDate(sentAt, 0, 'calendar_days', 10, 'Asia/Singapore').toISOString()).toBe(
      '2026-10-23T02:00:00.000Z',
    );
  });
});

describe('followUpTimezone', () => {
  it("uses the lead's country, then the target country, then UTC", () => {
    expect(followUpTimezone('Singapore', 'MY')).toBe('Asia/Singapore');
    expect(followUpTimezone('japan', 'SG')).toBe('Asia/Tokyo');
    expect(followUpTimezone(null, 'MY')).toBe('Asia/Kuala_Lumpur');
    expect(followUpTimezone('Atlantis', 'Atlantis')).toBe('UTC');
    expect(followUpTimezone(undefined, undefined)).toBe('UTC');
  });
});

describe('evaluateAutoRecrawl', () => {
  const baseSettings: CrawlPipelineSettingsRecord = {
    tenantId: 'tenant-1',
    active: true,
    crawlBatchSize: 20,
    targetCountry: 'SG',
    targetCities: [],
    targetIndustries: [],
    maxPagesPerSearch: 3,
    dailyWebsiteCreationLimit: 5,
    dailyCustomerReachLimit: 5,
    autoRecrawlEnabled: true,
    minQueueBuffer: 5,
    maxDailyCrawlRuns: 10,
    followUpEnabled: true,
    followUpDelayDays: 3,
    followUpMode: 'business_days',
    followUpPreferredHour: 10,
    followUpSubject: null,
    followUpBodyTemplate: null,
    lastRecrawlAt: null,
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const baseCounters: CrawlPipelineCounters = {
    websitesCrawledToday: 20,
    duplicatesFilteredToday: 8,
    auditsPendingToday: 0,
    auditsQualifiedToday: 4,
    websitesCreatedToday: 2,
    customersReachedToday: 2,
    qualifiedWaitingInQueue: 1, // Only 1 qualified lead left, but we need 3 more creations to hit daily cap of 5
    followUpsScheduled: 2,
    followUpsDueToday: 0,
    followUpsOverdue: 0,
    followUpsSentToday: 0,
    crawlsRunToday: 1,
  };

  it('triggers recrawl when qualified leads in queue are below required daily target buffer', () => {
    const decision = evaluateAutoRecrawl(baseSettings, baseCounters);
    expect(decision.shouldRecrawl).toBe(true);
    expect(decision.recommendedBatchSize).toBe(20);
    expect(decision.reason).toContain('Queue has 1 qualified leads');
  });

  it('does NOT recrawl when pipeline is paused', () => {
    const decision = evaluateAutoRecrawl({ ...baseSettings, active: false }, baseCounters);
    expect(decision.shouldRecrawl).toBe(false);
    expect(decision.reason).toContain('paused');
  });

  it('does NOT recrawl when autoRecrawlEnabled is false', () => {
    const decision = evaluateAutoRecrawl({ ...baseSettings, autoRecrawlEnabled: false }, baseCounters);
    expect(decision.shouldRecrawl).toBe(false);
    expect(decision.reason).toContain('turned off');
  });

  it('does NOT recrawl when daily creation limit is already fulfilled', () => {
    const decision = evaluateAutoRecrawl(baseSettings, {
      ...baseCounters,
      websitesCreatedToday: 5, // Met the 5 daily limit!
    });
    expect(decision.shouldRecrawl).toBe(false);
    expect(decision.reason).toContain('already fulfilled today');
  });

  it('does NOT recrawl when maximum daily crawl runs are reached', () => {
    const decision = evaluateAutoRecrawl(baseSettings, {
      ...baseCounters,
      crawlsRunToday: 10, // Max runs reached!
    });
    expect(decision.shouldRecrawl).toBe(false);
    expect(decision.reason).toContain('Maximum daily crawl runs');
  });

  it('drives copy and outreach automation from the crawl settings', () => {
    const settings = { ...baseSettings, active: true, dailyWebsiteCreationLimit: 7, dailyCustomerReachLimit: 3 };
    expect(copyAutomationFromCrawlSettings(settings)).toMatchObject({ enabled: true, dailyCap: 7, enabledAt: settings.createdAt });
    expect(outreachAutomationFromCrawlSettings(settings)).toMatchObject({ enabled: true, dailyCap: 3, mode: 'send' });
    expect(copyAutomationFromCrawlSettings({ ...settings, active: false }).enabled).toBe(false);
    expect(outreachAutomationFromCrawlSettings({ ...settings, active: false }).enabled).toBe(false);
  });

  it('waits when audits are still actively pending', () => {
    const decision = evaluateAutoRecrawl(baseSettings, {
      ...baseCounters,
      auditsPendingToday: 6, // 6 audits currently in flight
    });
    expect(decision.shouldRecrawl).toBe(false);
    expect(decision.reason).toContain('website audits currently running');
  });
});

describe('crawlBatchLimits', () => {
  it('turns the batch size into searches and caps pages per search at 3', () => {
    expect(crawlBatchLimits({ crawlBatchSize: 20, maxPagesPerSearch: 3 })).toEqual({ maxSearches: 1, maxPages: 3 });
    expect(crawlBatchLimits({ crawlBatchSize: 21, maxPagesPerSearch: 2 })).toEqual({ maxSearches: 2, maxPages: 2 });
    expect(crawlBatchLimits({ crawlBatchSize: 100, maxPagesPerSearch: 20 })).toEqual({ maxSearches: 5, maxPages: 3 });
    expect(crawlBatchLimits({ crawlBatchSize: 20, maxPagesPerSearch: 3 }, 45)).toEqual({ maxSearches: 3, maxPages: 3 });
  });
});

describe('crawlTargetError', () => {
  it('accepts a supported country with its own search areas', () => {
    expect(crawlTargetError('SG', [])).toBeNull();
    expect(crawlTargetError('SG', ['Tampines'])).toBeNull();
    expect(crawlTargetError('MY', ['Kuala Lumpur'])).toBeNull();
  });

  it('rejects unsupported countries and cities from another country', () => {
    expect(crawlTargetError('XX', [])).toContain('Unsupported country "XX"');
    expect(crawlTargetError('MY', ['Tampines'])).toBe('"Tampines" is not a search area in Malaysia');
    expect(crawlTargetError('SG', ['Atlantis', ''])).toBe('"Atlantis", "" are not search areas in Singapore');
  });
});

describe('buildFollowUpContent', () => {
  it('renders default follow up format', () => {
    const content = buildFollowUpContent({
      companyName: 'Acme Design',
      demoUrl: 'https://acme.workers.dev',
    });
    expect(content.subject).toBe('Have you had a chance to explore your AI assistant?');
    expect(content.text).toContain('Hi Acme Design team,');
    expect(content.text).toContain('https://acme.workers.dev');
    expect(content.html).toContain('https://acme.workers.dev');
    expect(content.html).toContain('Have you had a chance to explore your AI assistant?');
    expect(content.html).toContain('HOW IT HELPS YOUR BUSINESS');
    expect(content.html).toContain('Open demo');
    expect(content.html).not.toContain('internal template preview');
  });

  it('renders custom template with variables substituted', () => {
    const customTemplate = 'Hello {companyName}, please review your preview at {demoUrl}. Cheers!';
    const customSubject = 'Action required for {companyName}';
    const content = buildFollowUpContent({
      companyName: 'Nova Spa',
      demoUrl: 'https://nova.workers.dev',
      customSubject,
      customTemplate,
    });
    expect(content.subject).toBe('Action required for Nova Spa');
    expect(content.text).toContain('Hello Nova Spa, please review your preview at https://nova.workers.dev. Cheers!');
    expect(content.text).toContain('HOW IT HELPS YOUR BUSINESS');
    expect(content.html).toContain('Hello Nova Spa, please review your preview at https://nova.workers.dev. Cheers!');
    expect(content.html).toContain('Open demo');
  });
});
