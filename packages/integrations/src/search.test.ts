import { describe, expect, it, vi } from 'vitest';
import { CompositeDiscoverySource, linkWebsitesAcrossSources } from './composite';
import { createLiveDiscoverySource } from './factory';
import { createSearchDiscoverySource, mapSearchResult } from './search';

describe('Search API mapping', () => {
  it('maps organic/search results to internal records', () => {
    const mapped = mapSearchResult(
      { title: 'Smile Clinic', link: 'https://www.smile.example/', cid: 'c1' },
      { country: 'Singapore', city: 'Singapore' },
    );
    expect(mapped).toMatchObject({ source: 'search', domain: 'smile.example', externalId: 'c1' });
  });

  it('cleans page titles down to the business name', () => {
    const mapped = mapSearchResult(
      { title: 'Smile Dental | Best Dentist in Singapore', link: 'https://smiledental.com.sg/' },
      { country: 'Singapore', city: 'Singapore' },
    );
    expect(mapped?.name).toBe('Smile Dental');
    expect(mapped?.domain).toBe('smiledental.com.sg');
  });

  it('drops web results that point at directories or social pages', () => {
    expect(
      mapSearchResult(
        { title: 'Top 10 dentists in Singapore - Yelp', link: 'https://www.yelp.com.sg/search?q=dentist' },
        { country: 'Singapore', city: 'Singapore' },
      ),
    ).toBeNull();
  });

  it('keeps maps listings without a website (DataForSEO cid)', () => {
    const mapped = mapSearchResult(
      { title: 'Clinic - Tampines', cid: '42', phone: '+65 6000 0000' },
      { country: 'Singapore', city: 'Singapore' },
    );
    expect(mapped?.name).toBe('Clinic - Tampines');
    expect(mapped?.domain).toBeUndefined();
  });

  it('uses Google CSE when search env is set', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [{ title: 'Clinic', link: 'https://clinic.example' }] }),
    });
    const source = createSearchDiscoverySource(
      { SEARCH_API_KEY: 'k', SEARCH_ENGINE_ID: 'cx' },
      undefined,
      fetchImpl as unknown as typeof fetch,
    );
    const result = await source.discover({ country: 'Singapore', city: 'Singapore', keyword: 'dental' });
    expect(result[0]?.source).toBe('search');
  });

  it('uses DataForSEO when login env is set', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        tasks: [{ result: [{ items: [{ title: 'Clinic', url: 'https://clinic.example', cid: '9' }] }] }],
      }),
    });
    const source = createSearchDiscoverySource(
      { DATAFORSEO_LOGIN: 'user', DATAFORSEO_PASSWORD: 'pass' },
      undefined,
      fetchImpl as unknown as typeof fetch,
    );
    const result = await source.discover({ country: 'Singapore', city: 'Singapore', keyword: 'dental' });
    expect(result[0]?.externalId).toBe('9');
  });
});

describe('composite discovery', () => {
  it('merges providers and continues if one fails', async () => {
    const source = new CompositeDiscoverySource([
      {
        name: 'yelp',
        source: {
          async discover() {
            throw new Error('Yelp down');
          },
        },
      },
      {
        name: 'search',
        source: {
          async discover() {
            return [{ name: 'Clinic', domain: 'clinic.example', source: 'search' }];
          },
        },
      },
    ]);
    const result = await source.discover({ country: 'Singapore', city: 'Singapore', keyword: 'dental' });
    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe('search');
  });

  it('lets website-less rows borrow the website of a matching row from another provider', () => {
    const rows = linkWebsitesAcrossSources([
      { name: 'Smile Dental', domain: 'smiledental.com.sg', websiteUrl: 'https://smiledental.com.sg', phone: '+65 6123 4567', source: 'google_places' },
      { name: 'Smile Dental Clinic', phone: '6123 4567', source: 'yelp' },
      { name: 'SMILE DENTAL', source: 'yelp' },
      { name: 'Other Clinic', phone: '6999 0000', source: 'yelp' },
      { name: 'Other Clinic', phone: '+65 6999 0000', source: 'foursquare' },
    ]);
    expect(rows[1]?.domain).toBe('smiledental.com.sg');
    expect(rows[2]?.domain).toBe('smiledental.com.sg');
    expect(rows.filter((r) => r.name === 'Other Clinic')).toHaveLength(1);
  });

  it('builds an all-source adapter from configured env keys', () => {
    expect(() =>
      createLiveDiscoverySource('all', { YELP_API_KEY: 'y' }),
    ).not.toThrow();
  });
});
