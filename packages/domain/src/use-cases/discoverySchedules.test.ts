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
});
