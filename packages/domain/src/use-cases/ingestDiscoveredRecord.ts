import {
  canonicalDomain,
  normalizeCity,
  normalizeCompanyName,
  normalizeCountry,
  normalizeWebsiteUrl,
} from '../entities/company';
import type { CompanyRecord, CompanyRepo, LeadRecord, LeadRepo, Logger } from '../ports';

export type IngestInput = {
  tenantId: string;
  name: string;
  domain?: string;
  websiteUrl?: string;
  country?: string;
  city?: string;
  phone?: string;
  address?: string;
  source: string;
  externalId?: string;
  raw?: unknown;
};

export type IngestResult =
  | {
      skipped: true;
      reason: 'missing_name' | 'missing_domain';
      company?: undefined;
      lead?: undefined;
      created: false;
      duplicate: false;
    }
  | {
      skipped: false;
      reason?: undefined;
      company: CompanyRecord;
      lead: LeadRecord;
      created: boolean;
      duplicate: boolean;
    };

export type IngestDeps = {
  companies: CompanyRepo;
  leads: LeadRepo;
  logger?: Logger;
};

function fillBlanks(existing: CompanyRecord, incoming: {
  name: string;
  country?: string;
  city?: string;
  phone?: string;
  address?: string;
}) {
  return {
    name: existing.name || incoming.name,
    country: existing.country || incoming.country || undefined,
    city: existing.city || incoming.city || undefined,
    phone: existing.phone || incoming.phone || undefined,
    address: existing.address || incoming.address || undefined,
  };
}

async function ensureLead(leads: LeadRepo, tenantId: string, companyId: string): Promise<LeadRecord> {
  const existing = await leads.findByCompany(tenantId, companyId);
  if (existing) return existing;
  try {
    return await leads.create({ tenantId, companyId, status: 'discovered' });
  } catch {
    const raced = await leads.findByCompany(tenantId, companyId);
    if (raced) return raced;
    throw new Error('Failed to create lead');
  }
}

async function attachSource(
  companies: CompanyRepo,
  input: IngestInput,
  companyId: string,
  createdCompany: boolean,
): Promise<void> {
  if (input.externalId) {
    await companies.upsertSource({
      tenantId: input.tenantId,
      companyId,
      source: input.source,
      externalId: input.externalId,
      rawJson: input.raw,
    });
    return;
  }
  if (createdCompany) {
    await companies.upsertSource({
      tenantId: input.tenantId,
      companyId,
      source: input.source,
      rawJson: input.raw,
    });
  }
}

export async function ingestDiscoveredRecord(
  deps: IngestDeps,
  input: IngestInput,
  options: { requireDomain?: boolean } = {},
): Promise<IngestResult> {
  const requireDomain = options.requireDomain ?? true;
  const name = normalizeCompanyName(input.name || '');
  if (!name) {
    deps.logger?.info('normalized_record_skipped', { reason: 'missing_name', source: input.source });
    return { skipped: true, reason: 'missing_name', created: false, duplicate: false };
  }

  const domain = canonicalDomain(input.domain ?? input.websiteUrl);
  const country = normalizeCountry(input.country);
  const city = normalizeCity(input.city);
  const websiteUrl = normalizeWebsiteUrl(input.websiteUrl ?? input.domain);
  const phone = input.phone?.trim() || undefined;
  const address = input.address?.trim() || undefined;

  deps.logger?.info('normalized_record', {
    name,
    domain,
    country,
    city,
    source: input.source,
    externalId: input.externalId,
    websiteUrl,
  });

  if (requireDomain && !domain) {
    deps.logger?.info('duplicate_or_skipped_record', { reason: 'missing_domain', name, source: input.source });
    return { skipped: true, reason: 'missing_domain', created: false, duplicate: false };
  }

  if (domain) {
    const existing = await deps.companies.findByDomain(input.tenantId, domain);
    if (existing) {
      const patch = fillBlanks(existing, { name, country, city, phone, address });
      const updated =
        (await deps.companies.update(input.tenantId, existing.id, patch)) ?? { ...existing, ...patch };
      await attachSource(deps.companies, input, updated.id, false);
      const lead = await ensureLead(deps.leads, input.tenantId, updated.id);
      deps.logger?.info('duplicate_record', {
        tenantId: input.tenantId,
        companyId: updated.id,
        domain,
        source: input.source,
      });
      return { skipped: false, company: updated, lead, created: false, duplicate: true };
    }
  }

  let company: CompanyRecord;
  try {
    company = await deps.companies.create({
      tenantId: input.tenantId,
      name,
      domain: domain ?? null,
      country,
      city,
      phone,
      address,
    });
  } catch (error) {
    if (domain) {
      const raced = await deps.companies.findByDomain(input.tenantId, domain);
      if (raced) {
        await attachSource(deps.companies, input, raced.id, false);
        const lead = await ensureLead(deps.leads, input.tenantId, raced.id);
        return { skipped: false, company: raced, lead, created: false, duplicate: true };
      }
    }
    throw error;
  }

  await attachSource(deps.companies, input, company.id, true);
  const lead = await ensureLead(deps.leads, input.tenantId, company.id);
  deps.logger?.info('company_created', { tenantId: input.tenantId, companyId: company.id, domain, name });
  deps.logger?.info('lead_created', { tenantId: input.tenantId, leadId: lead.id, companyId: company.id });
  return { skipped: false, company, lead, created: true, duplicate: false };
}
