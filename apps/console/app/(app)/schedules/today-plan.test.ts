import { describe, expect, it } from 'vitest';
import { crawlSettings } from '@/test/fixtures';
import type { Schedule, ScheduleRun, ScheduleSkip } from '@/lib/types';
import { localDay, mergeHistory, slotPlanToday } from './today-plan';

const NOW = new Date('2026-11-05T01:00:00Z'); // 09:00 in Singapore

const schedule = (over: Partial<Schedule> = {}): Schedule => ({
  id: 's1',
  countryCode: 'SG',
  country: 'Singapore',
  time: '10:00',
  timezone: 'Asia/Singapore',
  nextRunAt: '2026-11-05T02:00:00.000Z',
  nextRunDay: 'today',
  lastRunAt: null,
  ...over,
});

const run = (over: Partial<ScheduleRun> = {}): ScheduleRun => ({
  id: 'j1',
  scheduleId: 's1',
  day: '2026-11-05',
  countryCode: 'SG',
  country: 'Singapore',
  time: '10:00',
  timezone: 'Asia/Singapore',
  trigger: 'schedule',
  status: 'done',
  found: 10,
  saved: 8,
  skipped: 2,
  stoppedReason: null,
  error: null,
  startedAt: '2026-11-05T02:00:10.000Z',
  finishedAt: '2026-11-05T02:03:00.000Z',
  ...over,
});

const skip = (over: Partial<ScheduleSkip> = {}): ScheduleSkip => ({
  id: 'k1',
  scheduleId: 's1',
  day: '2026-11-05',
  countryCode: 'SG',
  country: 'Singapore',
  time: '10:00',
  timezone: 'Asia/Singapore',
  scheduledFor: '2026-11-05T02:00:00.000Z',
  reason: 'engine_paused',
  detail: null,
  createdAt: '2026-11-05T02:00:05.000Z',
  ...over,
});

const plan = (input: Partial<Parameters<typeof slotPlanToday>[0]>) =>
  slotPlanToday({
    schedule: schedule(),
    runs: [],
    skips: [],
    settings: crawlSettings(),
    scheduleRunsLeft: 5,
    now: NOW,
    ...input,
  });

describe("today's plan", () => {
  it('reports a slot that already ran or was skipped today', () => {
    expect(plan({ runs: [run()], schedule: schedule({ nextRunDay: 'tomorrow' }) })).toMatchObject({ status: 'ran' });
    expect(plan({ skips: [skip({ reason: 'daily_run_limit' })], schedule: schedule({ nextRunDay: 'tomorrow' }) })).toEqual({
      status: 'skipped',
      reason: 'daily_run_limit',
      detail: null,
    });
    // Runs of other schedules or other days do not count.
    expect(plan({ runs: [run({ scheduleId: 's2' }), run({ day: '2026-11-04' })] })).toEqual({ status: 'will_run' });
  });

  it('predicts upcoming slots from the engine, crawl mode and runs left', () => {
    expect(plan({})).toEqual({ status: 'will_run' });
    expect(plan({ settings: crawlSettings({ active: false }) })).toEqual({ status: 'will_skip', reason: 'engine_paused' });
    expect(plan({ settings: crawlSettings({ crawlMode: 'auto_only' }) })).toEqual({ status: 'will_skip', reason: 'crawl_mode' });
    expect(plan({ scheduleRunsLeft: 0 })).toEqual({ status: 'will_skip', reason: 'daily_run_limit' });
  });

  it('says when there is no slot left today', () => {
    expect(plan({ schedule: schedule({ nextRunDay: 'tomorrow' }) })).toEqual({ status: 'no_slot_today' });
  });

  it('uses the schedule time zone for "today"', () => {
    // 20:00 UTC on Nov 4 is already Nov 5 in Singapore.
    expect(localDay(new Date('2026-11-04T20:00:00Z'), 'Asia/Singapore')).toBe('2026-11-05');
    expect(localDay(new Date('2026-11-04T20:00:00Z'), 'UTC')).toBe('2026-11-04');
  });
});

describe('run history', () => {
  it('lists runs and skipped slots together, newest first', () => {
    const entries = mergeHistory(
      [run({ id: 'old', startedAt: '2026-11-03T02:00:00.000Z' }), run({ id: 'pending', startedAt: null })],
      [skip({ scheduledFor: '2026-11-04T02:00:00.000Z' })],
      NOW,
    );
    expect(entries.map((e) => (e.kind === 'run' ? e.run.id : `skip:${e.skip.reason}`))).toEqual([
      'pending',
      'skip:engine_paused',
      'old',
    ]);
  });
});
