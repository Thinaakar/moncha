import { describe, expect, it } from 'vitest';
import { leadListQuerySchema, manualLeadSchema, sourceImportSchema } from './index';

describe('API validation', () => {
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

  it('caps pagination and supports filters', () => {
    expect(leadListQuerySchema.parse({}).pageSize).toBe(25);
    expect(leadListQuerySchema.safeParse({ pageSize: 1000 }).success).toBe(false);
    expect(
      leadListQuerySchema.parse({ page: '2', pageSize: '10', search: 'dental', country: 'Singapore', status: 'discovered' }),
    ).toMatchObject({ page: 2, pageSize: 10, search: 'dental', country: 'Singapore', status: 'discovered' });
  });
});
