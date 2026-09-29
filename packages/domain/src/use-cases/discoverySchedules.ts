import type { DiscoveryScheduleRecord, DiscoveryScheduleRepo, JobRunRecord, JobStatus, Logger } from '../ports';
import { resolveCountry, supportedCountries } from '../discovery/countries';
import {
  computeNextRun,
  DEFAULT_SCHEDULE_TIMEZONE,
  isValidTimeZone,
  localDate,
  localTime,
  relativeDay,
  TIME_OF_DAY,
} from '../discovery/schedule-time';
import type { CountryDiscoveryResult } from './runCountryDiscovery';

export type ScheduleErrorCode = 'validation_error' | 'not_found' | 'conflict';

const STATUS_BY_CODE: Record<ScheduleErrorCode, number> = { validation_error: 400, not_found: 404, conflict: 409 };

/** Carries an HTTP-style code/status so API routes can map it without knowing the use case. */
export class ScheduleError extends Error {
  readonly status: number;
  constructor(
    readonly code: ScheduleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ScheduleError';
    this.status = STATUS_BY_CODE[code];
  }
}

/** Payload of a country_discovery job; the discover CLI writes the same shape with origin "manual". */
export type CountryDiscoveryJobPayload = {
  mode: 'country';
  origin: 'schedule' | 'manual';
  country: string;
  countryCode: string;
  scheduleId?: string;
  time?: string;
  timezone?: string;
  scheduledFor?: string;
  cities?: string[];
  industries?: string[];
  maxPages?: number;
  maxSearches?: number;
  maxCallsPerDay?: number;
  reset?: boolean;
};

export type ScheduleView = {
  id: string;
  countryCode: string;
  country: string;
  time: string;
  timezone: string;
  nextRunAt: string;
  /** "today", "tomorrow" or YYYY-MM-DD in the schedule's time zone. */
  nextRunDay: string;
  lastRunAt: string | null;
};

export type CountryScheduleGroup = {
  countryCode: string;
  country: string;
  timesPerDay: number;
  schedules: ScheduleView[];
};

export type ScheduleRunView = {
  id: string;
  /** Local date the run was for (schedule's time zone), YYYY-MM-DD. */
  day: string;
  countryCode: string;
  country: string;
  time: string;
  timezone: string;
  trigger: 'schedule' | 'manual';
  status: JobStatus;
  found: number;
  saved: number;
  /** Already in the database. */
  skipped: number;
  stoppedReason: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

type ScheduleDeps = { schedules: DiscoveryScheduleRepo; now?: () => Date };

function countryOrThrow(input: string) {
  const profile = resolveCountry(input);
  if (!profile) {
    throw new ScheduleError(
      'validation_error',
      `Unsupported country "${input}". Supported: ${supportedCountries().join(', ')}`,
    );
  }
  return profile;
}

function toView(s: DiscoveryScheduleRecord, now: Date): ScheduleView {
  return {
    id: s.id,
    countryCode: s.countryCode,
    country: resolveCountry(s.countryCode)?.name ?? s.countryCode,
    time: s.timeOfDay,
    timezone: s.timezone,
    nextRunAt: s.nextRunAt.toISOString(),
    nextRunDay: relativeDay(s.nextRunAt, s.timezone, now),
    lastRunAt: s.lastRunAt?.toISOString() ?? null,
  };
}

export async function createSchedule(
  deps: ScheduleDeps,
  input: { tenantId: string; country: string; time: string; timezone?: string },
): Promise<ScheduleView> {
  const profile = countryOrThrow(input.country);
  const time = input.time.trim();
  if (!TIME_OF_DAY.test(time)) throw new ScheduleError('validation_error', `Invalid time "${input.time}", use HH:mm`);
  const timezone = input.timezone?.trim() || DEFAULT_SCHEDULE_TIMEZONE;
  if (!isValidTimeZone(timezone)) throw new ScheduleError('validation_error', `Unknown time zone "${timezone}"`);

  const now = deps.now?.() ?? new Date();
  const created = await deps.schedules.create({
    tenantId: input.tenantId,
    countryCode: profile.code,
    timeOfDay: time,
    timezone,
    nextRunAt: computeNextRun(time, timezone, now),
  });
  if (!created) throw new ScheduleError('conflict', `${profile.name} is already scheduled at ${time}`);
  return toView(created, now);
}

export async function listSchedules(deps: ScheduleDeps, input: { tenantId: string }): Promise<CountryScheduleGroup[]> {
  const now = deps.now?.() ?? new Date();
  const groups = new Map<string, CountryScheduleGroup>();
  for (const s of await deps.schedules.list(input.tenantId)) {
    const view = toView(s, now);
    let group = groups.get(s.countryCode);
    if (!group) {
      group = { countryCode: s.countryCode, country: view.country, timesPerDay: 0, schedules: [] };
      groups.set(s.countryCode, group);
    }
    group.schedules.push(view);
    group.timesPerDay += 1;
  }
  const out = [...groups.values()].sort((a, b) => a.country.localeCompare(b.country));
  for (const g of out) g.schedules.sort((a, b) => a.time.localeCompare(b.time));
  return out;
}

export async function deleteSchedule(deps: ScheduleDeps, input: { tenantId: string; id: string }) {
  if (!(await deps.schedules.delete(input.tenantId, input.id))) {
    throw new ScheduleError('not_found', 'Schedule not found');
  }
  return { deleted: 1 };
}

export async function deleteCountrySchedules(deps: ScheduleDeps, input: { tenantId: string; country: string }) {
  const profile = countryOrThrow(input.country);
  return { deleted: await deps.schedules.deleteByCountry(input.tenantId, profile.code) };
}

export async function listScheduleRuns(
  deps: ScheduleDeps,
  input: { tenantId: string; limit?: number },
): Promise<ScheduleRunView[]> {
  const limit = Math.min(200, Math.max(1, Math.floor(input.limit ?? 50)));
  const jobs = await deps.schedules.recentRuns(input.tenantId, limit);
  return jobs.map(toRunView);
}

function toRunView(job: JobRunRecord): ScheduleRunView {
  const payload = (job.payload ?? {}) as Partial<CountryDiscoveryJobPayload>;
  const result = (job.result ?? {}) as Partial<CountryDiscoveryResult>;
  const timezone = payload.timezone || DEFAULT_SCHEDULE_TIMEZONE;
  const at = payload.scheduledFor ? new Date(payload.scheduledFor) : (job.startedAt ?? job.createdAt ?? new Date());
  const profile = resolveCountry(payload.countryCode ?? payload.country ?? '');
  return {
    id: job.id,
    day: localDate(at, timezone),
    countryCode: profile?.code ?? payload.countryCode ?? '',
    country: profile?.name ?? payload.country ?? '',
    time: payload.time ?? localTime(at, timezone),
    timezone,
    trigger: payload.origin === 'schedule' ? 'schedule' : 'manual',
    status: job.status,
    found: result.found ?? 0,
    saved: result.created ?? 0,
    skipped: result.duplicates ?? 0,
    stoppedReason: result.stoppedReason ?? null,
    error: job.lastError ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

export function scheduleRunDedupeKey(scheduleId: string, day: string): string {
  return `schedule:${scheduleId}:${day}`;
}

export type EnqueueDueResult = { enqueued: string[]; missed: number; failed: number };

/**
 * Turns due schedules into country_discovery jobs, once per schedule per local day.
 * A slot more than `graceMs` in the past (worker was down) is skipped rather than run late.
 */
export async function enqueueDueSchedules(
  deps: ScheduleDeps & { logger?: Logger },
  opts: { limit?: number; graceMs?: number } = {},
): Promise<EnqueueDueResult> {
  const now = deps.now?.() ?? new Date();
  const graceMs = opts.graceMs ?? 2 * 60 * 60_000;
  const out: EnqueueDueResult = { enqueued: [], missed: 0, failed: 0 };

  for (const s of await deps.schedules.due(now, opts.limit ?? 50)) {
    try {
      const next = computeNextRun(s.timeOfDay, s.timezone, now);
      const profile = resolveCountry(s.countryCode);
      const late = now.getTime() - s.nextRunAt.getTime() > graceMs;
      if (late || !profile) {
        const { advanced } = await deps.schedules.advance(s, next, now);
        if (advanced) out.missed += 1;
        deps.logger?.info('schedule_run_skipped', {
          scheduleId: s.id,
          reason: profile ? 'missed_window' : 'unsupported_country',
          scheduledFor: s.nextRunAt.toISOString(),
        });
        continue;
      }
      const payload: CountryDiscoveryJobPayload = {
        mode: 'country',
        origin: 'schedule',
        scheduleId: s.id,
        country: profile.name,
        countryCode: profile.code,
        time: s.timeOfDay,
        timezone: s.timezone,
        scheduledFor: s.nextRunAt.toISOString(),
      };
      const { job } = await deps.schedules.advance(s, next, now, {
        tenantId: s.tenantId,
        type: 'country_discovery',
        payload,
        dedupeKey: scheduleRunDedupeKey(s.id, localDate(s.nextRunAt, s.timezone)),
        maxAttempts: 1,
      });
      if (job) {
        out.enqueued.push(job.id);
        deps.logger?.info('schedule_run_enqueued', {
          scheduleId: s.id,
          jobId: job.id,
          country: profile.code,
          time: s.timeOfDay,
          nextRunAt: next.toISOString(),
        });
      }
    } catch (error) {
      out.failed += 1;
      deps.logger?.error('schedule_enqueue_failed', {
        scheduleId: s.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return out;
}
