import { describe, expect, it, vi } from 'vitest';
import {
  GooglePlacesDiscoverySource,
  mapNewPlaceToDiscoveredCompany,
  mapPlaceToDiscoveredCompany,
} from './google-places';

describe('Google Places mapping', () => {
  it('maps provider payloads into internal records with a domain', () => {
    const mapped = mapPlaceToDiscoveredCompany(
      { place_id: 'abc', name: 'Smile Clinic', formatted_address: '1 Orchard Rd' },
      {
        place_id: 'abc',
        name: 'Smile Clinic',
        website: 'https://www.smile.example/',
        formatted_phone_number: '123',
      },
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

  it('maps Places API New payloads and strips places/ prefix', () => {
    const mapped = mapNewPlaceToDiscoveredCompany(
      {
        id: 'places/p1',
        displayName: { text: 'Clinic' },
        formattedAddress: 'SG',
        websiteUri: 'https://clinic.example',
        internationalPhoneNumber: '+65 123',
      },
      { country: 'Singapore', city: 'Singapore' },
    );
    expect(mapped).toMatchObject({
      name: 'Clinic',
      domain: 'clinic.example',
      externalId: 'p1',
      phone: '+65 123',
      source: 'google_places',
    });
  });

  it('skips malformed rows without a name', () => {
    expect(
      mapPlaceToDiscoveredCompany({ place_id: 'abc' }, undefined, {
        country: 'Singapore',
        city: 'Singapore',
      }),
    ).toBeNull();
  });

  it('returns an empty list when Places API New returns no places', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ places: [] }),
    });
    const source = new GooglePlacesDiscoverySource('test-key', undefined, fetchImpl as unknown as typeof fetch);
    const result = await source.discover({ country: 'Singapore', city: 'Singapore', keyword: 'dental' });
    expect(result).toEqual([]);
  });

  it('maps websiteUri from Text Search New without a second details call', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        places: [
          {
            id: 'places/p1',
            displayName: { text: 'Clinic' },
            formattedAddress: 'SG',
            websiteUri: 'https://clinic.example',
          },
        ],
      }),
    }));
    const source = new GooglePlacesDiscoverySource('test-key', undefined, fetchImpl as unknown as typeof fetch);
    const result = await source.discover({ country: 'Singapore', city: 'Singapore', keyword: 'dental' });
    expect(result[0]?.domain).toBe('clinic.example');
    expect(result[0]?.externalId).toBe('p1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('places.googleapis.com/v1/places:searchText');
  });
});
