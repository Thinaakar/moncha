import type { CompanyRepo, LeadRepo, Logger } from '../ports';
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
  deps: { companies: CompanyRepo; leads: LeadRepo; logger?: Logger },
  input: ManualLeadInput,
) {
  const result = await ingestDiscoveredRecord(
    deps,
    {
      ...input,
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
  };
}
