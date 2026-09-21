import { describe, expect, it, vi } from 'vitest';
import { FoursquareDiscoverySource, mapFoursquarePlace } from './foursquare';

describe('Foursquare mapping', () => {
  it('maps place details website onto a discovered company', () => {
    const mapped = mapFoursquarePlace(
      { fsq_id: 'f1', name: 'Clinic', location: { formatted_address: 'SG', locality: 'Singapore' } },
      { name: 'Clinic', website: 'https://www.clinic.example', tel: '123' },
      { country: 'Singapore', city: 'Singapore' },
    );
    expect(mapped).toMatchObject({
      source: 'foursquare',
      externalId: 'f1',
      domain: 'clinic.example',
      phone: '123',
    });
  });

  it('fetches search then place details', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/places/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ results: [{ fsq_id: 'f1', name: 'Clinic' }] }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ fsq_id: 'f1', name: 'Clinic', website: 'https://clinic.example' }),
      };
    });
    const source = new FoursquareDiscoverySource('fsq-key', undefined, fetchImpl as unknown as typeof fetch);
    const result = await source.discover({ country: 'Singapore', city: 'Singapore', keyword: 'dental' });
    expect(result[0]?.domain).toBe('clinic.example');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
