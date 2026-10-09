import { describe, expect, it } from 'vitest';
import type {
  SiteAutomationCandidate,
  SiteAutomationCrawlRecord,
  SiteAutomationRepo,
  SiteAutomationSettingsRecord,
  SiteQueueEntry,
  SiteSnapshotRepo,
} from '../ports';
import {
  SITE_AUTOMATION_AUDIT_WAIT_MS,
  siteAutoCopyDedupeKey,
  sweepSiteAutomation,
  updateSiteAutomationSettings,
  SiteAutomationError,
} from './siteAutomation';
import { getSiteQueue } from './siteSnapshots';
import { tagAuditsWithCrawl } from './runCountryDiscoveryJob';

const NOW = new Date('2026-10-09T10:00:00.000Z');
const HOUR = 60 * 60_000;

function crawl(id: string, finishedAgoMs: number, over: Partial<SiteAutomationCrawlRecord> = {}): SiteAutomationCrawlRecord {
  return {
    crawlJobId: id,
    tenantId: 't1',
    status: 'waiting_audits',
    auditsTotal: 0,
    auditsPending: 0,
    qualified: 0,
    queued: 0,
    carriedOver: 0,
    crawlFinishedAt: new Date(NOW.getTime() - finishedAgoMs),
    lastCheckedAt: NOW,
    completedAt: null,
    ...over,
  };
}

function lead(id: string, domain: string | null = `${id}.com`): SiteAutomationCandidate {
  return { leadId: id, websiteUrl: null, websiteFinalUrl: null, domain };
}

function setup(input: {
  crawls: SiteAutomationCrawlRecord[];
  audits?: Record<string, { total: number; pending: number }>;
  candidates?: Record<string, SiteAutomationCandidate[]>;
  usedToday?: number;
  cap?: number;
}) {
  const crawls = new Map(input.crawls.map((c) => [c.crawlJobId, { ...c }]));
  const created: Array<{ leadId: string; crawlJobId?: string | null; origin?: string; dedupeKey?: string; sourceUrl: string }> = [];
  const automation: SiteAutomationRepo = {
    getSettings: async () => settings,
    saveSettings: async () => settings,
    listEnabled: async () => [settings],
    trackFinishedCrawls: async () => 0,
    listOpenCrawls: async () =>
      [...crawls.values()]
        .filter((c) => c.status !== 'complete')
        .sort((a, b) => a.crawlFinishedAt.getTime() - b.crawlFinishedAt.getTime()),
    updateCrawl: async (id, patch) => {
      crawls.set(id, { ...crawls.get(id)!, ...patch });
    },
    auditCounts: async (_t, id) => input.audits?.[id] ?? { total: 0, pending: 0 },
    candidates: async (_t, id) =>
      (input.candidates?.[id] ?? []).filter((c) => !created.some((x) => x.leadId === c.leadId)),
    countAutoSince: async () => (input.usedToday ?? 0) + created.length,
    listCrawls: async () => [],
    getCrawls: async () => [],
  };
  const snapshots = {
    createWithJob: async (data: (typeof created)[number]) => {
      created.push(data);
      return { snapshot: {}, job: {} };
    },
  } as unknown as SiteSnapshotRepo;
  const settings: SiteAutomationSettingsRecord = {
    tenantId: 't1',
    enabled: true,
    dailyCap: input.cap ?? 20,
    enabledAt: new Date(NOW.getTime() - 48 * HOUR),
    updatedBy: null,
    updatedAt: null,
  };
  const run = (over: Partial<SiteAutomationSettingsRecord> = {}) =>
    sweepSiteAutomation({ automation, snapshots, now: () => NOW }, { ...settings, ...over });
  return { run, crawls, created };
}

describe('sweepSiteAutomation', () => {
  it('does nothing while automation is off', async () => {
    const t = setup({ crawls: [crawl('c1', HOUR)], candidates: { c1: [lead('a')] } });
    const result = await t.run({ enabled: false });
    expect(result.queued).toBe(0);
    expect(t.created).toHaveLength(0);
  });

  it('waits for the crawl audits before queueing', async () => {
    const t = setup({
      crawls: [crawl('c1', HOUR)],
      audits: { c1: { total: 5, pending: 2 } },
      candidates: { c1: [lead('a')] },
    });
    await t.run();
    expect(t.created).toHaveLength(0);
    expect(t.crawls.get('c1')).toMatchObject({ status: 'waiting_audits', auditsTotal: 5, auditsPending: 2 });
  });

  it('queues anyway once the audit wait has passed, and keeps following the crawl', async () => {
    const t = setup({
      crawls: [crawl('c1', SITE_AUTOMATION_AUDIT_WAIT_MS + 1)],
      audits: { c1: { total: 5, pending: 1 } },
      candidates: { c1: [lead('a')] },
    });
    await t.run();
    expect(t.created.map((c) => c.leadId)).toEqual(['a']);
    expect(t.crawls.get('c1')).toMatchObject({ status: 'queuing', queued: 1, carriedOver: 0 });
  });

  it('queues automatic copies with one dedupe key per lead and completes the crawl', async () => {
    const t = setup({ crawls: [crawl('c1', HOUR)], candidates: { c1: [lead('a'), lead('b')] } });
    const result = await t.run();
    expect(result.queued).toBe(2);
    expect(t.created[0]).toMatchObject({
      leadId: 'a',
      origin: 'auto',
      crawlJobId: 'c1',
      dedupeKey: siteAutoCopyDedupeKey('a'),
      sourceUrl: 'https://a.com/',
    });
    expect(t.crawls.get('c1')).toMatchObject({ status: 'complete', queued: 2, qualified: 2, carriedOver: 0 });
  });

  it('stops at the daily cap, serves the oldest crawl first and carries the rest over', async () => {
    const t = setup({
      crawls: [crawl('newer', HOUR), crawl('older', 2 * HOUR)],
      candidates: { older: [lead('o1'), lead('o2')], newer: [lead('n1'), lead('n2')] },
      usedToday: 17,
      cap: 20,
    });
    const result = await t.run();
    expect(t.created.map((c) => c.leadId)).toEqual(['o1', 'o2', 'n1']);
    expect(result).toMatchObject({ queued: 3, carriedOver: 1, remainingToday: 0 });
    expect(t.crawls.get('older')).toMatchObject({ status: 'complete' });
    expect(t.crawls.get('newer')).toMatchObject({ status: 'queuing', queued: 1, carriedOver: 1, qualified: 2 });
  });

  it('skips leads without a usable website', async () => {
    const t = setup({ crawls: [crawl('c1', HOUR)], candidates: { c1: [lead('a', null), lead('b')] } });
    await t.run();
    expect(t.created.map((c) => c.leadId)).toEqual(['b']);
    expect(t.crawls.get('c1')).toMatchObject({ status: 'complete' });
  });
});

describe('updateSiteAutomationSettings', () => {
  it('rejects an invalid cap', async () => {
    const automation = { saveSettings: async () => ({}) } as unknown as SiteAutomationRepo;
    await expect(updateSiteAutomationSettings({ automation }, { tenantId: 't1', dailyCap: -1 })).rejects.toBeInstanceOf(
      SiteAutomationError,
    );
  });
});

describe('tagAuditsWithCrawl', () => {
  it('adds crawlJobId to website audits only', async () => {
    const seen: unknown[] = [];
    const jobs = tagAuditsWithCrawl(
      {
        create: async (data) => {
          seen.push(data.payload);
          return {} as never;
        },
        update: async () => null,
        get: async () => null,
      },
      'crawl1',
    );
    await jobs.create({ tenantId: 't1', type: 'website_audit', payload: { leadId: 'l1' } });
    await jobs.create({ tenantId: 't1', type: 'csv_import', payload: { x: 1 } });
    expect(seen).toEqual([{ leadId: 'l1', crawlJobId: 'crawl1' }, { x: 1 }]);
  });
});

describe('getSiteQueue', () => {
  function entry(id: string, status: 'pending' | 'running', over: Partial<NonNullable<SiteQueueEntry['job']>> = {}): SiteQueueEntry {
    return {
      id,
      status,
      createdAt: NOW,
      job: {
        id: `job_${id}`,
        status,
        attempts: 0,
        maxAttempts: 2,
        runAfter: NOW,
        lockedAt: status === 'running' ? new Date(NOW.getTime() - 30_000) : null,
        startedAt: null,
        lastError: null,
        createdAt: NOW,
        ...over,
      },
    } as SiteQueueEntry;
  }

  it('numbers waiting copies and chains their start estimates after the running copy', async () => {
    const snapshots = {
      queue: async () => [entry('r', 'running'), entry('w1', 'pending'), entry('w2', 'pending', { attempts: 1 })],
      averageRunMs: async () => 60_000,
    } as unknown as SiteSnapshotRepo;
    const view = await getSiteQueue({ snapshots, now: () => NOW }, { tenantId: 't1' });
    expect(view.running[0]?.estimatedAt.toISOString()).toBe('2026-10-09T10:00:30.000Z');
    expect(view.waiting.map((w) => [w.position, w.estimatedAt.toISOString(), w.retrying])).toEqual([
      [1, '2026-10-09T10:00:30.000Z', false],
      [2, '2026-10-09T10:01:30.000Z', true],
    ]);
    expect(view.measured).toBe(true);
  });
});
