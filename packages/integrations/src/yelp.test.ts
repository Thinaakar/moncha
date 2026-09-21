import { describe, expect, it, vi } from 'vitest';
import { mapYelpBusiness, YelpDiscoverySource } from './yelp';

describe('Yelp mapping', () => {
  it('maps a business and ignores yelp.com as a company domain', () => {
    const mapped = mapYelpBusiness(
      {
        id: 'y1',
        name: 'Smile Clinic',
        url: 'https://www.yelp.com/biz/smile-clinic',
        display_phone: '123',
        location: { city: 'Singapore', display_address: ['1 Orchard Rd'] },
      },
      { country: 'Singapore', city: 'Singapore' },
    );
    expect(mapped).toMatchObject({
      name: 'Smile Clinic',
      source: 'yelp',
      externalId: 'y1',
      domain: undefined,
    });
  });

  it('keeps a first-party website when present', () => {
    const mapped = mapYelpBusiness(
      { id: 'y2', name: 'Clinic', url: 'https://www.smile.example/' },
      { country: 'Singapore', city: 'Singapore' },
    );
    expect(mapped?.domain).toBe('smile.example');
  });

  it('calls the Yelp search API', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        businesses: [{ id: 'y1', name: 'Clinic', url: 'https://clinic.example' }],
      }),
    });
    const source = new YelpDiscoverySource('yelp-key', undefined, fetchImpl as unknown as typeof fetch);
    const result = await source.discover({ country: 'Singapore', city: 'Singapore', keyword: 'dental' });
    expect(result[0]?.source).toBe('yelp');
    expect(fetchImpl).toHaveBeenCalled();
    expect(String(fetchImpl.mock.calls[0]?.[1]?.headers?.Authorization)).toContain('Bearer');
  });
});
