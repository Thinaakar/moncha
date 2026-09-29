import type { DiscoveryTargetRepo, JobRepo, JobRunRecord } from '../ports';
import type { CountryDiscoveryJobPayload } from './discoverySchedules';
import { runCountryDiscovery, type CountryDiscoveryDeps, type CountryDiscoveryResult } from './runCountryDiscovery';

export type CountryDiscoveryJobDeps = CountryDiscoveryDeps & { jobs: JobRepo };

/**
 * Runs one country_discovery job to completion and records the outcome on the job.
 * The job's lockedAt is refreshed before every search and serves as the crawl's heartbeat.
 * Failed runs are not retried: the next run resumes from the same targets.
 */
export async function runCountryDiscoveryJob(
  deps: CountryDiscoveryJobDeps,
  input: {
    job: JobRunRecord;
    maxCallsPerDay: number;
    maxCallsPerRun?: number;
    source?: string;
    signal?: AbortSignal;
  },
): Promise<CountryDiscoveryResult> {
  const { job } = input;
  const now = deps.now ?? (() => new Date());
  const payload = (job.payload ?? {}) as Partial<CountryDiscoveryJobPayload>;

  const heartbeat = () => deps.jobs.update(job.tenantId, job.id, { lockedAt: now() });
  const targets: DiscoveryTargetRepo = {
    ensure: (key, pairs) => deps.targets.ensure(key, pairs),
    nextBatch: (key, limit, maxAttempts, filter) => deps.targets.nextBatch(key, limit, maxAttempts, filter),
    markStarted: async (id) => {
      await deps.targets.markStarted(id);
      await heartbeat();
    },
    markDone: (id, stats) => deps.targets.markDone(id, stats),
    markFailed: (id, error, calls) => deps.targets.markFailed(id, error, calls),
    counts: (key) => deps.targets.counts(key),
    reset: (key) => deps.targets.reset(key),
  };

  if (job.status === 'pending') {
    await deps.jobs.update(job.tenantId, job.id, { status: 'running', startedAt: now(), lockedAt: now() });
  }

  try {
    const country = payload.countryCode || payload.country;
    if (!country) throw new Error('country_discovery job has no country');
    const result = await runCountryDiscovery(
      { ...deps, targets },
      {
        tenantId: job.tenantId,
        country,
        source: input.source ?? 'google_places',
        maxCallsPerDay: payload.maxCallsPerDay ?? input.maxCallsPerDay,
        maxCallsPerRun: input.maxCallsPerRun,
        cities: payload.cities,
        industries: payload.industries,
        maxPages: payload.maxPages,
        maxSearches: payload.maxSearches,
        reset: payload.reset,
        signal: input.signal,
      },
    );
    const failed = result.stoppedReason === 'provider_error';
    await deps.jobs.update(job.tenantId, job.id, {
      status: failed ? 'failed' : 'done',
      result,
      lastError: failed ? (result.lastError ?? 'provider_error') : null,
      finishedAt: now(),
      lockedAt: null,
      lockedBy: null,
    });
    return result;
  } catch (error) {
    await deps.jobs.update(job.tenantId, job.id, {
      status: 'failed',
      lastError: error instanceof Error ? error.message : String(error),
      finishedAt: now(),
      lockedAt: null,
      lockedBy: null,
    });
    throw error;
  }
}
