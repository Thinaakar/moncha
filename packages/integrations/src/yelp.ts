import { z } from 'zod';
import type { DiscoveredCompany, DiscoverySource, Logger } from '@moncha/domain';
import { firstPartyDomain, firstPartyWebsite, readJson } from './http';

const yelpSearchSchema = z.object({
  businesses: z
    .array(
      z
        .object({
          id: z.string().optional(),
          name: z.string().optional(),
          url: z.string().optional(),
          phone: z.string().optional(),
          display_phone: z.string().optional(),
          location: z
            .object({
              city: z.string().optional(),
              country: z.string().optional(),
              display_address: z.array(z.string()).optional(),
            })
            .passthrough()
            .optional(),
        })
        .passthrough(),
    )
    .optional(),
});

export function mapYelpBusiness(
  business: {
    id?: string;
    name?: string;
    url?: string;
    phone?: string;
    display_phone?: string;
    location?: { city?: string; country?: string; display_address?: string[] };
  },
  input: { country: string; city: string },
): DiscoveredCompany | null {
  const name = (business.name || '').trim();
  if (!name) return null;
  const website = firstPartyWebsite(business.url);
  return {
    name,
    websiteUrl: website,
    domain: firstPartyDomain(business.url),
    phone: business.display_phone || business.phone,
    address: business.location?.display_address?.join(', '),
    source: 'yelp',
    externalId: business.id,
    raw: business,
    country: input.country,
    city: business.location?.city || input.city,
  };
}

export class YelpDiscoverySource implements DiscoverySource {
  constructor(
    private apiKey: string,
    private logger?: Logger,
    private fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiKey) throw new Error('YELP_API_KEY is required');
  }

  async discover(input: { country: string; city: string; keyword: string }): Promise<DiscoveredCompany[]> {
    const location = `${input.city}, ${input.country}`;
    this.logger?.info('discovery_provider_request', { provider: 'yelp', keyword: input.keyword, location });
    const url = `https://api.yelp.com/v3/businesses/search?term=${encodeURIComponent(input.keyword)}&location=${encodeURIComponent(location)}&limit=20`;
    const json = await readJson(
      await this.fetchImpl(url, { headers: { Authorization: `Bearer ${this.apiKey}` } }),
      'Yelp',
    );
    const parsed = yelpSearchSchema.safeParse(json);
    if (!parsed.success) throw new Error('Yelp returned a malformed response');
    const discovered = (parsed.data.businesses ?? [])
      .map((business) => mapYelpBusiness(business, input))
      .filter((item): item is DiscoveredCompany => Boolean(item));
    this.logger?.info('discovery_provider_results', { provider: 'yelp', found: discovered.length });
    return discovered;
  }
}
