import { z } from 'zod';
import type { DiscoveredCompany, DiscoverySource, Logger } from '@moncha/domain';
import { canonicalDomain } from '@moncha/domain';

const textSearchResponseSchema = z.object({
  status: z.string(),
  error_message: z.string().optional(),
  next_page_token: z.string().optional(),
  results: z
    .array(
      z
        .object({
          place_id: z.string().optional(),
          name: z.string().optional(),
          formatted_address: z.string().optional(),
        })
        .passthrough(),
    )
    .optional(),
});

const placeDetailsResponseSchema = z.object({
  status: z.string(),
  error_message: z.string().optional(),
  result: z
    .object({
      place_id: z.string().optional(),
      name: z.string().optional(),
      formatted_address: z.string().optional(),
      website: z.string().optional(),
      formatted_phone_number: z.string().optional(),
      international_phone_number: z.string().optional(),
    })
    .passthrough()
    .optional(),
});

export type GooglePlacesTextResult = {
  place_id?: string;
  name?: string;
  formatted_address?: string;
};

export type GooglePlacesDetails = {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  website?: string;
  formatted_phone_number?: string;
  international_phone_number?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function mapPlaceToDiscoveredCompany(
  place: GooglePlacesTextResult,
  details: GooglePlacesDetails | undefined,
  input: { country: string; city: string },
): DiscoveredCompany | null {
  const name = (details?.name || place.name || '').trim();
  if (!name) return null;
  const website = details?.website;
  return {
    name,
    websiteUrl: website,
    domain: canonicalDomain(website),
    address: details?.formatted_address || place.formatted_address,
    phone: details?.international_phone_number || details?.formatted_phone_number,
    source: 'google_places',
    externalId: details?.place_id || place.place_id,
    raw: { place, details },
    country: input.country,
    city: input.city,
  };
}

export class GooglePlacesDiscoverySource implements DiscoverySource {
  constructor(
    private apiKey: string,
    private logger?: Logger,
    private fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY is required');
  }

  async discover(input: { country: string; city: string; keyword: string }): Promise<DiscoveredCompany[]> {
    const query = `${input.keyword} in ${input.city}, ${input.country}`;
    this.logger?.info('discovery_provider_request', { provider: 'google_places', query });
    const search = await this.googleGet(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${this.apiKey}`,
      textSearchResponseSchema,
    );

    if (search.status === 'ZERO_RESULTS') {
      this.logger?.info('discovery_provider_results', { provider: 'google_places', found: 0 });
      return [];
    }
    if (search.status !== 'OK') {
      throw new Error(providerError(search.status, search.error_message));
    }
    if (search.next_page_token) {
      this.logger?.info('discovery_provider_pagination_ignored', {
        provider: 'google_places',
        hasNextPage: true,
      });
    }

    const places = search.results ?? [];
    const discovered: DiscoveredCompany[] = [];
    for (const place of places) {
      if (!place.place_id || !place.name) {
        this.logger?.info('normalized_record_skipped', { reason: 'malformed_provider_row' });
        continue;
      }
      const details = await this.fetchDetails(place.place_id);
      const mapped = mapPlaceToDiscoveredCompany(place, details, input);
      if (mapped) discovered.push(mapped);
    }

    this.logger?.info('discovery_provider_results', { provider: 'google_places', found: discovered.length });
    return discovered;
  }

  private async fetchDetails(placeId: string): Promise<GooglePlacesDetails | undefined> {
    const fields = 'website,formatted_phone_number,international_phone_number,name,formatted_address,place_id';
    const details = await this.googleGet(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=${fields}&key=${this.apiKey}`,
      placeDetailsResponseSchema,
    );
    if (details.status === 'ZERO_RESULTS' || details.status === 'NOT_FOUND') return undefined;
    if (details.status !== 'OK') {
      throw new Error(providerError(details.status, details.error_message));
    }
    return details.result;
  }

  private async googleGet<T>(url: string, schema: z.ZodType<T>, attempts = 3): Promise<T> {
    let lastStatus = 'UNKNOWN_ERROR';
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const response = await this.fetchImpl(url);
      if (!response.ok) {
        throw new Error(`Google Places HTTP ${response.status}`);
      }
      const json: unknown = await response.json();
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new Error('Google Places returned a malformed response');
      }
      const status = (parsed.data as { status: string }).status;
      lastStatus = status;
      if (status === 'OVER_QUERY_LIMIT' || status === 'UNKNOWN_ERROR') {
        await sleep(400 * 2 ** attempt);
        continue;
      }
      return parsed.data;
    }
    throw new Error(providerError(lastStatus));
  }
}

function providerError(status: string, message?: string): string {
  if (status === 'OVER_QUERY_LIMIT') return 'Google Places rate limited';
  if (status === 'REQUEST_DENIED') return 'Google Places request denied';
  if (status === 'INVALID_REQUEST') return 'Google Places invalid request';
  return message ? `Google Places ${status}` : `Google Places ${status}`;
}
