import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { mapJob, PrismaJobRunRepository } from './repositories/job-run';
import { PrismaSiteAutomationRepository } from './repositories/site-automation';

function rawSqlRecorder(rows: unknown[] = []) {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push({ sql: strings.join('?'), values });
      return rows;
    },
  };
  return { db: db as unknown as PrismaClient, queries };
}

const jobRow = {
  id: 'job1',
  tenantId: 't1',
  type: 'website_audit' as const,
  status: 'pending' as const,
  payload: { leadId: 'lead1', crawlJobId: 'crawl1' },
  result: null,
  attempts: 0,
  maxAttempts: 3,
  runAfter: new Date('2026-10-13T00:00:00Z'),
  lockedAt: null,
  lockedBy: null,
  lastError: null,
  dedupeKey: null,
  leadId: 'lead1',
  crawlJobId: 'crawl1',
  auditId: null,
  startedAt: null,
  finishedAt: null,
  createdAt: new Date('2026-10-13T00:00:00Z'),
};

describe('site automation reads JobRun relation columns', () => {
  it('counts audits by the crawlJobId column', async () => {
    const { db, queries } = rawSqlRecorder([{ total: 4, pending: 1 }]);
    const counts = await new PrismaSiteAutomationRepository(db).auditCounts('t1', 'crawl1');

    expect(counts).toEqual({ total: 4, pending: 1 });
    expect(queries[0]!.sql).toContain('"crawlJobId" = ?');
    expect(queries[0]!.sql).not.toContain('payload');
    expect(queries[0]!.values).toEqual(['t1', 'crawl1']);
  });

  it('selects candidates through the leadId and crawlJobId columns', async () => {
    const { db, queries } = rawSqlRecorder();
    await new PrismaSiteAutomationRepository(db).candidates('t1', 'crawl1', 5);

    const sql = queries[0]!.sql;
    expect(sql).toContain('SELECT j."leadId" FROM "JobRun" j');
    expect(sql).toContain('j."crawlJobId" = ?');
    expect(sql).not.toContain('payload');
  });
});

describe('JobRun repository relation columns', () => {
  it('maps leadId, crawlJobId and auditId', () => {
    const job = mapJob({ ...jobRow, auditId: 'audit1' });
    expect(job).toMatchObject({ leadId: 'lead1', crawlJobId: 'crawl1', auditId: 'audit1' });
  });

  it('maps rows without the columns to null', () => {
    const { leadId: _l, crawlJobId: _c, auditId: _a, ...legacy } = jobRow;
    expect(mapJob(legacy)).toMatchObject({ leadId: null, crawlJobId: null, auditId: null });
  });

  it('writes leadId and crawlJobId on create and auditId on update', async () => {
    const calls: Array<{ op: string; data: Record<string, unknown> }> = [];
    const db = {
      jobRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          calls.push({ op: 'create', data });
          return jobRow;
        },
        findFirst: async () => jobRow,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          calls.push({ op: 'update', data });
          return { ...jobRow, auditId: 'audit1' };
        },
      },
    } as unknown as PrismaClient;
    const repo = new PrismaJobRunRepository(db);

    await repo.create({
      tenantId: 't1',
      type: 'website_audit',
      payload: { leadId: 'lead1', crawlJobId: 'crawl1' },
      leadId: 'lead1',
      crawlJobId: 'crawl1',
    });
    const updated = await repo.update('t1', 'job1', { status: 'done', auditId: 'audit1' });

    expect(calls[0]).toMatchObject({ op: 'create', data: { leadId: 'lead1', crawlJobId: 'crawl1' } });
    expect(calls[1]).toMatchObject({ op: 'update', data: { auditId: 'audit1' } });
    expect(updated?.auditId).toBe('audit1');
  });

  it('defaults the relation columns to null when the caller omits them', async () => {
    let created: Record<string, unknown> = {};
    const db = {
      jobRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created = data;
          return jobRow;
        },
      },
    } as unknown as PrismaClient;

    await new PrismaJobRunRepository(db).create({ tenantId: 't1', type: 'country_discovery', payload: {} });
    expect(created).toMatchObject({ leadId: null, crawlJobId: null });
  });

  it('returns the relation columns from claimJobs', async () => {
    const { db } = rawSqlRecorder([jobRow]);
    const [claimed] = await new PrismaJobRunRepository(db).claimJobs('w1', 1);
    expect(claimed).toMatchObject({ leadId: 'lead1', crawlJobId: 'crawl1' });
  });
});
