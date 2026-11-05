import type {
  CrawlRunClaim,
  DiscoveryScheduleRecord,
  DiscoveryScheduleRepo,
  JobRunRecord,
  JobStatus,
  Logger,
  ScheduleSkipReason,
} from '../ports';
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
import { crawlTargetError, type CountryDiscoveryResult } from './runCountryDiscovery';
import { crawlBatchLimits, crawlRunClaim, type CrawlPipelineSettingsRecord } from './crawlPipeline';

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
  origin: 'schedule' | 'manual' | 'auto';
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
  industries?: string[];
};

export type CountryScheduleGroup = {
  countryCode: string;
  country: string;
  timesPerDay: number;
  schedules: ScheduleView[];
};

export type ScheduleRunView = {
  id: string;
  /** The schedule that started the run; null for auto-recrawl and manual runs. */
  scheduleId: string | null;
  /** Local date the run was for (schedule's time zone), YYYY-MM-DD. */
  day: string;
  countryCode: string;
  country: string;
  time: string;
  timezone: string;
  trigger: 'schedule' | 'manual' | 'auto';
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
    industries: s.industries?.length ? s.industries : undefined,
  };
}

export async function createSchedule(
  deps: ScheduleDeps,
  input: { tenantId: string; country: string; time: string; timezone?: string; industries?: string[] },
): Promise<ScheduleView> {
  const profile = countryOrThrow(input.country);
  const time = input.time.trim();
  if (!TIME_OF_DAY.test(time)) throw new ScheduleError('validation_error', `Invalid time "${input.time}", use HH:mm`);
  const timezone = input.timezone?.trim() || DEFAULT_SCHEDULE_TIMEZONE;
  if (!isValidTimeZone(timezone)) throw new ScheduleError('validation_error', `Unknown time zone "${timezone}"`);

  const industries = input.industries?.map((i) => i.trim().toLowerCase()).filter(Boolean);

  const now = deps.now?.() ?? new Date();
  const created = await deps.schedules.create({
    tenantId: input.tenantId,
    countryCode: profile.code,
    timeOfDay: time,
    timezone,
    nextRunAt: computeNextRun(time, timezone, now),
    ...(industries && industries.length > 0 ? { industries } : {}),
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
    scheduleId: payload.scheduleId ?? null,
    day: localDate(at, timezone),
    countryCode: profile?.code ?? payload.countryCode ?? '',
    country: profile?.name ?? payload.country ?? '',
    time: payload.time ?? localTime(at, timezone),
    timezone,
    trigger: payload.origin === 'schedule' ? 'schedule' : payload.origin === 'auto' ? 'auto' : 'manual',
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

/**
 * `skipped` = due slots not run because of the crawl settings (engine off, crawl mode, daily run limit, invalid target
 * cities); `missed` = slots past the grace window or for an unsupported country. Both are recorded as skips.
 */
export type EnqueueDueResult = { enqueued: string[]; missed: number; failed: number; skipped: number };

export type ScheduleCrawlSettings = Pick<
  CrawlPipelineSettingsRecord,
  | 'active'
  | 'crawlMode'
  | 'crawlBatchSize'
  | 'maxPagesPerSearch'
  | 'maxDailyCrawlRuns'
  | 'scheduleReservedRuns'
  | 'targetCountry'
  | 'targetCities'
  | 'targetIndustries'
>;

/** The central crawl settings every scheduled run follows. */
export type ScheduleCrawlSettingsSource = {
  get(tenantId: string): Promise<ScheduleCrawlSettings>;
};

export type ScheduleSkipView = {
  id: string;
  scheduleId: string | null;
  /** Local date of the skipped slot (schedule's time zone), YYYY-MM-DD. */
  day: string;
  countryCode: string;
  country: string;
  time: string;
  timezone: string;
  scheduledFor: string;
  reason: ScheduleSkipReason;
  detail: string | null;
  createdAt: string;
};

export async function listScheduleSkips(
  deps: ScheduleDeps,
  input: { tenantId: string; limit?: number },
): Promise<ScheduleSkipView[]> {
  if (!deps.schedules.recentSkips) return [];
  const limit = Math.min(200, Math.max(1, Math.floor(input.limit ?? 50)));
  const rows = await deps.schedules.recentSkips(input.tenantId, limit);
  return rows.map((r) => ({
    id: r.id,
    scheduleId: r.scheduleId,
    day: localDate(r.scheduledFor, r.timezone),
    countryCode: r.countryCode,
    country: resolveCountry(r.countryCode)?.name ?? r.countryCode,
    time: r.timeOfDay,
    timezone: r.timezone,
    scheduledFor: r.scheduledFor.toISOString(),
    reason: r.reason,
    detail: r.detail,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Crawl shape of a scheduled run: the schedule's own country, the rest from the crawl settings. */
function scheduledCrawlShape(
  schedule: DiscoveryScheduleRecord,
  countryCode: string,
  settings: ScheduleCrawlSettings,
): Pick<CountryDiscoveryJobPayload, 'cities' | 'industries' | 'maxPages' | 'maxSearches'> {
  const industries = schedule.industries?.length ? schedule.industries : settings.targetIndustries;
  const sameCountry = resolveCountry(settings.targetCountry)?.code === countryCode;
  const cities = sameCountry ? settings.targetCities : [];
  return {
    ...crawlBatchLimits(settings),
    ...(industries.length ? { industries } : {}),
    ...(cities.length ? { cities } : {}),
  };
}

/**
 * Turns due schedules into country_discovery jobs, once per schedule per local day.
 * A slot more than `graceMs` in the past (worker was down) is skipped rather than run late.
 *
 * With `crawlSettings`, each run follows the tenant's Crawl & Pipeline Settings: it is skipped (moved to its next
 * slot, never made up later, and recorded) while the engine is off, when the crawl mode is Auto-recrawl only, when the
 * target cities are invalid, or when the atomic daily run claim fails (Max Daily Crawl Runs, UTC day; schedules may use
 * the runs reserved for them). Its batch size, pages per search, industries (unless the schedule has its own) and
 * cities (when the schedule's country is the target country) come from those settings. Queue depth never skips a run.
 */
export async function enqueueDueSchedules(
  deps: ScheduleDeps & { logger?: Logger; crawlSettings?: ScheduleCrawlSettingsSource },
  opts: { limit?: number; graceMs?: number } = {},
): Promise<EnqueueDueResult> {
  const now = deps.now?.() ?? new Date();
  const graceMs = opts.graceMs ?? 2 * 60 * 60_000;
  const out: EnqueueDueResult = { enqueued: [], missed: 0, failed: 0, skipped: 0 };
  const settingsByTenant = new Map<string, ScheduleCrawlSettings>();

  for (const s of await deps.schedules.due(now, opts.limit ?? 50)) {
    try {
      const next = computeNextRun(s.timeOfDay, s.timezone, now);
      const profile = resolveCountry(s.countryCode);
      const late = now.getTime() - s.nextRunAt.getTime() > graceMs;
      if (late || !profile) {
        const reason: ScheduleSkipReason = profile ? 'missed_window' : 'unsupported_country';
        const { advanced } = await deps.schedules.advance(s, next, now, undefined, { skip: { reason } });
        if (advanced) out.missed += 1;
        deps.logger?.info('schedule_run_skipped', { scheduleId: s.id, reason, scheduledFor: s.nextRunAt.toISOString() });
        continue;
      }

      let shape: ReturnType<typeof scheduledCrawlShape> | null = null;
      let claim: CrawlRunClaim | undefined;
      if (deps.crawlSettings) {
        let settings = settingsByTenant.get(s.tenantId);
        if (!settings) {
          settings = await deps.crawlSettings.get(s.tenantId);
          settingsByTenant.set(s.tenantId, settings);
        }
        shape = scheduledCrawlShape(s, profile.code, settings);
        const targetError = shape.cities ? crawlTargetError(profile.code, shape.cities) : null;
        const reason: ScheduleSkipReason | null = !settings.active
          ? 'engine_paused'
          : settings.crawlMode === 'auto_only'
            ? 'crawl_mode'
            : targetError
              ? 'invalid_targets'
              : null;
        if (reason) {
          const { advanced } = await deps.schedules.advance(s, next, now, undefined, {
            skip: { reason, detail: targetError },
          });
          if (advanced) out.skipped += 1;
          deps.logger?.info('schedule_run_skipped', {
            scheduleId: s.id,
            reason,
            scheduledFor: s.nextRunAt.toISOString(),
            nextRunAt: next.toISOString(),
            ...(targetError ? { error: targetError } : {}),
          });
          continue;
        }
        claim = crawlRunClaim(settings, 'schedule');
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
        ...(shape ?? (s.industries && s.industries.length > 0 ? { industries: s.industries } : {})),
      };
      const { advanced, job, limited } = await deps.schedules.advance(
        s,
        next,
        now,
        {
          tenantId: s.tenantId,
          type: 'country_discovery',
          payload,
          dedupeKey: scheduleRunDedupeKey(s.id, localDate(s.nextRunAt, s.timezone)),
          maxAttempts: 1,
        },
        claim ? { claim } : undefined,
      );
      if (advanced && limited) {
        out.skipped += 1;
        deps.logger?.info('schedule_run_skipped', {
          scheduleId: s.id,
          reason: 'daily_run_limit',
          scheduledFor: s.nextRunAt.toISOString(),
          nextRunAt: next.toISOString(),
          maxDailyCrawlRuns: claim?.maxRuns,
        });
        continue;
      }
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
