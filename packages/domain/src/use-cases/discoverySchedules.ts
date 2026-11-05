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
import { crawlTargetError, type CountryDiscoveryResult } from './runCountryDiscovery';
import { crawlBatchLimits, type CrawlPipelineSettingsRecord } from './crawlPipeline';
import { utcDayStart } from './siteAutomation';

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

/** `skipped` = due slots not run because of the crawl settings (engine off, daily run limit, invalid target cities). */
export type EnqueueDueResult = { enqueued: string[]; missed: number; failed: number; skipped: number };

export type ScheduleCrawlSettings = Pick<
  CrawlPipelineSettingsRecord,
  'active' | 'crawlBatchSize' | 'maxPagesPerSearch' | 'maxDailyCrawlRuns' | 'targetCountry' | 'targetCities' | 'targetIndustries'
>;

/** The central crawl settings every scheduled run follows. */
export type ScheduleCrawlSettingsSource = {
  get(tenantId: string): Promise<ScheduleCrawlSettings>;
  /** Country crawls (any trigger) created since `since`. */
  crawlsSince(tenantId: string, since: Date): Promise<number>;
};

type ScheduleSkipReason = 'engine_paused' | 'daily_run_limit' | 'invalid_targets';

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
 * With `crawlSettings`, each run follows the tenant's Crawl & Pipeline Settings: it is skipped (and moved to its next
 * slot, never made up later) while the engine is off or once today's Max Daily Crawl Runs (UTC day) is used, and its
 * batch size, pages per search, industries (unless the schedule has its own) and cities (when the schedule's country
 * is the target country) come from those settings. Queue depth never skips a scheduled run.
 */
export async function enqueueDueSchedules(
  deps: ScheduleDeps & { logger?: Logger; crawlSettings?: ScheduleCrawlSettingsSource },
  opts: { limit?: number; graceMs?: number } = {},
): Promise<EnqueueDueResult> {
  const now = deps.now?.() ?? new Date();
  const graceMs = opts.graceMs ?? 2 * 60 * 60_000;
  const out: EnqueueDueResult = { enqueued: [], missed: 0, failed: 0, skipped: 0 };
  const settingsByTenant = new Map<string, ScheduleCrawlSettings>();
  const crawlsToday = new Map<string, number>();

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

      let shape: ReturnType<typeof scheduledCrawlShape> | null = null;
      if (deps.crawlSettings) {
        let settings = settingsByTenant.get(s.tenantId);
        if (!settings) {
          settings = await deps.crawlSettings.get(s.tenantId);
          settingsByTenant.set(s.tenantId, settings);
        }
        let used = crawlsToday.get(s.tenantId);
        if (used === undefined) {
          used = await deps.crawlSettings.crawlsSince(s.tenantId, utcDayStart(now));
          crawlsToday.set(s.tenantId, used);
        }
        shape = scheduledCrawlShape(s, profile.code, settings);
        const targetError = shape.cities ? crawlTargetError(profile.code, shape.cities) : null;
        const reason: ScheduleSkipReason | null = !settings.active
          ? 'engine_paused'
          : used >= settings.maxDailyCrawlRuns
            ? 'daily_run_limit'
            : targetError
              ? 'invalid_targets'
              : null;
        if (reason) {
          const { advanced } = await deps.schedules.advance(s, next, now);
          if (advanced) out.skipped += 1;
          deps.logger?.info('schedule_run_skipped', {
            scheduleId: s.id,
            reason,
            scheduledFor: s.nextRunAt.toISOString(),
            nextRunAt: next.toISOString(),
            ...(reason === 'daily_run_limit' ? { crawlsToday: used, maxDailyCrawlRuns: settings.maxDailyCrawlRuns } : {}),
            ...(targetError ? { error: targetError } : {}),
          });
          continue;
        }
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
      const { job } = await deps.schedules.advance(s, next, now, {
        tenantId: s.tenantId,
        type: 'country_discovery',
        payload,
        dedupeKey: scheduleRunDedupeKey(s.id, localDate(s.nextRunAt, s.timezone)),
        maxAttempts: 1,
      });
      if (job) {
        out.enqueued.push(job.id);
        if (crawlsToday.has(s.tenantId)) crawlsToday.set(s.tenantId, crawlsToday.get(s.tenantId)! + 1);
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
