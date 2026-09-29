import { describe, expect, it } from 'vitest';
import type {
  CompanyRepo,
  DiscoverInput,
  DiscoveryTargetRecord,
  DiscoveryTargetRepo,
  DiscoveryUsageRepo,
  LeadRepo,
} from '../ports';
import { createSilentLogger } from '../logger';
import { resolveCountry } from '../discovery/countries';
import { runCountryDiscovery } from './runCountryDiscovery';

function memoryTargets(): DiscoveryTargetRepo & { rows: DiscoveryTargetRecord[] } {
  const rows: DiscoveryTargetRecord[] = [];
  let seq = 1;
  const match = (r: DiscoveryTargetRecord, k: { tenantId: string; source: string; countryCode: string }) =>
    r.tenantId === k.tenantId && r.source === k.source && r.countryCode === k.countryCode;
  return {
    rows,
    async ensure(key, pairs) {
      let inserted = 0;
      for (const p of pairs) {
        if (rows.some((r) => match(r, key) && r.city === p.city && r.keyword === p.keyword)) continue;
        rows.push({ id: `t${seq++}`, ...key, ...p, status: 'pending', attempts: 0, calls: 0, found: 0, created: 0 });
        inserted += 1;
      }
      return inserted;
    },
    async nextBatch(key, limit, maxAttempts, filter) {
      return rows
        .filter((r) => match(r, key))
        .filter((r) => r.status === 'pending' || (r.status === 'failed' && r.attempts < maxAttempts))
        .filter((r) => !filter?.cities || filter.cities.includes(r.city))
        .filter((r) => !filter?.keywords || filter.keywords.includes(r.keyword))
        .slice(0, limit);
    },
    async markStarted(id) {
      const r = rows.find((x) => x.id === id)!;
      r.attempts += 1;
    },
    async markDone(id, stats) {
      Object.assign(rows.find((x) => x.id === id)!, { status: 'done', ...stats });
    },
    async markFailed(id, error, calls) {
      Object.assign(rows.find((x) => x.id === id)!, { status: 'failed', lastError: error, calls });
    },
    async counts(key) {
      const out = { pending: 0, done: 0, failed: 0 };
      for (const r of rows.filter((x) => match(x, key))) out[r.status] += 1;
      return out;
    },
    async reset(key) {
      const hit = rows.filter((r) => match(r, key));
      for (const r of hit) Object.assign(r, { status: 'pending', attempts: 0 });
      return hit.length;
    },
  };
}

function memoryUsage(): DiscoveryUsageRepo {
  const calls = new Map<string, number>();
  return {
    async get(tenantId, source, day) {
      return calls.get(`${tenantId}:${source}:${day}`) ?? 0;
    },
    async add(tenantId, source, day, n) {
      const k = `${tenantId}:${source}:${day}`;
      calls.set(k, (calls.get(k) ?? 0) + n);
      return calls.get(k)!;
    },
  };
}

/** Each search spends up to 2 provider calls and finds nothing, so no repositories are touched. */
function countingSource(fail?: (input: DiscoverInput) => string | null) {
  let calls = 0;
  const seen: DiscoverInput[] = [];
  return {
    seen,
    providerCalls: () => calls,
    source: {
      async discover(input: DiscoverInput) {
        seen.push(input);
        calls += Math.min(input.maxPages ?? 1, 2);
        const error = fail?.(input);
        if (error) throw new Error(error);
        return [];
      },
    },
  };
}

const unusedRepo = new Proxy({}, { get: () => () => Promise.reject(new Error('not expected')) });

function deps(source: ReturnType<typeof countingSource>, targets = memoryTargets(), usage = memoryUsage()) {
  return {
    source: source.source,
    providerCalls: source.providerCalls,
    targets,
    usage,
    companies: unusedRepo as CompanyRepo,
    leads: unusedRepo as LeadRepo,
    logger: createSilentLogger(),
    now: () => new Date('2026-09-29T10:00:00Z'),
  };
}

describe('runCountryDiscovery', () => {
  it('searches every city × industry with the country region and language', async () => {
    const src = countingSource();
    const result = await runCountryDiscovery(deps(src), {
      tenantId: 't1',
      country: 'sg',
      source: 'google_places',
      maxCallsPerDay: 1000,
      cities: ['Tampines', 'Bedok'],
      industries: ['dentist', 'gym'],
    });
    expect(result).toMatchObject({ countryCode: 'SG', plannedTargets: 4, searches: 4, stoppedReason: 'completed' });
    expect(result.targets).toEqual({ pending: 0, done: 4, failed: 0 });
    expect(src.seen.map((s) => `${s.city}/${s.keyword}`)).toEqual([
      'Tampines/dentist',
      'Tampines/gym',
      'Bedok/dentist',
      'Bedok/gym',
    ]);
    expect(src.seen[0]).toMatchObject({ country: 'Singapore', regionCode: 'SG', languageCode: 'en', maxPages: 3 });
  });

  it('stops at the daily call budget and resumes the remaining targets on the next run', async () => {
    const targets = memoryTargets();
    const usage = memoryUsage();
    const input = {
      tenantId: 't1',
      country: 'Malaysia',
      source: 'google_places',
      maxCallsPerDay: 5,
      cities: ['Kuala Lumpur'],
      industries: ['dentist', 'gym', 'cafe', 'spa'],
    };
    const first = await runCountryDiscovery(deps(countingSource(), targets, usage), input);
    // 2 + 2 + 1 (last search capped to the single remaining call) = 5
    expect(first).toMatchObject({ searches: 3, calls: 5, callsToday: 5, stoppedReason: 'daily_budget_reached' });
    expect(first.targets).toEqual({ pending: 1, done: 3, failed: 0 });

    const src = countingSource();
    const nextDay = { ...deps(src, targets, usage), now: () => new Date('2026-09-30T10:00:00Z') };
    const second = await runCountryDiscovery(nextDay, input);
    expect(second).toMatchObject({ newTargets: 0, searches: 1, stoppedReason: 'completed' });
    expect(src.seen.map((s) => s.keyword)).toEqual(['spa']);
  });

  it('stops the whole run on a provider error that would repeat for every target', async () => {
    const src = countingSource(() => 'Google Places request denied: API key not valid');
    const result = await runCountryDiscovery(deps(src), {
      tenantId: 't1',
      country: 'JP',
      source: 'google_places',
      maxCallsPerDay: 1000,
      cities: ['Shinjuku'],
      industries: ['dentist', 'gym'],
    });
    expect(result).toMatchObject({ searches: 1, failedSearches: 1, stoppedReason: 'provider_error' });
    expect(src.seen[0]).toMatchObject({ city: 'Shinjuku, Tokyo', regionCode: 'JP', languageCode: 'ja' });
  });

  it('retries a transient failure up to maxAttempts, then leaves it failed', async () => {
    const src = countingSource((i) => (i.keyword === 'gym' ? 'socket hang up' : null));
    const result = await runCountryDiscovery(deps(src), {
      tenantId: 't1',
      country: 'Singapore',
      source: 'google_places',
      maxCallsPerDay: 1000,
      cities: ['Orchard'],
      industries: ['dentist', 'gym'],
      maxAttempts: 2,
    });
    expect(result.targets).toEqual({ pending: 0, done: 1, failed: 1 });
    expect(src.seen.filter((s) => s.keyword === 'gym')).toHaveLength(2);
  });

  it('stops between searches when aborted', async () => {
    const controller = new AbortController();
    const src = countingSource(() => {
      controller.abort();
      return null;
    });
    const result = await runCountryDiscovery(deps(src), {
      tenantId: 't1',
      country: 'Singapore',
      source: 'google_places',
      maxCallsPerDay: 1000,
      cities: ['Orchard'],
      industries: ['dentist', 'gym', 'spa'],
      signal: controller.signal,
    });
    expect(result).toMatchObject({ searches: 1, stoppedReason: 'aborted' });
    expect(result.targets).toEqual({ pending: 2, done: 1, failed: 0 });
  });

  it('rejects unsupported countries and unknown search areas', async () => {
    const run = (country: string, cities?: string[]) =>
      runCountryDiscovery(deps(countingSource()), {
        tenantId: 't1',
        country,
        source: 'google_places',
        maxCallsPerDay: 10,
        cities,
      });
    await expect(run('Atlantis')).rejects.toThrow(/Unsupported country/);
    await expect(run('Singapore', ['Nowhere'])).rejects.toThrow(/Unknown search area/);
  });
});

describe('country profiles', () => {
  it('covers Singapore, Malaysia and Japan with their search areas', () => {
    expect(resolveCountry('Singapore')?.cities).toContain('Tampines');
    expect(resolveCountry('my')?.cities[0]).toBe('Kuala Lumpur');
    const jp = resolveCountry('japan')!;
    expect(jp.cities).toContain('Shibuya, Tokyo');
    expect(jp.cities).toContain('Osaka');
    expect(jp.cities.length).toBeGreaterThan(700);
    expect(new Set(jp.cities.map((c) => c.toLowerCase())).size).toBe(jp.cities.length);
  });
});
