import type {
  ColdEmailGate,
  CrawlPipelineProgressView,
  CrawlPipelineSettingsView,
  CrawlPipelineStatusView,
  DiscoveryOptions,
} from '@/lib/types';

export function crawlSettings(over: Partial<CrawlPipelineSettingsView> = {}): CrawlPipelineSettingsView {
  return {
    active: true,
    crawlBatchSize: 20,
    targetCountry: 'SG',
    targetCities: ['Tampines'],
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
    updatedBy: 'editor@example.com',
    updatedAt: '2026-11-05T04:00:00.000Z',
    ...over,
  };
}

export function progress(over: Partial<CrawlPipelineProgressView> = {}): CrawlPipelineProgressView {
  return {
    websitesCrawledToday: 52,
    duplicatesFilteredToday: 12,
    auditsPendingToday: 0,
    auditsQualifiedToday: 4,
    websitesCreatedToday: 2,
    customersReachedToday: 1,
    qualifiedWaitingInQueue: 7,
    followUpsScheduled: 3,
    followUpsDueToday: 2,
    followUpsOverdue: 1,
    followUpsSentToday: 1,
    crawlsRunToday: 1,
    recrawlNeeded: false,
    recrawlReason: 'Queue is sufficiently buffered (7 qualified leads waiting)',
    ...over,
  };
}

export function pipelineStatus(settings = crawlSettings(), prog = progress()): CrawlPipelineStatusView {
  return { settings, progress: prog, workerOnline: true };
}

export const discoveryOptions: DiscoveryOptions = {
  countries: [
    { code: 'SG', name: 'Singapore', cities: ['Tampines', 'Bedok'], timezone: 'Asia/Singapore' },
    { code: 'MY', name: 'Malaysia', cities: ['Kuala Lumpur'], timezone: 'Asia/Kuala_Lumpur' },
  ],
  industries: ['dentist', 'gym', 'spa'],
  defaults: { source: 'google_places', maxPages: 3, timezone: 'Asia/Kuala_Lumpur' },
};

export function gate(over: Partial<ColdEmailGate> = {}): ColdEmailGate {
  return {
    sendingEnabled: true,
    allowlist: ['dev@example.com'],
    allowlistOpen: false,
    resendConfigured: true,
    from: 'Moncha <support@example.com>',
    isDevMode: true,
    devInboxes: ['dev@example.com', 'qa@example.com'],
    ...over,
  };
}
