import { describe, expect, it } from 'vitest';
import { CRAWL_SETTINGS_LIMITS } from '@moncha/contracts';
import { crawlSettings } from '@/test/fixtures';
import {
  crawlCost,
  formFromSettings,
  NUMBER_FIELDS,
  runsLeftToday,
  syncFromServer,
  toPayload,
  validateForm,
  withCountry,
} from './form';

describe('crawl settings form', () => {
  it('round-trips saved settings into the API payload', () => {
    const form = formFromSettings(crawlSettings({ followUpSubject: '  Hi {companyName} ', followUpBodyTemplate: null }));
    expect(validateForm(form)).toEqual({});
    expect(toPayload(form)).toMatchObject({
      crawlBatchSize: 20,
      maxPagesPerSearch: 3,
      dailyWebsiteCreationLimit: 5,
      followUpDelayDays: 3,
      followUpSubject: 'Hi {companyName}',
      followUpBodyTemplate: null,
      targetCountry: 'SG',
      targetCities: ['Tampines'],
    });
  });

  it('flags every numeric field outside the shared limits, empty or fractional', () => {
    // A daily limit at its maximum, so the reserved-runs maximum is not also more than the daily limit.
    const base = { ...formFromSettings(crawlSettings()), maxDailyCrawlRuns: String(CRAWL_SETTINGS_LIMITS.maxDailyCrawlRuns.max) };
    for (const field of NUMBER_FIELDS) {
      const { min, max } = CRAWL_SETTINGS_LIMITS[field];
      expect(validateForm({ ...base, [field]: String(max + 1) })[field]).toBe(`Must be between ${min} and ${max}`);
      expect(validateForm({ ...base, [field]: String(min - 1) })[field]).toBe(`Must be between ${min} and ${max}`);
      expect(validateForm({ ...base, [field]: '' })[field]).toBe('Required');
      expect(validateForm({ ...base, [field]: '2.5' })[field]).toBe('Enter a whole number');
      expect(validateForm({ ...base, [field]: String(max) })[field]).toBeUndefined();
    }
  });

  it('clamps legacy saved values into the new ranges', () => {
    const form = formFromSettings(crawlSettings({ maxPagesPerSearch: 20, followUpDelayDays: 0 }));
    expect(form.maxPagesPerSearch).toBe('3');
    expect(form.followUpDelayDays).toBe('1');
  });

  it('clears the cities when the country changes', () => {
    const form = formFromSettings(crawlSettings({ targetCities: ['Tampines'] }));
    expect(withCountry(form, 'SG')).toBe(form);
    expect(withCountry(form, 'MY')).toMatchObject({ targetCountry: 'MY', targetCities: [] });
  });

  it('follows new saved settings only while there are no unsaved edits', () => {
    const first = formFromSettings(crawlSettings());
    const fromServer = formFromSettings(crawlSettings({ dailyWebsiteCreationLimit: 9 }));
    const clean = syncFromServer({ values: first, baseline: first }, fromServer);
    expect(clean.values.dailyWebsiteCreationLimit).toBe('9');

    const edited = { ...first, crawlBatchSize: '45' };
    const kept = syncFromServer({ values: edited, baseline: first }, fromServer);
    expect(kept.values.crawlBatchSize).toBe('45');
    expect(kept.baseline.dailyWebsiteCreationLimit).toBe('9');
    expect(syncFromServer(null, fromServer).values).toBe(fromServer);
  });

  it('sends the crawl mode and the runs reserved for schedules', () => {
    const form = formFromSettings(crawlSettings({ crawlMode: 'scheduled_only', scheduleReservedRuns: 3 }));
    expect(toPayload(form)).toMatchObject({ crawlMode: 'scheduled_only', scheduleReservedRuns: 3 });
    // Older backends without the fields default to both triggers and no reservation.
    const legacy = formFromSettings({ ...crawlSettings(), crawlMode: undefined, scheduleReservedRuns: undefined });
    expect(legacy).toMatchObject({ crawlMode: 'both', scheduleReservedRuns: '0' });
  });

  it('does not allow more reserved runs than crawl runs per day', () => {
    const form = formFromSettings(crawlSettings({ maxDailyCrawlRuns: 10 }));
    expect(validateForm({ ...form, scheduleReservedRuns: '10' }).scheduleReservedRuns).toBeUndefined();
    expect(validateForm({ ...form, scheduleReservedRuns: '11' }).scheduleReservedRuns).toBe(
      'Cannot be more than the crawl runs per day',
    );
    expect(validateForm({ ...form, maxDailyCrawlRuns: '4', scheduleReservedRuns: '5' }).scheduleReservedRuns).toBeTruthy();
  });

  it('works out the runs left for schedules and for auto-recrawl / Run crawl now', () => {
    const settings = { maxDailyCrawlRuns: 10, scheduleReservedRuns: 4 };
    expect(runsLeftToday(settings, { runs: 0, scheduledRuns: 0 })).toEqual({ schedules: 10, unreserved: 6 });
    expect(runsLeftToday(settings, { runs: 6, scheduledRuns: 0 })).toEqual({ schedules: 4, unreserved: 0 });
    expect(runsLeftToday(settings, { runs: 7, scheduledRuns: 3 })).toEqual({ schedules: 3, unreserved: 2 });
    expect(runsLeftToday(settings, { runs: 10, scheduledRuns: 4 })).toEqual({ schedules: 0, unreserved: 0 });
  });

  it('shows the searches and Places calls a run costs', () => {
    expect(crawlCost(20, 3)).toEqual({ searches: 1, maxCalls: 3 });
    expect(crawlCost(45, 2)).toEqual({ searches: 3, maxCalls: 6 });
  });
});
