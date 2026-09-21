import { describe, expect, it, vi } from 'vitest';
import { CompositeDiscoverySource } from './composite';
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

  it('builds an all-source adapter from configured env keys', () => {
    expect(() =>
      createLiveDiscoverySource('all', { YELP_API_KEY: 'y' }),
    ).not.toThrow();
  });
});
