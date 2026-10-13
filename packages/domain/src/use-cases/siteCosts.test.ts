import { describe, expect, it } from 'vitest';
import type { LlmPrice, LlmPriceBook, SiteCostRepo } from '../ports';
import { costWindowStart, getSiteCostSummary, priceForModel, storageUsdPerMonth } from './siteCosts';

const prices = new Map<string, LlmPrice>([
  ['openai/gpt-4o-mini', { input: 0.15e-6, output: 0.6e-6 }],
  ['openai/gpt-4o', { input: 2.5e-6, output: 10e-6 }],
  ['google/gemini-3.5-flash', { input: 1.5e-6, output: 9e-6 }],
]);

describe('priceForModel', () => {
  it('uses the exact model id first', () => {
    expect(priceForModel('openai/gpt-4o', prices)).toEqual({ input: 2.5e-6, output: 10e-6 });
  });

  it('matches a dated or tagged variant to the longest listed id', () => {
    expect(priceForModel('openai/gpt-4o-mini-2024-07-18', prices)?.input).toBe(0.15e-6);
    expect(priceForModel('google/gemini-3.5-flash:free', prices)?.output).toBe(9e-6);
  });

  it('returns null for an unknown model', () => {
    expect(priceForModel('acme/unknown', prices)).toBeNull();
  });
});

describe('costWindowStart', () => {
  it('starts at UTC midnight so the window holds whole days', () => {
    const now = new Date('2026-10-13T15:30:00.000Z');
    expect(costWindowStart(now, 1)?.toISOString()).toBe('2026-10-13T00:00:00.000Z');
    expect(costWindowStart(now, 7)?.toISOString()).toBe('2026-10-07T00:00:00.000Z');
    expect(costWindowStart(now, undefined)).toBeNull();
  });
});

describe('storageUsdPerMonth', () => {
  it('prices R2 storage per GB-month', () => {
    expect(storageUsdPerMonth(1024 ** 3)).toBeCloseTo(0.015);
    expect(storageUsdPerMonth(0)).toBe(0);
  });
});

describe('getSiteCostSummary', () => {
  it('passes only the prices of stored models and reports the unpriced ones', async () => {
    let seen: unknown;
    const costs = {
      models: async () => ['openai/gpt-4o-mini-2024-07-18', 'acme/unknown'],
      summary: async (filter: unknown) => {
        seen = filter;
        return {
          totals: {
            websites: 0,
            copies: 0,
            aiAudits: 0,
            copyTokens: { input: 0, output: 0 },
            auditTokens: { input: 0, output: 0 },
            copyCostUsd: 0,
            auditCostUsd: 0,
            exactCostUsd: 0,
            estimatedCostUsd: 0,
            storageBytes: 0,
          },
          byModel: [],
          byDay: [],
        };
      },
    } as unknown as SiteCostRepo;
    const book: LlmPriceBook = { list: async () => ({ source: 'openrouter', fetchedAt: null, prices }) };
    const result = await getSiteCostSummary(
      { costs, prices: book },
      { tenantId: 't1', days: 7, now: new Date('2026-10-13T12:00:00.000Z') },
    );
    expect(seen).toEqual({
      tenantId: 't1',
      since: new Date('2026-10-07T00:00:00.000Z'),
      prices: [{ model: 'openai/gpt-4o-mini-2024-07-18', input: 0.15e-6, output: 0.6e-6 }],
    });
    expect(result.pricing.unpriced).toEqual(['acme/unknown']);
    expect(result.days).toBe(7);
  });
});
