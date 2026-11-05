import { describe, expect, it } from 'vitest';
import { CRAWL_SETTINGS_LIMITS } from '@moncha/contracts';
import { crawlSettings } from '@/test/fixtures';
import { crawlCost, formFromSettings, NUMBER_FIELDS, syncFromServer, toPayload, validateForm, withCountry } from './form';

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
    const base = formFromSettings(crawlSettings());
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

  it('shows the searches and Places calls a run costs', () => {
    expect(crawlCost(20, 3)).toEqual({ searches: 1, maxCalls: 3 });
    expect(crawlCost(45, 2)).toEqual({ searches: 3, maxCalls: 6 });
  });
});
