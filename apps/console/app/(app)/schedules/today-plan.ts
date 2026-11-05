import type { CrawlPipelineSettingsView, Schedule, ScheduleRun, ScheduleSkip, ScheduleSkipReason } from '@/lib/types';

export const SKIP_REASON_LABEL: Record<ScheduleSkipReason, string> = {
  engine_paused: 'engine paused',
  crawl_mode: 'crawl mode is Auto-recrawl only',
  daily_run_limit: 'daily run limit reached',
  invalid_targets: 'target cities not in this country',
  missed_window: 'worker was offline at the slot',
  unsupported_country: 'country not supported',
};

export type SlotPlan =
  | { status: 'ran'; run: ScheduleRun }
  | { status: 'skipped'; reason: ScheduleSkipReason; detail: string | null }
  | { status: 'will_run' }
  | { status: 'will_skip'; reason: ScheduleSkipReason }
  | { status: 'no_slot_today' };

/** Calendar date of `at` in `timeZone`, YYYY-MM-DD (the same format as run and skip `day`). */
export function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/**
 * What happens to a schedule's slot today (its own time zone): it ran, it was skipped, or, still ahead, whether it
 * will run with the current crawl settings and today's run usage. Mirrors the worker's enqueueDueSchedules.
 */
export function slotPlanToday(input: {
  schedule: Schedule;
  runs: ScheduleRun[];
  skips: ScheduleSkip[];
  settings: CrawlPipelineSettingsView | undefined;
  /** Runs schedules may still claim today (the whole daily limit minus every run used). */
  scheduleRunsLeft: number;
  now?: Date;
}): SlotPlan {
  const { schedule: s } = input;
  const today = localDay(input.now ?? new Date(), s.timezone);
  const run = input.runs.find((r) => r.scheduleId === s.id && r.day === today);
  if (run) return { status: 'ran', run };
  const skip = input.skips.find((k) => k.scheduleId === s.id && k.day === today);
  if (skip) return { status: 'skipped', reason: skip.reason, detail: skip.detail };
  if (s.nextRunDay !== 'today') return { status: 'no_slot_today' };
  const settings = input.settings;
  if (settings && !settings.active) return { status: 'will_skip', reason: 'engine_paused' };
  if (settings?.crawlMode === 'auto_only') return { status: 'will_skip', reason: 'crawl_mode' };
  if (settings && input.scheduleRunsLeft <= 0) return { status: 'will_skip', reason: 'daily_run_limit' };
  return { status: 'will_run' };
}

export type HistoryEntry = { kind: 'run'; at: string; run: ScheduleRun } | { kind: 'skip'; at: string; skip: ScheduleSkip };

/** Runs and skipped slots in one list, newest first. A run that has not started yet sorts as now. */
export function mergeHistory(runs: ScheduleRun[], skips: ScheduleSkip[], now = new Date()): HistoryEntry[] {
  const entries: HistoryEntry[] = [
    ...runs.map((run) => ({ kind: 'run' as const, at: run.startedAt ?? now.toISOString(), run })),
    ...skips.map((skip) => ({ kind: 'skip' as const, at: skip.scheduledFor, skip })),
  ];
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}
