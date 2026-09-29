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

  it('does not use a Facebook/Instagram page as the company website', () => {
    for (const website of ['https://www.facebook.com/smileclinic', 'https://instagram.com/smile', 'https://m.facebook.com/x']) {
      const mapped = mapNewPlaceToDiscoveredCompany(
        { id: 'p2', displayName: { text: 'Smile' }, websiteUri: website },
        { country: 'Singapore', city: 'Singapore' },
      );
      expect(mapped?.domain).toBeUndefined();
      expect(mapped?.websiteUrl).toBeUndefined();
    }
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

  it('fetches one page by default even when more are available', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ places: [{ id: 'p1', displayName: { text: 'A' } }], nextPageToken: 'next' }),
    }));
    const source = new GooglePlacesDiscoverySource('test-key', undefined, fetchImpl as unknown as typeof fetch);
    await source.discover({ country: 'Singapore', city: 'Singapore', keyword: 'dental' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(source.requestCount).toBe(1);
  });

  it('follows nextPageToken up to maxPages with region and language hints', async () => {
    const pages = [
      { places: [{ id: 'p1', displayName: { text: 'A' } }], nextPageToken: 't2' },
      { places: [{ id: 'p2', displayName: { text: 'B' } }, { id: 'p1', displayName: { text: 'A' } }], nextPageToken: 't3' },
      { places: [{ id: 'p3', displayName: { text: 'C' } }], nextPageToken: 't4' },
    ];
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: string, init: { body: string; headers: Record<string, string> }) => {
      expect(init.headers['X-Goog-FieldMask']).toContain('nextPageToken');
      bodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => pages[bodies.length - 1] };
    });
    const source = new GooglePlacesDiscoverySource('test-key', undefined, fetchImpl as unknown as typeof fetch);
    const result = await source.discover({
      country: 'Japan',
      city: 'Shinjuku, Tokyo',
      keyword: 'dentist',
      maxPages: 5,
      regionCode: 'JP',
      languageCode: 'ja',
    });
    expect(result.map((r) => r.externalId)).toEqual(['p1', 'p2', 'p3']);
    expect(source.requestCount).toBe(3);
    expect(bodies[0]).toEqual({ textQuery: 'dentist in Shinjuku, Tokyo, Japan', pageSize: 20, languageCode: 'ja', regionCode: 'JP' });
    expect(bodies[1]).toMatchObject({ pageToken: 't2', textQuery: 'dentist in Shinjuku, Tokyo, Japan' });
    expect(bodies[2]).toMatchObject({ pageToken: 't3' });
  });

  it('stops paging when there is no nextPageToken', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ places: [{ id: 'p1', displayName: { text: 'A' } }] }) }));
    const source = new GooglePlacesDiscoverySource('test-key', undefined, fetchImpl as unknown as typeof fetch);
    await source.discover({ country: 'Malaysia', city: 'Ipoh, Perak', keyword: 'gym', maxPages: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
