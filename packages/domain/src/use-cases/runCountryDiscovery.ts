import type {
  CompanyRepo,
  DiscoverySource,
  DiscoveryTargetKey,
  DiscoveryTargetRepo,
  DiscoveryUsageRepo,
  JobRepo,
  LeadRepo,
  Logger,
  WebsiteRepo,
} from '../ports';
import { utcDay } from '../ports';
import type { AuditConfig } from '../config/audit';
import { resolveCountry, supportedCountries } from '../discovery/countries';
import { DEFAULT_INDUSTRIES } from '../discovery/industries';
import { discoverCompanies } from './discoverCompanies';

export type CountryDiscoveryDeps = {
  source: DiscoverySource;
  /** Cumulative provider HTTP requests made by `source`; used for the daily budget. */
  providerCalls: () => number;
  targets: DiscoveryTargetRepo;
  usage: DiscoveryUsageRepo;
  companies: CompanyRepo;
  leads: LeadRepo;
  websites?: WebsiteRepo;
  jobs?: JobRepo;
  logger?: Logger;
  config?: AuditConfig;
  now?: () => Date;
};

export type CountryDiscoveryInput = {
  tenantId: string;
  country: string;
  source: string;
  maxCallsPerDay: number;
  /** Restrict this run to these search areas (must match the country's city labels). */
  cities?: string[];
  industries?: string[];
  /** Result pages per search; Google Places returns 20 per page, max 3. */
  maxPages?: number;
  /** Stop after this many searches in this run. */
  maxSearches?: number;
  maxAttempts?: number;
  /** Put every target for the country back to pending before running. */
  reset?: boolean;
  /** Checked between searches; the current search always finishes. */
  signal?: AbortSignal;
};

export type CountryDiscoveryStopReason =
  | 'completed'
  | 'daily_budget_reached'
  | 'max_searches_reached'
  | 'provider_error'
  | 'aborted';

export type CountryDiscoveryResult = {
  country: string;
  countryCode: string;
  plannedTargets: number;
  newTargets: number;
  searches: number;
  failedSearches: number;
  calls: number;
  callsToday: number;
  found: number;
  created: number;
  duplicates: number;
  auditsEnqueued: number;
  noWebsite: number;
  targets: { pending: number; done: number; failed: number };
  stoppedReason: CountryDiscoveryStopReason;
  lastError?: string;
};

/** Errors that will repeat for every target (bad key, disabled API) — stop instead of burning the list. */
const FATAL_PROVIDER_ERROR = /request denied|api_key is required|api key|permission|billing|invalid request/i;

export async function runCountryDiscovery(
  deps: CountryDiscoveryDeps,
  input: CountryDiscoveryInput,
): Promise<CountryDiscoveryResult> {
  const profile = resolveCountry(input.country);
  if (!profile) {
    throw new Error(`Unsupported country "${input.country}". Supported: ${supportedCountries().join(', ')}`);
  }
  const now = deps.now ?? (() => new Date());
  const maxPages = Math.min(3, Math.max(1, input.maxPages ?? 3));
  const maxAttempts = Math.max(1, input.maxAttempts ?? 3);
  const key: DiscoveryTargetKey = { tenantId: input.tenantId, source: input.source, countryCode: profile.code };

  const cities = input.cities?.length ? pickCities(profile.cities, input.cities, profile.name) : [...profile.cities];
  const industries = input.industries?.length ? input.industries : [...DEFAULT_INDUSTRIES];
  const pairs = cities.flatMap((city) => industries.map((keyword) => ({ city, keyword })));

  if (input.reset) {
    const reset = await deps.targets.reset(key);
    deps.logger?.info('country_discovery_reset', { ...key, reset });
  }
  const newTargets = await deps.targets.ensure(key, pairs);
  const filter = { cities, keywords: industries };

  const result: CountryDiscoveryResult = {
    country: profile.name,
    countryCode: profile.code,
    plannedTargets: pairs.length,
    newTargets,
    searches: 0,
    failedSearches: 0,
    calls: 0,
    callsToday: await deps.usage.get(input.tenantId, input.source, utcDay(now())),
    found: 0,
    created: 0,
    duplicates: 0,
    auditsEnqueued: 0,
    noWebsite: 0,
    targets: { pending: 0, done: 0, failed: 0 },
    stoppedReason: 'completed',
  };

  deps.logger?.info('country_discovery_started', {
    ...key,
    country: profile.name,
    cities: cities.length,
    industries: industries.length,
    plannedTargets: pairs.length,
    newTargets,
    maxCallsPerDay: input.maxCallsPerDay,
    callsToday: result.callsToday,
  });

  outer: for (;;) {
    const batch = await deps.targets.nextBatch(key, 25, maxAttempts, filter);
    if (!batch.length) break;

    for (const target of batch) {
      if (input.signal?.aborted) {
        result.stoppedReason = 'aborted';
        break outer;
      }
      if (input.maxSearches && result.searches >= input.maxSearches) {
        result.stoppedReason = 'max_searches_reached';
        break outer;
      }
      const day = utcDay(now());
      result.callsToday = await deps.usage.get(input.tenantId, input.source, day);
      const remaining = input.maxCallsPerDay - result.callsToday;
      if (remaining <= 0) {
        result.stoppedReason = 'daily_budget_reached';
        break outer;
      }

      await deps.targets.markStarted(target.id);
      const before = deps.providerCalls();
      result.searches += 1;
      try {
        const found = await discoverCompanies(deps, {
          tenantId: input.tenantId,
          country: profile.name,
          city: target.city,
          keyword: target.keyword,
          concurrency: 5,
          search: {
            maxPages: Math.min(maxPages, remaining),
            regionCode: profile.regionCode,
            languageCode: profile.languageCode,
          },
        });
        const calls = deps.providerCalls() - before;
        result.calls += calls;
        result.callsToday = await deps.usage.add(input.tenantId, input.source, day, calls);
        await deps.targets.markDone(target.id, { calls, found: found.found, created: found.created });
        result.found += found.found;
        result.created += found.created;
        result.duplicates += found.duplicates;
        result.auditsEnqueued += found.auditsEnqueued;
        result.noWebsite += found.noWebsite;
        deps.logger?.info('country_discovery_search_done', {
          country: profile.code,
          city: target.city,
          keyword: target.keyword,
          calls,
          found: found.found,
          created: found.created,
          auditsEnqueued: found.auditsEnqueued,
          callsToday: result.callsToday,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const calls = deps.providerCalls() - before;
        result.calls += calls;
        result.failedSearches += 1;
        result.lastError = message;
        if (calls > 0) result.callsToday = await deps.usage.add(input.tenantId, input.source, day, calls);
        await deps.targets.markFailed(target.id, message, calls);
        deps.logger?.error('country_discovery_search_failed', {
          country: profile.code,
          city: target.city,
          keyword: target.keyword,
          message,
        });
        if (FATAL_PROVIDER_ERROR.test(message)) {
          result.stoppedReason = 'provider_error';
          break outer;
        }
      }
    }
  }

  result.targets = await deps.targets.counts(key);
  deps.logger?.info('country_discovery_finished', { ...key, ...result });
  return result;
}

function pickCities(known: readonly string[], requested: string[], countryName: string): string[] {
  const byLower = new Map(known.map((c) => [c.toLowerCase(), c]));
  const byName = new Map(known.map((c) => [c.split(',')[0]!.trim().toLowerCase(), c]));
  const out: string[] = [];
  for (const raw of requested) {
    const key = raw.trim().toLowerCase();
    const match = byLower.get(key) ?? byName.get(key);
    if (!match) throw new Error(`Unknown search area "${raw}" for ${countryName}`);
    if (!out.includes(match)) out.push(match);
  }
  return out;
}
