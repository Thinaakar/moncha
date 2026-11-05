import { describe, expect, it } from 'vitest';
import type { DiscoveryScheduleRecord, DiscoveryScheduleRepo, JobCreate, JobRunRecord } from '../ports';
import { createSilentLogger } from '../logger';
import { computeNextRun, localDate, relativeDay } from '../discovery/schedule-time';
import {
  createSchedule,
  deleteCountrySchedules,
  deleteSchedule,
  enqueueDueSchedules,
  listScheduleRuns,
  listSchedules,
  ScheduleError,
  type ScheduleCrawlSettings,
  type ScheduleCrawlSettingsSource,
} from './discoverySchedules';

function memorySchedules(): DiscoveryScheduleRepo & { rows: DiscoveryScheduleRecord[]; jobs: JobRunRecord[] } {
  const rows: DiscoveryScheduleRecord[] = [];
  const jobs: JobRunRecord[] = [];
  let seq = 1;
  return {
    rows,
    jobs,
    async create(data) {
      const dup = rows.some(
        (r) => r.tenantId === data.tenantId && r.countryCode === data.countryCode && r.timeOfDay === data.timeOfDay,
      );
      if (dup) return null;
      const row = { id: `s${seq++}`, enabled: true, lastRunAt: null, ...data };
      rows.push(row);
      return row;
    },
    async list(tenantId) {
      return rows.filter((r) => r.tenantId === tenantId);
    },
    async delete(tenantId, id) {
      const i = rows.findIndex((r) => r.tenantId === tenantId && r.id === id);
      if (i < 0) return false;
      rows.splice(i, 1);
      return true;
    },
    async deleteByCountry(tenantId, countryCode) {
      const hit = rows.filter((r) => r.tenantId === tenantId && r.countryCode === countryCode);
      for (const r of hit) rows.splice(rows.indexOf(r), 1);
      return hit.length;
    },
    async due(now, limit) {
      return rows
        .filter((r) => r.enabled && r.nextRunAt <= now)
        .sort((a, b) => +a.nextRunAt - +b.nextRunAt)
        .slice(0, limit)
        .map((r) => ({ ...r }));
    },
    async advance(schedule, next, ranAt, job?: JobCreate) {
      const row = rows.find((r) => r.id === schedule.id);
      if (!row || +row.nextRunAt !== +schedule.nextRunAt) return { advanced: false, job: null };
      row.nextRunAt = next;
      if (!job) return { advanced: true, job: null };
      row.lastRunAt = ranAt;
      if (jobs.some((j) => j.tenantId === job.tenantId && j.dedupeKey === job.dedupeKey)) {
        return { advanced: true, job: null };
      }
      const created: JobRunRecord = {
        id: `j${jobs.length + 1}`,
        tenantId: job.tenantId,
        type: job.type,
        status: 'pending',
        payload: job.payload,
        attempts: 0,
        maxAttempts: job.maxAttempts ?? 1,
        runAfter: ranAt,
        dedupeKey: job.dedupeKey ?? null,
        createdAt: ranAt,
      };
      jobs.push(created);
      return { advanced: true, job: created };
    },
    async recentRuns(tenantId, limit) {
      return jobs.filter((j) => j.tenantId === tenantId).reverse().slice(0, limit);
    },
  };
}

describe('schedule time math', () => {
  it('returns today when the local time is still ahead, otherwise tomorrow', () => {
    // 01:00 UTC = 09:00 in Kuala Lumpur (UTC+8)
    const now = new Date('2026-09-29T01:00:00Z');
    expect(computeNextRun('10:00', 'Asia/Kuala_Lumpur', now).toISOString()).toBe('2026-09-29T02:00:00.000Z');
    expect(computeNextRun('08:30', 'Asia/Kuala_Lumpur', now).toISOString()).toBe('2026-09-30T00:30:00.000Z');
    expect(computeNextRun('09:00', 'Asia/Kuala_Lumpur', now).toISOString()).toBe('2026-09-30T01:00:00.000Z');
  });

  it('handles local midnight falling on the previous UTC day', () => {
    // 17:00 UTC Sep 29 = 01:00 Sep 30 in Tokyo (UTC+9)
    const now = new Date('2026-09-29T17:00:00Z');
    expect(computeNextRun('00:15', 'Asia/Tokyo', now).toISOString()).toBe('2026-09-30T15:15:00.000Z');
    expect(computeNextRun('23:59', 'Asia/Tokyo', now).toISOString()).toBe('2026-09-30T14:59:00.000Z');
    expect(localDate(now, 'Asia/Tokyo')).toBe('2026-09-30');
  });

  it('keeps the wall-clock time across a daylight-saving change', () => {
    // US DST ends Nov 1 2026: 09:00 New York is 13:00 UTC before and 14:00 UTC after.
    expect(computeNextRun('09:00', 'America/New_York', new Date('2026-10-31T12:00:00Z')).toISOString()).toBe(
      '2026-10-31T13:00:00.000Z',
    );
    expect(computeNextRun('09:00', 'America/New_York', new Date('2026-10-31T13:30:00Z')).toISOString()).toBe(
      '2026-11-01T14:00:00.000Z',
    );
  });

  it('labels the next run relative to the local day', () => {
    const now = new Date('2026-09-29T01:00:00Z');
    expect(relativeDay(new Date('2026-09-29T02:00:00Z'), 'Asia/Kuala_Lumpur', now)).toBe('today');
    expect(relativeDay(new Date('2026-09-30T02:00:00Z'), 'Asia/Kuala_Lumpur', now)).toBe('tomorrow');
  });
});

describe('schedule use cases', () => {
  const now = new Date('2026-09-29T01:00:00Z'); // 09:00 Malaysia

  it('creates schedules, groups them by country and rejects duplicates', async () => {
    const schedules = memorySchedules();
    const deps = { schedules, now: () => now };
    const first = await createSchedule(deps, { tenantId: 't1', country: 'malaysia', time: '10:00' });
    expect(first).toMatchObject({
      countryCode: 'MY',
      country: 'Malaysia',
      time: '10:00',
      timezone: 'Asia/Kuala_Lumpur',
      nextRunAt: '2026-09-29T02:00:00.000Z',
      nextRunDay: 'today',
    });
    await createSchedule(deps, { tenantId: 't1', country: 'MY', time: '08:00' });
    await createSchedule(deps, { tenantId: 't1', country: 'Japan', time: '09:30', timezone: 'Asia/Tokyo' });

    await expect(createSchedule(deps, { tenantId: 't1', country: 'Malaysia', time: '10:00' })).rejects.toMatchObject({
      code: 'conflict',
      status: 409,
    });

    const groups = await listSchedules(deps, { tenantId: 't1' });
    expect(groups.map((g) => [g.country, g.timesPerDay])).toEqual([
      ['Japan', 1],
      ['Malaysia', 2],
    ]);
    expect(groups[1]!.schedules.map((s) => [s.time, s.nextRunDay])).toEqual([
      ['08:00', 'tomorrow'],
      ['10:00', 'today'],
    ]);
  });

  it('validates country, time and time zone', async () => {
    const deps = { schedules: memorySchedules(), now: () => now };
    const bad = [
      { country: 'Atlantis', time: '10:00' },
      { country: 'Malaysia', time: '25:00' },
      { country: 'Malaysia', time: '10:00', timezone: 'Mars/Olympus' },
    ];
    for (const input of bad) {
      await expect(createSchedule(deps, { tenantId: 't1', ...input })).rejects.toBeInstanceOf(ScheduleError);
    }
  });

  it('deletes one time or every time of a country', async () => {
    const schedules = memorySchedules();
    const deps = { schedules, now: () => now };
    const a = await createSchedule(deps, { tenantId: 't1', country: 'Malaysia', time: '10:00' });
    await createSchedule(deps, { tenantId: 't1', country: 'Malaysia', time: '15:00' });
    await createSchedule(deps, { tenantId: 't1', country: 'Singapore', time: '15:00' });

    await deleteSchedule(deps, { tenantId: 't1', id: a.id });
    await expect(deleteSchedule(deps, { tenantId: 't1', id: a.id })).rejects.toMatchObject({ status: 404 });
    await expect(deleteSchedule(deps, { tenantId: 't2', id: schedules.rows[0]!.id })).rejects.toMatchObject({
      status: 404,
    });
    expect(await deleteCountrySchedules(deps, { tenantId: 't1', country: 'my' })).toEqual({ deleted: 1 });
    expect(schedules.rows.map((r) => r.countryCode)).toEqual(['SG']);
  });

  it('enqueues a due schedule once per local day and moves it to the next day', async () => {
    const schedules = memorySchedules();
    const logger = createSilentLogger();
    const s = await createSchedule({ schedules, now: () => now }, { tenantId: 't1', country: 'MY', time: '10:00' });

    expect((await enqueueDueSchedules({ schedules, logger, now: () => now })).enqueued).toHaveLength(0);

    const at = new Date('2026-09-29T02:00:20Z');
    const first = await enqueueDueSchedules({ schedules, logger, now: () => at });
    expect(first.enqueued).toHaveLength(1);
    expect(schedules.jobs[0]).toMatchObject({
      type: 'country_discovery',
      dedupeKey: `schedule:${s.id}:2026-09-29`,
      payload: { mode: 'country', origin: 'schedule', country: 'Malaysia', countryCode: 'MY', time: '10:00' },
    });
    expect(schedules.rows[0]!.nextRunAt.toISOString()).toBe('2026-09-30T02:00:00.000Z');

    // A second tick, or a second worker, does not enqueue the same day again.
    expect((await enqueueDueSchedules({ schedules, logger, now: () => at })).enqueued).toHaveLength(0);
    expect(schedules.jobs).toHaveLength(1);
  });

  it('skips a slot missed by more than the grace window instead of running it late', async () => {
    const schedules = memorySchedules();
    await createSchedule({ schedules, now: () => now }, { tenantId: 't1', country: 'MY', time: '10:00' });
    const muchLater = new Date('2026-09-29T07:00:00Z'); // 15:00 Malaysia, 5h late
    const res = await enqueueDueSchedules({ schedules, now: () => muchLater }, { graceMs: 2 * 3600_000 });
    expect(res).toMatchObject({ enqueued: [], missed: 1 });
    expect(schedules.jobs).toHaveLength(0);
    expect(schedules.rows[0]!.nextRunAt.toISOString()).toBe('2026-09-30T02:00:00.000Z');
  });

  it('maps finished runs to the run history columns', async () => {
    const schedules = memorySchedules();
    await createSchedule({ schedules, now: () => now }, { tenantId: 't1', country: 'MY', time: '10:00' });
    await enqueueDueSchedules({ schedules, now: () => new Date('2026-09-29T02:00:05Z') });
    Object.assign(schedules.jobs[0]!, {
      status: 'done',
      result: { found: 40, created: 38, duplicates: 2, stoppedReason: 'run_budget_reached' },
    });
    const [run] = await listScheduleRuns({ schedules }, { tenantId: 't1' });
    expect(run).toMatchObject({
      day: '2026-09-29',
      country: 'Malaysia',
      time: '10:00',
      trigger: 'schedule',
      status: 'done',
      found: 40,
      saved: 38,
      skipped: 2,
      stoppedReason: 'run_budget_reached',
    });
  });

  it('stores selected industries on schedule creation and passes them to job payload', async () => {
    const schedules = memorySchedules();
    const created = await createSchedule(
      { schedules, now: () => now },
      {
        tenantId: 't1',
        country: 'MY',
        time: '10:00',
        industries: ['dentist', 'medical clinic'],
      },
    );
    expect(created.industries).toEqual(['dentist', 'medical clinic']);
    expect(schedules.rows[0]!.industries).toEqual(['dentist', 'medical clinic']);

    // When enqueued, the job payload must include the selected industries
    await enqueueDueSchedules({ schedules, now: () => new Date('2026-09-29T02:00:05Z') });
    expect(schedules.jobs).toHaveLength(1);
    const jobPayload = schedules.jobs[0]!.payload as any;
    expect(jobPayload.industries).toEqual(['dentist', 'medical clinic']);
  });

  it('keeps the old payload when no crawl settings are given', async () => {
    const schedules = memorySchedules();
    await createSchedule({ schedules, now: () => now }, { tenantId: 't1', country: 'MY', time: '10:00' });
    const res = await enqueueDueSchedules({ schedules, now: () => new Date('2026-09-29T02:00:05Z') });
    expect(res).toMatchObject({ skipped: 0 });
    const payload = schedules.jobs[0]!.payload as Record<string, unknown>;
    expect(payload.maxSearches).toBeUndefined();
    expect(payload.maxPages).toBeUndefined();
    expect(payload.cities).toBeUndefined();
  });

  it('omits industries from job payload when schedule was created with empty/no industries (defaults to all)', async () => {
    const schedules = memorySchedules();
    const created = await createSchedule(
      { schedules, now: () => now },
      { tenantId: 't1', country: 'MY', time: '10:00' },
    );
    expect(created.industries).toBeUndefined();

    // When enqueued, job payload industries should be undefined
    await enqueueDueSchedules({ schedules, now: () => new Date('2026-09-29T02:00:05Z') });
    expect(schedules.jobs).toHaveLength(1);
    const jobPayload = schedules.jobs[0]!.payload as any;
    expect(jobPayload.industries).toBeUndefined();
  });
});

describe('scheduled runs follow the crawl settings', () => {
  const created = new Date('2026-09-29T01:00:00Z'); // 09:00 Malaysia and Singapore
  const due = new Date('2026-09-29T02:00:05Z'); // just after 10:00 local
  const nextDayDue = new Date('2026-09-30T02:00:05Z');

  function crawlSettings(over: Partial<ScheduleCrawlSettings> = {}, crawlsToday = 0) {
    const state = {
      settings: {
        active: true,
        crawlBatchSize: 20,
        maxPagesPerSearch: 3,
        maxDailyCrawlRuns: 10,
        targetCountry: 'SG',
        targetCities: [],
        targetIndustries: [],
        ...over,
      } as ScheduleCrawlSettings,
      crawlsToday,
      sinceAsked: [] as Date[],
    };
    const source: ScheduleCrawlSettingsSource = {
      get: async () => state.settings,
      crawlsSince: async (_tenantId, since) => {
        state.sinceAsked.push(since);
        return state.crawlsToday;
      },
    };
    return { state, source };
  }

  async function setup(countries: Array<{ country: string; industries?: string[] }>) {
    const schedules = memorySchedules();
    for (const c of countries) {
      await createSchedule({ schedules, now: () => created }, { tenantId: 't1', time: '10:00', ...c });
    }
    return schedules;
  }

  const payloads = (schedules: ReturnType<typeof memorySchedules>) =>
    schedules.jobs.map((j) => j.payload as Record<string, unknown>);

  it('skips the run while the engine is off, moves it to the next day and never makes it up', async () => {
    const schedules = await setup([{ country: 'MY' }]);
    const { state, source } = crawlSettings({ active: false });

    const paused = await enqueueDueSchedules({ schedules, now: () => due, crawlSettings: source });
    expect(paused).toMatchObject({ enqueued: [], skipped: 1, missed: 0 });
    expect(schedules.jobs).toHaveLength(0);
    expect(schedules.rows[0]!.nextRunAt.toISOString()).toBe('2026-09-30T02:00:00.000Z');
    expect(schedules.rows[0]!.lastRunAt).toBeNull();

    state.settings = { ...state.settings, active: true };
    expect((await enqueueDueSchedules({ schedules, now: () => due, crawlSettings: source })).enqueued).toHaveLength(0);
    const resumed = await enqueueDueSchedules({ schedules, now: () => nextDayDue, crawlSettings: source });
    expect(resumed.enqueued).toHaveLength(1);
    expect(schedules.jobs.map((j) => j.dedupeKey)).toEqual([`schedule:${schedules.rows[0]!.id}:2026-09-30`]);
  });

  it('skips the run once Max Daily Crawl Runs is used for the UTC day and moves it on', async () => {
    const schedules = await setup([{ country: 'MY' }]);
    const { state, source } = crawlSettings({ maxDailyCrawlRuns: 3 }, 3);
    const res = await enqueueDueSchedules({ schedules, now: () => due, crawlSettings: source });
    expect(res).toMatchObject({ enqueued: [], skipped: 1 });
    expect(schedules.rows[0]!.nextRunAt.toISOString()).toBe('2026-09-30T02:00:00.000Z');
    expect(state.sinceAsked.map((d) => d.toISOString())).toEqual(['2026-09-29T00:00:00.000Z']);
  });

  it('counts runs queued in the same tick against the daily limit', async () => {
    const schedules = await setup([{ country: 'MY' }, { country: 'SG' }]);
    const { source } = crawlSettings({ maxDailyCrawlRuns: 1 });
    const res = await enqueueDueSchedules({ schedules, now: () => due, crawlSettings: source });
    expect(res).toMatchObject({ skipped: 1 });
    expect(res.enqueued).toHaveLength(1);
    expect(schedules.rows.every((r) => r.nextRunAt.toISOString() === '2026-09-30T02:00:00.000Z')).toBe(true);
  });

  it('takes batch size and pages per search (at most 3) from the crawl settings', async () => {
    const schedules = await setup([{ country: 'MY' }]);
    const { source } = crawlSettings({ crawlBatchSize: 45, maxPagesPerSearch: 2 });
    await enqueueDueSchedules({ schedules, now: () => due, crawlSettings: source });
    expect(payloads(schedules)[0]).toMatchObject({ maxSearches: 3, maxPages: 2 });

    const capped = await setup([{ country: 'MY' }]);
    await enqueueDueSchedules({ schedules: capped, now: () => due, crawlSettings: crawlSettings({ maxPagesPerSearch: 20 }).source });
    expect(payloads(capped)[0]).toMatchObject({ maxSearches: 1, maxPages: 3 });
  });

  it("uses the target industries unless the schedule has its own", async () => {
    const schedules = await setup([{ country: 'MY' }, { country: 'SG', industries: ['dentist'] }]);
    const { source } = crawlSettings({ targetIndustries: ['gym', 'spa'] });
    await enqueueDueSchedules({ schedules, now: () => due, crawlSettings: source });
    const byCountry = Object.fromEntries(payloads(schedules).map((p) => [p.countryCode, p.industries]));
    expect(byCountry).toEqual({ MY: ['gym', 'spa'], SG: ['dentist'] });
  });

  it('crawls each schedule in its own country, with the target cities only for the target country', async () => {
    const schedules = await setup([{ country: 'MY' }, { country: 'SG' }]);
    const { source } = crawlSettings({ targetCountry: 'MY', targetCities: ['Kuala Lumpur'] });
    const res = await enqueueDueSchedules({ schedules, now: () => due, crawlSettings: source });
    expect(res.enqueued).toHaveLength(2);
    const byCountry = Object.fromEntries(payloads(schedules).map((p) => [p.countryCode, p]));
    expect(byCountry.MY).toMatchObject({ country: 'Malaysia', cities: ['Kuala Lumpur'] });
    expect(byCountry.SG).toMatchObject({ country: 'Singapore' });
    expect(byCountry.SG!.cities).toBeUndefined();
  });

  it('skips a target-country run whose saved cities do not belong to it, leaving other countries alone', async () => {
    const schedules = await setup([{ country: 'SG' }, { country: 'MY' }]);
    const { source } = crawlSettings({ targetCountry: 'SG', targetCities: ['Kuala Lumpur'] });
    const res = await enqueueDueSchedules({ schedules, now: () => due, crawlSettings: source });
    expect(res).toMatchObject({ skipped: 1 });
    expect(payloads(schedules).map((p) => p.countryCode)).toEqual(['MY']);
  });
});
