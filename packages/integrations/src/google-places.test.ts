import { describe, expect, it, vi } from 'vitest';
import { GooglePlacesDiscoverySource, mapPlaceToDiscoveredCompany } from './google-places';

describe('Google Places mapping', () => {
  it('maps provider payloads into internal records with a domain', () => {
    const mapped = mapPlaceToDiscoveredCompany(
      { place_id: 'abc', name: 'Smile Clinic', formatted_address: '1 Orchard Rd' },
      { place_id: 'abc', name: 'Smile Clinic', website: 'https://www.smile.example/', formatted_phone_number: '123' },
      { country: 'Singapore', city: 'Singapore' },
    );
    expect(mapped).toMatchObject({
      name: 'Smile Clinic',
      domain: 'smile.example',
      source: 'google_places',
      externalId: 'abc',
      phone: '123',
    });
  });

  it('skips malformed rows without a name', () => {
    expect(
      mapPlaceToDiscoveredCompany({ place_id: 'abc' }, undefined, { country: 'Singapore', city: 'Singapore' }),
    ).toBeNull();
  });

  it('returns an empty list for ZERO_RESULTS', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ZERO_RESULTS', results: [] }),
    });
    const source = new GooglePlacesDiscoverySource('test-key', undefined, fetchImpl as unknown as typeof fetch);
    const result = await source.discover({ country: 'Singapore', city: 'Singapore', keyword: 'dental' });
    expect(result).toEqual([]);
  });

  it('fetches Place Details website onto discovered companies', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('textsearch')) {
        return {
          ok: true,
          json: async () => ({
            status: 'OK',
            results: [{ place_id: 'p1', name: 'Clinic', formatted_address: 'SG' }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          status: 'OK',
          result: { place_id: 'p1', name: 'Clinic', website: 'https://clinic.example' },
        }),
      };
    });
    const source = new GooglePlacesDiscoverySource('test-key', undefined, fetchImpl as unknown as typeof fetch);
    const result = await source.discover({ country: 'Singapore', city: 'Singapore', keyword: 'dental' });
    expect(result[0]?.domain).toBe('clinic.example');
    expect(result[0]?.externalId).toBe('p1');
  });
});
