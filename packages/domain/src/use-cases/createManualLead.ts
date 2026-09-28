import type { CompanyRepo, JobRepo, LeadRepo, Logger, WebsiteRepo } from '../ports';
import type { AuditConfig } from '../config/audit';
import { ingestDiscoveredRecord } from './ingestDiscoveredRecord';

export type ManualLeadInput = {
  tenantId: string;
  name: string;
  domain?: string;
  country?: string;
  city?: string;
  phone?: string;
  address?: string;
};

export async function createManualLead(
  deps: {
    companies: CompanyRepo;
    leads: LeadRepo;
    websites?: WebsiteRepo;
    jobs?: JobRepo;
    logger?: Logger;
    config?: AuditConfig;
  },
  input: ManualLeadInput,
) {
  const result = await ingestDiscoveredRecord(
    deps,
    {
      ...input,
      websiteUrl: input.domain,
      source: 'manual',
    },
    { requireDomain: false },
  );

  if (result.skipped) {
    throw new Error(result.reason === 'missing_name' ? 'Company name is required' : 'Unable to create lead');
  }

  return {
    company: result.company,
    lead: result.lead,
    duplicate: result.duplicate,
    auditEnqueued: result.auditEnqueued,
  };
}
