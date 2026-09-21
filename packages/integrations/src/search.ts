import { z } from 'zod';
import type { DiscoveredCompany, DiscoverySource, Logger } from '@moncha/domain';
import { firstPartyDomain, firstPartyWebsite, readJson } from './http';

const cseSchema = z.object({
  items: z
    .array(
      z
        .object({
          title: z.string().optional(),
          link: z.string().optional(),
          displayLink: z.string().optional(),
          snippet: z.string().optional(),
        })
        .passthrough(),
    )
    .optional(),
});

const dataForSeoSchema = z.object({
  tasks: z
    .array(
      z
        .object({
          status_code: z.number().optional(),
          status_message: z.string().optional(),
          result: z
            .array(
              z
                .object({
                  items: z
                    .array(
                      z
                        .object({
                          title: z.string().optional(),
                          url: z.string().optional(),
                          domain: z.string().optional(),
                          phone: z.string().optional(),
                          address: z.string().optional(),
                          cid: z.string().optional(),
                        })
                        .passthrough(),
                    )
                    .optional(),
                })
                .passthrough(),
            )
            .optional(),
        })
        .passthrough(),
    )
    .optional(),
});

export function mapSearchResult(
  item: { title?: string; link?: string; url?: string; domain?: string; phone?: string; address?: string; cid?: string },
  input: { country: string; city: string },
): DiscoveredCompany | null {
  const name = (item.title || '').trim();
  const website = firstPartyWebsite(item.url || item.link || item.domain);
  if (!name) return null;
  return {
    name,
    websiteUrl: website,
    domain: firstPartyDomain(item.url || item.link || item.domain),
    phone: item.phone,
    address: item.address,
    source: 'search',
    externalId: item.cid || website || name,
    raw: item,
    country: input.country,
    city: input.city,
  };
}

export class GoogleCseDiscoverySource implements DiscoverySource {
  constructor(
    private apiKey: string,
    private engineId: string,
    private logger?: Logger,
    private fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiKey || !engineId) throw new Error('SEARCH_API_KEY and SEARCH_ENGINE_ID are required');
  }

  async discover(input: { country: string; city: string; keyword: string }): Promise<DiscoveredCompany[]> {
    const q = `${input.keyword} ${input.city} ${input.country}`;
    this.logger?.info('discovery_provider_request', { provider: 'search', backend: 'google_cse', q });
    const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(this.apiKey)}&cx=${encodeURIComponent(this.engineId)}&q=${encodeURIComponent(q)}&num=10`;
    const json = await readJson(await this.fetchImpl(url), 'Search API');
    const parsed = cseSchema.safeParse(json);
    if (!parsed.success) throw new Error('Search API returned a malformed response');
    const discovered = (parsed.data.items ?? [])
      .map((item) => mapSearchResult(item, input))
      .filter((item): item is DiscoveredCompany => Boolean(item));
    this.logger?.info('discovery_provider_results', { provider: 'search', found: discovered.length });
    return discovered;
  }
}

export class DataForSeoDiscoverySource implements DiscoverySource {
  constructor(
    private login: string,
    private password: string,
    private logger?: Logger,
    private fetchImpl: typeof fetch = fetch,
  ) {
    if (!login || !password) throw new Error('DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are required');
  }

  async discover(input: { country: string; city: string; keyword: string }): Promise<DiscoveredCompany[]> {
    this.logger?.info('discovery_provider_request', {
      provider: 'search',
      backend: 'dataforseo',
      keyword: input.keyword,
    });
    const auth = btoa(`${this.login}:${this.password}`);
    const json = await readJson(
      await this.fetchImpl('https://api.dataforseo.com/v3/business_data/google/maps/search/live', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify([
          {
            keyword: input.keyword,
            location_name: `${input.city},${input.country}`,
            language_code: 'en',
          },
        ]),
      }),
      'Search API',
    );
    const parsed = dataForSeoSchema.safeParse(json);
    if (!parsed.success) throw new Error('Search API returned a malformed response');
    const task = parsed.data.tasks?.[0];
    if (task?.status_code && task.status_code >= 40000) {
      throw new Error(task.status_message || 'Search API request failed');
    }
    const items = task?.result?.[0]?.items ?? [];
    const discovered = items
      .map((item) => mapSearchResult(item, input))
      .filter((item): item is DiscoveredCompany => Boolean(item));
    this.logger?.info('discovery_provider_results', { provider: 'search', found: discovered.length });
    return discovered;
  }
}

export function createSearchDiscoverySource(
  env: Record<string, string | undefined>,
  logger?: Logger,
  fetchImpl: typeof fetch = fetch,
): DiscoverySource {
  if (env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD) {
    return new DataForSeoDiscoverySource(env.DATAFORSEO_LOGIN, env.DATAFORSEO_PASSWORD, logger, fetchImpl);
  }
  if (env.SEARCH_API_KEY && env.SEARCH_ENGINE_ID) {
    return new GoogleCseDiscoverySource(env.SEARCH_API_KEY, env.SEARCH_ENGINE_ID, logger, fetchImpl);
  }
  throw new Error('Search API requires DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD or SEARCH_API_KEY/SEARCH_ENGINE_ID');
}
