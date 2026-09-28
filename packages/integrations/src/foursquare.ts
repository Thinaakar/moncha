import { z } from 'zod';
import type { DiscoveredCompany, DiscoverySource, Logger } from '@moncha/domain';
import { firstPartyDomain, firstPartyWebsite, readJson } from './http';

const SEARCH_FIELDS = 'fsq_id,name,location,website,tel';

const placeSchema = z
  .object({
    fsq_id: z.string().optional(),
    name: z.string().optional(),
    website: z.string().optional(),
    tel: z.string().optional(),
    location: z
      .object({
        formatted_address: z.string().optional(),
        locality: z.string().optional(),
        country: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const searchSchema = z.object({
  results: z.array(placeSchema).optional(),
});

export function mapFoursquarePlace(
  place: { fsq_id?: string; name?: string; location?: { formatted_address?: string; locality?: string } },
  details: { website?: string; tel?: string; name?: string; location?: { formatted_address?: string } } | undefined,
  input: { country: string; city: string },
): DiscoveredCompany | null {
  const name = (details?.name || place.name || '').trim();
  if (!name) return null;
  const website = firstPartyWebsite(details?.website);
  return {
    name,
    websiteUrl: website,
    domain: firstPartyDomain(details?.website),
    phone: details?.tel,
    address: details?.location?.formatted_address || place.location?.formatted_address,
    source: 'foursquare',
    externalId: place.fsq_id,
    raw: { place, details },
    country: input.country,
    city: place.location?.locality || input.city,
  };
}

export class FoursquareDiscoverySource implements DiscoverySource {
  constructor(
    private apiKey: string,
    private logger?: Logger,
    private fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiKey) throw new Error('FOURSQUARE_API_KEY is required');
  }

  async discover(input: { country: string; city: string; keyword: string }): Promise<DiscoveredCompany[]> {
    const near = `${input.city}, ${input.country}`;
    this.logger?.info('discovery_provider_request', { provider: 'foursquare', keyword: input.keyword, near });
    // Request website/tel in the search itself — no per-place details round trip.
    const searchUrl =
      `https://api.foursquare.com/v3/places/search?query=${encodeURIComponent(input.keyword)}` +
      `&near=${encodeURIComponent(near)}&limit=20&fields=${encodeURIComponent(SEARCH_FIELDS)}`;
    const json = await readJson(await this.fetchImpl(searchUrl, { headers: this.headers() }), 'Foursquare');
    const parsed = searchSchema.safeParse(json);
    if (!parsed.success) throw new Error('Foursquare returned a malformed response');

    const discovered: DiscoveredCompany[] = [];
    for (const place of parsed.data.results ?? []) {
      if (!place.fsq_id || !place.name) continue;
      const mapped = mapFoursquarePlace(place, place, input);
      if (mapped) discovered.push(mapped);
    }
    this.logger?.info('discovery_provider_results', { provider: 'foursquare', found: discovered.length });
    return discovered;
  }

  private headers() {
    return { Authorization: this.apiKey, Accept: 'application/json' };
  }
}
