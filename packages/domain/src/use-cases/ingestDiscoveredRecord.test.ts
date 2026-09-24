import { describe, expect, it } from 'vitest';
import type {
  CompanyRecord,
  CompanyRepo,
  JobRepo,
  JobRunRecord,
  LeadRecord,
  LeadRepo,
  SourceRecord,
  WebsiteRecord,
  WebsiteRepo,
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
  const websites: WebsiteRecord[] = [];
  let companySeq = 1;
  let leadSeq = 1;
  let sourceSeq = 1;
  let jobSeq = 1;
  let websiteSeq = 1;
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
      const record: LeadRecord = {
        id: `l${leadSeq++}`,
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
    async get(tenantId, id) {
      const lead = leads.find((item) => item.id === id && item.tenantId === tenantId);
      if (!lead) return null;
      const company = companies.find((item) => item.id === lead.companyId);
      return company ? { ...lead, company } : null;
    },
    async list(tenantId, query) {
      const items = leads
        .filter((item) => item.tenantId === tenantId)
        .filter((item) => !query.queue || item.queue === query.queue)
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
    async applyQualification(tenantId, leadId, data) {
      const lead = leads.find((item) => item.id === leadId && item.tenantId === tenantId);
      if (!lead || lead.version !== data.expectedVersion) return null;
      lead.queue = data.queue;
      lead.assistantVerdict = data.assistantVerdict;
      lead.assistantVendor = data.assistantVendor ?? null;
      lead.qualificationReason = data.qualificationReason;
      if (data.latestAuditId !== undefined) lead.latestAuditId = data.latestAuditId;
      lead.version += 1;
      return lead;
    },
    async queueCounts(tenantId) {
      const counts = {
        PENDING_AUDIT: 0,
        QUALIFIED: 0,
        HAS_ASSISTANT: 0,
        NO_WEBSITE: 0,
        NEEDS_REVIEW: 0,
        INACTIVE: 0,
        openReviewTasks: 0,
      };
      for (const lead of leads.filter((item) => item.tenantId === tenantId)) {
        counts[lead.queue] += 1;
      }
      return counts;
    },
  };

  const websiteRepo: WebsiteRepo = {
    async upsert(data) {
      const existing = websites.find(
        (item) => item.tenantId === data.tenantId && item.companyId === data.companyId,
      );
      if (existing) {
        Object.assign(existing, data);
        return existing;
      }
      const record: WebsiteRecord = {
        id: `w${websiteSeq++}`,
        status: data.status ?? 'UNCHECKED',
        ...data,
      };
      websites.push(record);
      return record;
    },
    async getByCompany(tenantId, companyId) {
      return websites.find((item) => item.tenantId === tenantId && item.companyId === companyId) ?? null;
    },
    async applyAuditPointers(tenantId, websiteId, data) {
      const existing = websites.find((item) => item.id === websiteId && item.tenantId === tenantId);
      if (!existing) return null;
      Object.assign(existing, data);
      return existing;
    },
  };

  const jobRepo: JobRepo = {
    async create(data) {
      if (data.dedupeKey) {
        const dup = jobs.find(
          (item) => item.tenantId === data.tenantId && item.dedupeKey === data.dedupeKey,
        );
        if (dup) throw new Error('duplicate dedupeKey');
      }
      const record: JobRunRecord = {
        id: `j${jobSeq++}`,
        tenantId: data.tenantId,
        type: data.type,
        status: 'pending',
        payload: data.payload,
        attempts: 0,
        maxAttempts: data.maxAttempts ?? 3,
        runAfter: data.runAfter ?? new Date(),
        dedupeKey: data.dedupeKey ?? null,
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

  return { companies, leads, sources, jobs, websites, companyRepo, leadRepo, jobRepo, websiteRepo };
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
    expect(result.lead.queue).toBe('PENDING_AUDIT');
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
    expect(result.lead.queue).toBe('PENDING_AUDIT');
    expect(leads).toHaveLength(1);
  });

  it('enqueues website_audit when websites and jobs are provided', async () => {
    const { companyRepo, leadRepo, websiteRepo, jobRepo, jobs } = memory();
    const result = await ingestDiscoveredRecord(
      {
        companies: companyRepo,
        leads: leadRepo,
        websites: websiteRepo,
        jobs: jobRepo,
        logger: createSilentLogger(),
      },
      {
        tenantId: 't1',
        name: 'Clinic',
        domain: 'clinic.example',
        source: 'google_places',
        externalId: 'p1',
      },
    );
    expect(result.auditEnqueued).toBe(true);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.type).toBe('website_audit');
  });

  it('does not create duplicate companies or leads when retrying discovery', async () => {
    const { companyRepo, leadRepo, companies, leads } = memory();
    const source = {
      async discover() {
        return [
          { name: 'Clinic', domain: 'clinic.example', source: 'google_places', externalId: 'p1' },
          {
            name: 'Clinic WWW',
            websiteUrl: 'https://www.clinic.example/',
            source: 'google_places',
            externalId: 'p1',
          },
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

  it('filters leads by tenant, country, queue, and search', async () => {
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
    const filtered = await leadRepo.list('t1', {
      country: 'Singapore',
      queue: 'PENDING_AUDIT',
      search: 'Dental',
    });
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
    const { companyRepo, leadRepo, jobRepo, websiteRepo, companies } = memory();
    const job = await jobRepo.create({
      tenantId: 't1',
      type: 'places_discovery',
      payload: {},
    });
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
      websites: websiteRepo,
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
