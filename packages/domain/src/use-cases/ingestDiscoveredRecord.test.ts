import { describe, expect, it } from 'vitest';
import type {
  CompanyRecord,
  CompanyRepo,
  JobRepo,
  JobRunRecord,
  LeadRecord,
  LeadRepo,
  SourceRecord,
} from '../ports';
import { canTransitionJob, createSilentLogger } from '../index';
import { ingestDiscoveredRecord } from './ingestDiscoveredRecord';
import { discoverCompanies } from './discoverCompanies';
import { createManualLead } from './createManualLead';
import { runPlacesDiscoveryJob } from './runPlacesDiscovery';

function memory() {
  const companies: CompanyRecord[] = [];
  const leads: LeadRecord[] = [];
  const sources: SourceRecord[] = [];
  let companySeq = 1;
  let leadSeq = 1;
  let sourceSeq = 1;
  let jobSeq = 1;
  const jobs: JobRunRecord[] = [];

  const companyRepo: CompanyRepo = {
    async findByDomain(tenantId, domain) {
      return companies.find((item) => item.tenantId === tenantId && item.domain === domain) ?? null;
    },
    async create(data) {
      const record: CompanyRecord = { id: `c${companySeq++}`, ...data };
      companies.push(record);
      return record;
    },
    async update(tenantId, id, data) {
      const existing = companies.find((item) => item.id === id && item.tenantId === tenantId);
      if (!existing) return null;
      Object.assign(existing, data);
      return existing;
    },
    async upsertSource(data) {
      if (data.externalId) {
        const existing = sources.find(
          (item) =>
            item.tenantId === data.tenantId &&
            item.source === data.source &&
            item.externalId === data.externalId,
        );
        if (existing) {
          existing.companyId = data.companyId;
          existing.rawJson = data.rawJson;
          return existing;
        }
      }
      const record: SourceRecord = {
        id: `s${sourceSeq++}`,
        tenantId: data.tenantId,
        companyId: data.companyId,
        source: data.source,
        externalId: data.externalId,
        rawJson: data.rawJson,
      };
      sources.push(record);
      return record;
    },
  };

  const leadRepo: LeadRepo = {
    async create(data) {
      const existing = leads.find(
        (item) => item.tenantId === data.tenantId && item.companyId === data.companyId,
      );
      if (existing) throw new Error('duplicate lead');
      const record: LeadRecord = { id: `l${leadSeq++}`, ...data };
      leads.push(record);
      return record;
    },
    async findByCompany(tenantId, companyId) {
      return leads.find((item) => item.tenantId === tenantId && item.companyId === companyId) ?? null;
    },
    async get(tenantId, id) {
      const lead = leads.find((item) => item.id === id && item.tenantId === tenantId);
      if (!lead) return null;
      const company = companies.find((item) => item.id === lead.companyId);
      return company ? { ...lead, company } : null;
    },
    async list(tenantId, query) {
      const items = leads
        .filter((item) => item.tenantId === tenantId)
        .filter((item) => !query.status || item.status === query.status)
        .map((lead) => {
          const company = companies.find((item) => item.id === lead.companyId)!;
          return { ...lead, company };
        })
        .filter((item) => !query.country || item.company.country === query.country)
        .filter(
          (item) =>
            !query.search ||
            item.company.name.toLowerCase().includes(query.search.toLowerCase()) ||
            (item.company.domain || '').includes(query.search.toLowerCase()),
        );
      return { items, total: items.length, page: 1, pageSize: items.length || 25, totalPages: 1 };
    },
  };

  const jobRepo: JobRepo = {
    async create(tenantId, type, input) {
      const record: JobRunRecord = {
        id: `j${jobSeq++}`,
        tenantId,
        type,
        status: 'pending',
        inputJson: input,
      };
      jobs.push(record);
      return record;
    },
    async update(tenantId, id, data) {
      const existing = jobs.find((item) => item.id === id && item.tenantId === tenantId);
      if (!existing) return null;
      Object.assign(existing, data);
      return existing;
    },
    async get(tenantId, id) {
      return jobs.find((item) => item.id === id && item.tenantId === tenantId) ?? null;
    },
  };

  return { companies, leads, sources, jobs, companyRepo, leadRepo, jobRepo };
}

describe('ingest and discovery', () => {
  it('creates a company, lead, and source record', async () => {
    const { companyRepo, leadRepo, companies, leads, sources } = memory();
    const result = await ingestDiscoveredRecord(
      { companies: companyRepo, leads: leadRepo, logger: createSilentLogger() },
      {
        tenantId: 't1',
        name: 'Acme Dental',
        domain: 'https://www.acme.example',
        source: 'google_places',
        externalId: 'place-1',
      },
    );
    expect(result.created).toBe(true);
    expect(companies).toHaveLength(1);
    expect(leads).toHaveLength(1);
    expect(sources).toHaveLength(1);
    expect(companies[0]?.domain).toBe('acme.example');
  });

  it('dedupes equivalent domains into one company', async () => {
    const { companyRepo, leadRepo, companies, leads } = memory();
    const deps = { companies: companyRepo, leads: leadRepo, logger: createSilentLogger() };
    await ingestDiscoveredRecord(deps, {
      tenantId: 't1',
      name: 'Example',
      domain: 'https://example.com',
      source: 'google_places',
      externalId: 'a',
    });
    await ingestDiscoveredRecord(deps, {
      tenantId: 't1',
      name: 'Example',
      domain: 'http://www.example.com/',
      source: 'google_places',
      externalId: 'b',
    });
    await ingestDiscoveredRecord(deps, {
      tenantId: 't1',
      name: 'Example',
      domain: 'EXAMPLE.COM',
      source: 'google_places',
      externalId: 'c',
    });
    expect(companies).toHaveLength(1);
    expect(leads).toHaveLength(1);
  });

  it('does not create a duplicate company on rediscovery', async () => {
    const { companyRepo, leadRepo, companies } = memory();
    const deps = { companies: companyRepo, leads: leadRepo };
    await ingestDiscoveredRecord(deps, {
      tenantId: 't1',
      name: 'Clinic',
      domain: 'clinic.example',
      source: 'google_places',
      externalId: 'p1',
    });
    const second = await ingestDiscoveredRecord(deps, {
      tenantId: 't1',
      name: 'Clinic',
      domain: 'clinic.example',
      source: 'google_places',
      externalId: 'p1',
    });
    expect(second.duplicate).toBe(true);
    expect(companies).toHaveLength(1);
  });

  it('lets an existing company receive another source record', async () => {
    const { companyRepo, leadRepo, sources } = memory();
    const deps = { companies: companyRepo, leads: leadRepo };
    await ingestDiscoveredRecord(deps, {
      tenantId: 't1',
      name: 'Clinic',
      domain: 'clinic.example',
      source: 'google_places',
      externalId: 'p1',
    });
    await ingestDiscoveredRecord(deps, {
      tenantId: 't1',
      name: 'Clinic',
      domain: 'clinic.example',
      source: 'csv',
      externalId: 'row-1',
    });
    expect(sources.map((item) => item.source).sort()).toEqual(['csv', 'google_places']);
  });

  it('creates a manual lead through the same ingest path', async () => {
    const { companyRepo, leadRepo, leads } = memory();
    const result = await createManualLead(
      { companies: companyRepo, leads: leadRepo },
      { tenantId: 't1', name: 'Manual Co', domain: 'manual.example' },
    );
    expect(result.lead.status).toBe('discovered');
    expect(leads).toHaveLength(1);
  });

  it('does not create duplicate companies or leads when retrying discovery', async () => {
    const { companyRepo, leadRepo, companies, leads } = memory();
    const source = {
      async discover() {
        return [
          { name: 'Clinic', domain: 'clinic.example', source: 'google_places', externalId: 'p1' },
          { name: 'Clinic WWW', websiteUrl: 'https://www.clinic.example/', source: 'google_places', externalId: 'p1' },
        ];
      },
    };
    const input = { tenantId: 't1', country: 'Singapore', city: 'Singapore', keyword: 'dental' };
    await discoverCompanies({ source, companies: companyRepo, leads: leadRepo }, input);
    await discoverCompanies({ source, companies: companyRepo, leads: leadRepo }, input);
    expect(companies).toHaveLength(1);
    expect(leads).toHaveLength(1);
  });

  it('isolates companies by tenant', async () => {
    const { companyRepo, leadRepo, companies } = memory();
    const deps = { companies: companyRepo, leads: leadRepo };
    await ingestDiscoveredRecord(deps, {
      tenantId: 't1',
      name: 'Clinic',
      domain: 'clinic.example',
      source: 'google_places',
      externalId: 'p1',
    });
    await ingestDiscoveredRecord(deps, {
      tenantId: 't2',
      name: 'Clinic',
      domain: 'clinic.example',
      source: 'google_places',
      externalId: 'p1',
    });
    expect(companies).toHaveLength(2);
    expect(await companyRepo.findByDomain('t1', 'clinic.example')).toBeTruthy();
    expect((await companyRepo.findByDomain('t1', 'clinic.example'))?.tenantId).toBe('t1');
  });

  it('filters leads by tenant, country, status, and search', async () => {
    const { companyRepo, leadRepo } = memory();
    await ingestDiscoveredRecord(
      { companies: companyRepo, leads: leadRepo },
      { tenantId: 't1', name: 'Dental SG', domain: 'sg.example', country: 'Singapore', source: 'manual' },
      { requireDomain: true },
    );
    await ingestDiscoveredRecord(
      { companies: companyRepo, leads: leadRepo },
      { tenantId: 't1', name: 'Dental MY', domain: 'my.example', country: 'Malaysia', source: 'manual' },
      { requireDomain: true },
    );
    await ingestDiscoveredRecord(
      { companies: companyRepo, leads: leadRepo },
      { tenantId: 't2', name: 'Other', domain: 'sg.example', country: 'Singapore', source: 'manual' },
      { requireDomain: true },
    );
    const filtered = await leadRepo.list('t1', { country: 'Singapore', status: 'discovered', search: 'Dental' });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]?.company.name).toBe('Dental SG');
  });

  it('transitions job status pending -> running -> done and supports retry from failed', async () => {
    expect(canTransitionJob('pending', 'running')).toBe(true);
    expect(canTransitionJob('running', 'done')).toBe(true);
    expect(canTransitionJob('running', 'failed')).toBe(true);
    expect(canTransitionJob('done', 'running')).toBe(false);
    expect(canTransitionJob('failed', 'running')).toBe(true);
  });

  it('does not double-ingest a done discovery job', async () => {
    const { companyRepo, leadRepo, jobRepo, companies } = memory();
    const job = await jobRepo.create('t1', 'places_discovery', {});
    const source = {
      async discover() {
        return [{ name: 'Clinic', domain: 'clinic.example', source: 'google_places', externalId: 'p1' }];
      },
    };
    const deps = {
      jobs: jobRepo,
      source,
      companies: companyRepo,
      leads: leadRepo,
      websites: {
        async upsert(data: { companyId: string; tenantId: string; url: string }) {
          return { id: 'w1', ...data };
        },
      },
      checker: {
        async check() {
          return { reachable: true, httpStatus: 200, finalUrl: 'https://clinic.example', title: 'Clinic' };
        },
      },
      logger: createSilentLogger(),
    };
    await runPlacesDiscoveryJob(deps, {
      jobId: job.id,
      tenantId: 't1',
      country: 'Singapore',
      city: 'Singapore',
      keyword: 'dental',
    });
    await runPlacesDiscoveryJob(deps, {
      jobId: job.id,
      tenantId: 't1',
      country: 'Singapore',
      city: 'Singapore',
      keyword: 'dental',
    });
    expect(companies).toHaveLength(1);
    expect((await jobRepo.get('t1', job.id))?.status).toBe('done');
  });
});
