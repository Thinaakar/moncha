import { describe, expect, it } from 'vitest';
import { parseCsv, importCsvRecords } from './importCsvRecords';
import type { CompanyRecord, CompanyRepo, LeadRecord, LeadRepo } from '../ports';

function repos() {
  const companies: CompanyRecord[] = [];
  const leads: LeadRecord[] = [];
  const companyRepo: CompanyRepo = {
    async findByDomain(tenantId, domain) {
      return companies.find((item) => item.tenantId === tenantId && item.domain === domain) ?? null;
    },
    async create(data) {
      const record = { id: `c${companies.length + 1}`, ...data };
      companies.push(record);
      return record;
    },
    async update(tenantId, id, data) {
      const existing = companies.find((item) => item.id === id && item.tenantId === tenantId);
      if (!existing) return null;
      Object.assign(existing, data);
      return existing;
    },
    async upsertSource() {
      return { id: 's1', tenantId: 't1', companyId: 'c1', source: 'csv' };
    },
  };
  const leadRepo: LeadRepo = {
    async create(data) {
      const record = {
        id: `l${leads.length + 1}`,
        version: 1,
        assistantVerdict: data.assistantVerdict ?? null,
        assistantVendor: null,
        qualificationReason: data.qualificationReason ?? null,
        latestAuditId: null,
        ...data,
      };
      leads.push(record);
      return record;
    },
    async findByCompany(tenantId, companyId) {
      return leads.find((item) => item.tenantId === tenantId && item.companyId === companyId) ?? null;
    },
    async get() {
      return null;
    },
    async list() {
      return { items: [], total: 0, page: 1, pageSize: 25, totalPages: 0 };
    },
    async applyQualification() {
      return null;
    },
    async queueCounts() {
      return {
        PENDING_AUDIT: 0,
        QUALIFIED: 0,
        HAS_ASSISTANT: 0,
        NO_WEBSITE: 0,
        NEEDS_REVIEW: 0,
        INACTIVE: 0,
        openReviewTasks: 0,
      };
    },
  };
  return { companies, leads, companyRepo, leadRepo };
}

describe('csv import', () => {
  it('parses csv rows and uses the ingest pipeline', async () => {
    const csv = 'name,website,country,city\nAcme,https://www.acme.example,Singapore,Singapore\n';
    const records = parseCsv(csv);
    const { companyRepo, leadRepo, companies } = repos();
    const result = await importCsvRecords(
      { companies: companyRepo, leads: leadRepo },
      { tenantId: 't1', records },
    );
    expect(result.created).toBe(1);
    expect(companies[0]?.domain).toBe('acme.example');
  });
});
