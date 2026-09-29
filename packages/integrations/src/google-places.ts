import { z } from 'zod';
import type { DiscoverInput, DiscoveredCompany, DiscoverySource, Logger } from '@moncha/domain';
import { firstPartyDomain, firstPartyWebsite } from './http';

const placeSchema = z
  .object({
    id: z.string().optional(),
    displayName: z
      .object({
        text: z.string().optional(),
      })
      .passthrough()
      .optional(),
    formattedAddress: z.string().optional(),
    websiteUri: z.string().optional(),
    nationalPhoneNumber: z.string().optional(),
    internationalPhoneNumber: z.string().optional(),
  })
  .passthrough();

const textSearchResponseSchema = z.object({
  places: z.array(placeSchema).optional(),
  nextPageToken: z.string().optional(),
  error: z
    .object({
      code: z.number().optional(),
      message: z.string().optional(),
      status: z.string().optional(),
    })
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

const FIELD_MASK = [
  // Text Search (New) omits the token unless it is in the field mask.
  'nextPageToken',
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
].join(',');

export function mapPlaceToDiscoveredCompany(
  place: GooglePlacesTextResult,
  details: GooglePlacesDetails | undefined,
  input: { country: string; city: string },
): DiscoveredCompany | null {
  const name = (details?.name || place.name || '').trim();
  if (!name) return null;
  // Places often lists a Facebook/Instagram page as the "website" — not a company domain.
  const website = firstPartyWebsite(details?.website);
  return {
    name,
    websiteUrl: website,
    domain: firstPartyDomain(details?.website),
    address: details?.formatted_address || place.formatted_address,
    phone: details?.international_phone_number || details?.formatted_phone_number,
    source: 'google_places',
    externalId: normalizePlaceId(details?.place_id || place.place_id),
    raw: { place, details },
    country: input.country,
    city: input.city,
  };
}

function normalizePlaceId(value?: string): string | undefined {
  if (!value) return undefined;
  return value.startsWith('places/') ? value.slice('places/'.length) : value;
}

export function mapNewPlaceToDiscoveredCompany(
  place: z.infer<typeof placeSchema>,
  input: { country: string; city: string },
): DiscoveredCompany | null {
  return mapPlaceToDiscoveredCompany(
    {
      place_id: place.id,
      name: place.displayName?.text,
      formatted_address: place.formattedAddress,
    },
    {
      place_id: place.id,
      name: place.displayName?.text,
      formatted_address: place.formattedAddress,
      website: place.websiteUri,
      formatted_phone_number: place.nationalPhoneNumber,
      international_phone_number: place.internationalPhoneNumber,
    },
    input,
  );
}

/** Text Search (New) returns at most 3 pages of 20. */
const MAX_PAGES = 3;

export class GooglePlacesDiscoverySource implements DiscoverySource {
  private requests = 0;

  constructor(
    private apiKey: string,
    private logger?: Logger,
    private fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY is required');
  }

  /** HTTP requests sent to Places so far (including retries); each one is billable. */
  get requestCount() {
    return this.requests;
  }

  async discover(input: DiscoverInput): Promise<DiscoveredCompany[]> {
    const query = `${input.keyword} in ${input.city}, ${input.country}`;
    const maxPages = Math.min(MAX_PAGES, Math.max(1, input.maxPages ?? 1));
    this.logger?.info('discovery_provider_request', { provider: 'google_places', query, maxPages });

    const discovered: DiscoveredCompany[] = [];
    const seen = new Set<string>();
    let pageToken: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const search = await this.searchText({
        textQuery: query,
        pageToken,
        languageCode: input.languageCode,
        regionCode: input.regionCode,
      });
      for (const place of search.places ?? []) {
        const mapped = mapNewPlaceToDiscoveredCompany(place, input);
        if (!mapped) {
          this.logger?.info('normalized_record_skipped', { reason: 'malformed_provider_row' });
          continue;
        }
        if (mapped.externalId) {
          if (seen.has(mapped.externalId)) continue;
          seen.add(mapped.externalId);
        }
        discovered.push(mapped);
      }
      pageToken = search.nextPageToken;
      if (!pageToken) break;
      if (page + 1 >= maxPages) {
        this.logger?.info('discovery_provider_pagination_capped', { provider: 'google_places', maxPages });
      }
    }

    this.logger?.info('discovery_provider_results', { provider: 'google_places', found: discovered.length });
    return discovered;
  }

  private async searchText(params: {
    textQuery: string;
    pageToken?: string;
    languageCode?: string;
    regionCode?: string;
  }) {
    const body: Record<string, unknown> = { textQuery: params.textQuery, pageSize: 20 };
    if (params.pageToken) body.pageToken = params.pageToken;
    if (params.languageCode) body.languageCode = params.languageCode;
    if (params.regionCode) body.regionCode = params.regionCode;

    let lastError = 'UNKNOWN_ERROR';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      this.requests += 1;
      const response = await this.fetchImpl('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify(body),
      });

      const json: unknown = await response.json().catch(() => ({}));
      const parsed = textSearchResponseSchema.safeParse(json);
      if (!parsed.success) {
        if (!response.ok) {
          throw new Error(`Google Places HTTP ${response.status}`);
        }
        throw new Error('Google Places returned a malformed response');
      }

      if (!response.ok) {
        const status = parsed.data.error?.status || `HTTP_${response.status}`;
        const message = parsed.data.error?.message;
        lastError = status;
        if (response.status === 429 || status === 'RESOURCE_EXHAUSTED') {
          await sleep(400 * 2 ** attempt);
          continue;
        }
        throw new Error(providerError(status, message));
      }

      return parsed.data;
    }
    throw new Error(providerError(lastError));
  }
}

function providerError(status: string, message?: string): string {
  if (status === 'OVER_QUERY_LIMIT' || status === 'RESOURCE_EXHAUSTED') return 'Google Places rate limited';
  if (status === 'REQUEST_DENIED' || status === 'PERMISSION_DENIED') {
    return message ? `Google Places request denied: ${message}` : 'Google Places request denied';
  }
  if (status === 'INVALID_REQUEST' || status === 'INVALID_ARGUMENT') return 'Google Places invalid request';
  return message ? `Google Places ${status}: ${message}` : `Google Places ${status}`;
}
