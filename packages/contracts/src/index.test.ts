import { describe, expect, it } from 'vitest';
import {
  CRAWL_SETTINGS_LIMITS,
  crawlPipelineSettingsUpdateSchema,
  crawlPipelineTriggerSchema,
  countryDiscoverySchema,
  isLeadQualified,
  leadListQuerySchema,
  llmAssistantOutputSchema,
  manualLeadSchema,
  resolveReviewSchema,
  scheduleCreateSchema,
  scheduleRunsQuerySchema,
  sourceImportSchema,
} from './index';

describe('API validation', () => {
  it('accepts a country-only crawl request with defaults', () => {
    expect(countryDiscoverySchema.parse({ country: 'Malaysia' })).toEqual({
      country: 'Malaysia',
      source: 'google_places',
      maxPages: 3,
      reset: false,
    });
    expect(countryDiscoverySchema.safeParse({ country: '' }).success).toBe(false);
    expect(countryDiscoverySchema.safeParse({ country: 'Japan', maxPages: 4 }).success).toBe(false);
  });

  it('validates daily schedule requests', () => {
    expect(scheduleCreateSchema.parse({ country: ' Malaysia ', time: '10:00' })).toEqual({
      country: 'Malaysia',
      time: '10:00',
    });
    expect(scheduleCreateSchema.safeParse({ country: 'Japan', time: '9:00' }).success).toBe(false);
    expect(scheduleCreateSchema.safeParse({ country: 'Japan', time: '24:00' }).success).toBe(false);
    expect(scheduleRunsQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(scheduleRunsQuerySchema.parse({ limit: '10' })).toEqual({ limit: 10 });
    expect(scheduleRunsQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });

  it('still requires city and keyword for a single Discover search', () => {
    expect(sourceImportSchema.safeParse({ source: 'google_places', country: 'Singapore' }).success).toBe(false);
  });

  it('accepts a google places discovery request', () => {
    const parsed = sourceImportSchema.parse({
      source: 'google_places',
      country: 'Singapore',
      city: 'Singapore',
      keyword: 'dental clinics',
    });
    expect(parsed.source).toBe('google_places');
  });

  it('accepts yelp, foursquare, search, and all discovery sources', () => {
    for (const source of ['yelp', 'foursquare', 'search', 'all'] as const) {
      expect(
        sourceImportSchema.parse({
          source,
          country: 'Singapore',
          city: 'Singapore',
          keyword: 'dental clinics',
        }).source,
      ).toBe(source);
    }
  });

  it('rejects missing discovery fields', () => {
    const result = sourceImportSchema.safeParse({ source: 'google_places', country: 'Singapore' });
    expect(result.success).toBe(false);
  });

  it('requires csv payload for csv imports', () => {
    expect(sourceImportSchema.safeParse({ source: 'csv' }).success).toBe(false);
    expect(
      sourceImportSchema.safeParse({
        source: 'csv',
        records: [{ name: 'Acme', domain: 'acme.example' }],
      }).success,
    ).toBe(true);
  });

  it('validates manual lead creation', () => {
    expect(manualLeadSchema.safeParse({ name: 'Acme' }).success).toBe(true);
    expect(manualLeadSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('defaults lead list queue to QUALIFIED', () => {
    expect(leadListQuerySchema.parse({}).queue).toBe('QUALIFIED');
    expect(leadListQuerySchema.parse({ queue: 'ALL' }).queue).toBeUndefined();
    expect(leadListQuerySchema.safeParse({ queue: 'all' }).success).toBe(false);
    expect(leadListQuerySchema.safeParse({ pageSize: 1000 }).success).toBe(false);
    expect(
      leadListQuerySchema.parse({
        page: '2',
        pageSize: '10',
        search: 'dental',
        country: 'Singapore',
        queue: 'NEEDS_REVIEW',
        vendor: 'Intercom',
        method: 'llm',
      }),
    ).toMatchObject({
      page: 2,
      pageSize: 10,
      search: 'dental',
      country: 'Singapore',
      queue: 'NEEDS_REVIEW',
      vendor: 'Intercom',
      method: 'llm',
    });
  });

  it('derives qualified from queue only', () => {
    expect(isLeadQualified('QUALIFIED')).toBe(true);
    expect(isLeadQualified('NEEDS_REVIEW')).toBe(false);
    expect(isLeadQualified('PENDING_AUDIT')).toBe(false);
  });

  it('validates review resolution and llm output', () => {
    expect(
      resolveReviewSchema.safeParse({ action: 'confirm_no_assistant', note: 'Looks clear' }).success,
    ).toBe(true);
    expect(resolveReviewSchema.safeParse({ action: 'confirm_no_assistant', note: '' }).success).toBe(false);
    expect(
      llmAssistantOutputSchema.safeParse({
        hasConversationalAssistant: 'yes',
        kind: 'AI_CHATBOT',
        vendor: 'Intercom',
        confidence: 0.9,
        reasons: ['launcher'],
        evidenceRefs: ['e1'],
      }).success,
    ).toBe(true);
  });
});

describe('crawl settings limits', () => {
  const fields = Object.keys(CRAWL_SETTINGS_LIMITS) as Array<keyof typeof CRAWL_SETTINGS_LIMITS>;

  it('accepts every numeric setting at its minimum and maximum', () => {
    for (const field of fields) {
      const { min, max } = CRAWL_SETTINGS_LIMITS[field];
      expect(crawlPipelineSettingsUpdateSchema.safeParse({ [field]: min }).success, `${field}=${min}`).toBe(true);
      expect(crawlPipelineSettingsUpdateSchema.safeParse({ [field]: max }).success, `${field}=${max}`).toBe(true);
    }
  });

  it('rejects values outside the range and fractions', () => {
    for (const field of fields) {
      const { min, max } = CRAWL_SETTINGS_LIMITS[field];
      expect(crawlPipelineSettingsUpdateSchema.safeParse({ [field]: min - 1 }).success, `${field}=${min - 1}`).toBe(false);
      expect(crawlPipelineSettingsUpdateSchema.safeParse({ [field]: max + 1 }).success, `${field}=${max + 1}`).toBe(false);
      expect(crawlPipelineSettingsUpdateSchema.safeParse({ [field]: min + 0.5 }).success, `${field}=${min + 0.5}`).toBe(false);
    }
  });

  it('limits the manual trigger batch size like the crawl batch size', () => {
    expect(crawlPipelineTriggerSchema.safeParse({ batchSize: CRAWL_SETTINGS_LIMITS.crawlBatchSize.max }).success).toBe(true);
    expect(crawlPipelineTriggerSchema.safeParse({ batchSize: CRAWL_SETTINGS_LIMITS.crawlBatchSize.max + 1 }).success).toBe(false);
    expect(crawlPipelineTriggerSchema.safeParse({ batchSize: 0 }).success).toBe(false);
  });
});
