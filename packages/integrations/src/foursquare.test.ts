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

  it('requests website/tel in the search call (no per-place details requests)', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          { fsq_id: 'f1', name: 'Clinic', website: 'https://clinic.example', tel: '+65 6000 0000' },
          { fsq_id: 'f2', name: 'Social Only', website: 'https://www.facebook.com/socialonly' },
        ],
      }),
    }));
    const source = new FoursquareDiscoverySource('fsq-key', undefined, fetchImpl as unknown as typeof fetch);
    const result = await source.discover({ country: 'Singapore', city: 'Singapore', keyword: 'dental' });
    expect(result[0]?.domain).toBe('clinic.example');
    expect(result[0]?.phone).toBe('+65 6000 0000');
    expect(result[1]?.domain).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toContain('fields=');
  });
});
