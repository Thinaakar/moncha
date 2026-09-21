import type { CompanyRecord, CompanyRepo, DiscoverySource, LeadRepo, Logger } from '../ports';
import { ingestDiscoveredRecord } from './ingestDiscoveredRecord';

export type DiscoverCompaniesInput = {
  tenantId: string;
  country: string;
  city: string;
  keyword: string;
};

export type DiscoverCompaniesResult = {
  found: number;
  created: number;
  duplicates: number;
  skipped: number;
  companies: CompanyRecord[];
};

export async function discoverCompanies(
  deps: { source: DiscoverySource; companies: CompanyRepo; leads: LeadRepo; logger?: Logger },
  input: DiscoverCompaniesInput,
): Promise<DiscoverCompaniesResult> {
  deps.logger?.info('discovery_provider_request', {
    tenantId: input.tenantId,
    country: input.country,
    city: input.city,
    keyword: input.keyword,
  });

  const found = await deps.source.discover({
    country: input.country,
    city: input.city,
    keyword: input.keyword,
  });

  deps.logger?.info('discovery_provider_results', { tenantId: input.tenantId, found: found.length });

  let created = 0;
  let duplicates = 0;
  let skipped = 0;
  const companies: CompanyRecord[] = [];

  for (const item of found) {
    const result = await ingestDiscoveredRecord(
      deps,
      {
        tenantId: input.tenantId,
        name: item.name,
        domain: item.domain ?? item.websiteUrl,
        websiteUrl: item.websiteUrl ?? item.domain,
        country: item.country || input.country,
        city: item.city || input.city,
        phone: item.phone,
        address: item.address,
        source: item.source,
        externalId: item.externalId,
        raw: item.raw,
      },
      { requireDomain: true },
    );

    if (result.skipped) {
      skipped += 1;
      continue;
    }
    companies.push(result.company);
    if (result.created) created += 1;
    if (result.duplicate) duplicates += 1;
  }

  return { found: found.length, created, duplicates, skipped, companies };
}
