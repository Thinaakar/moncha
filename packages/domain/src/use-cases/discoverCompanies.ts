import type {
  CompanyRecord,
  CompanyRepo,
  DiscoverySearchOptions,
  DiscoverySource,
  JobRepo,
  LeadRepo,
  Logger,
  WebsiteRepo,
} from '../ports';
import type { AuditConfig } from '../config/audit';
import { canonicalDomain } from '../entities/company';
import { ingestDiscoveredRecord } from './ingestDiscoveredRecord';

export type DiscoverCompaniesInput = {
  tenantId: string;
  country: string;
  city: string;
  keyword: string;
  search?: DiscoverySearchOptions;
  /** Records ingested in parallel. Ingest tolerates same-domain races. Defaults to 1. */
  concurrency?: number;
};

export type DiscoverCompaniesResult = {
  found: number;
  created: number;
  duplicates: number;
  skipped: number;
  auditsEnqueued: number;
  noWebsite: number;
  companies: CompanyRecord[];
};

export async function discoverCompanies(
  deps: {
    source: DiscoverySource;
    companies: CompanyRepo;
    leads: LeadRepo;
    websites?: WebsiteRepo;
    jobs?: JobRepo;
    logger?: Logger;
    config?: AuditConfig;
  },
  input: DiscoverCompaniesInput,
): Promise<DiscoverCompaniesResult> {
  deps.logger?.info('discovery_provider_request', {
    tenantId: input.tenantId,
    country: input.country,
    city: input.city,
    keyword: input.keyword,
  });

  const found = await deps.source.discover({
    ...input.search,
    country: input.country,
    city: input.city,
    keyword: input.keyword,
  });

  deps.logger?.info('discovery_provider_results', { tenantId: input.tenantId, found: found.length });

  let created = 0;
  let duplicates = 0;
  let skipped = 0;
  let auditsEnqueued = 0;
  let noWebsite = 0;
  const companies: CompanyRecord[] = [];

  const ingestOne = async (item: (typeof found)[number]) => {
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
      { requireDomain: false },
    );

    if (result.skipped) {
      skipped += 1;
      return;
    }
    companies.push(result.company);
    if (result.created) created += 1;
    if (result.duplicate) duplicates += 1;
    if (result.auditEnqueued) auditsEnqueued += 1;
    if (result.lead.queue === 'NO_WEBSITE') noWebsite += 1;
  };

  // Branches of one chain often share a website; keep same-domain records in one sequential group
  // so parallel ingests never race on the same company/website rows.
  const groups = new Map<string, typeof found>();
  found.forEach((item, i) => {
    const key = canonicalDomain(item.domain ?? item.websiteUrl) ?? `#${i}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });
  const queue = [...groups.values()];
  const workers = Array.from({ length: Math.max(1, Math.min(input.concurrency ?? 1, queue.length)) }, async () => {
    for (let group = queue.shift(); group; group = queue.shift()) {
      for (const item of group) await ingestOne(item);
    }
  });
  await Promise.all(workers);

  return { found: found.length, created, duplicates, skipped, auditsEnqueued, noWebsite, companies };
}
