import { CRAWL_SETTINGS_LIMITS, type CrawlSettingsNumberField } from '@moncha/contracts';
import type { CrawlPipelineSettingsUpdate, CrawlPipelineSettingsView } from '@/lib/types';

/** Numeric settings edited as text, so a field can be cleared while typing. The hour is a select, not text. */
export const NUMBER_FIELDS = [
  'crawlBatchSize',
  'maxPagesPerSearch',
  'dailyWebsiteCreationLimit',
  'dailyCustomerReachLimit',
  'minQueueBuffer',
  'maxDailyCrawlRuns',
  'followUpDelayDays',
] as const satisfies readonly CrawlSettingsNumberField[];

export type NumberField = (typeof NUMBER_FIELDS)[number];

/** Everything Save sends. The engine switch saves on its own and is not part of the form. */
export type CrawlSettingsForm = Record<NumberField, string> & {
  autoRecrawlEnabled: boolean;
  targetCountry: string;
  targetCities: string[];
  targetIndustries: string[];
  followUpEnabled: boolean;
  followUpMode: 'business_days' | 'calendar_days';
  followUpPreferredHour: number;
  followUpSubject: string;
  followUpBodyTemplate: string;
};

export type FormErrors = Partial<Record<NumberField, string>>;

export function formFromSettings(s: CrawlPipelineSettingsView): CrawlSettingsForm {
  return {
    crawlBatchSize: String(s.crawlBatchSize),
    maxPagesPerSearch: String(Math.min(CRAWL_SETTINGS_LIMITS.maxPagesPerSearch.max, s.maxPagesPerSearch)),
    dailyWebsiteCreationLimit: String(s.dailyWebsiteCreationLimit),
    dailyCustomerReachLimit: String(s.dailyCustomerReachLimit),
    minQueueBuffer: String(s.minQueueBuffer),
    maxDailyCrawlRuns: String(s.maxDailyCrawlRuns),
    followUpDelayDays: String(Math.max(CRAWL_SETTINGS_LIMITS.followUpDelayDays.min, s.followUpDelayDays)),
    autoRecrawlEnabled: s.autoRecrawlEnabled,
    targetCountry: s.targetCountry || 'SG',
    targetCities: s.targetCities ?? [],
    targetIndustries: s.targetIndustries ?? [],
    followUpEnabled: s.followUpEnabled,
    followUpMode: s.followUpMode || 'business_days',
    followUpPreferredHour: s.followUpPreferredHour ?? 10,
    followUpSubject: s.followUpSubject ?? '',
    followUpBodyTemplate: s.followUpBodyTemplate ?? '',
  };
}

export function sameForm(a: CrawlSettingsForm, b: CrawlSettingsForm): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Same checks as the API (CRAWL_SETTINGS_LIMITS), so an invalid value never reaches Save. */
export function validateForm(form: CrawlSettingsForm): FormErrors {
  const errors: FormErrors = {};
  for (const field of NUMBER_FIELDS) {
    const { min, max } = CRAWL_SETTINGS_LIMITS[field];
    const raw = form[field].trim();
    if (!/^-?\d+$/.test(raw)) {
      errors[field] = raw ? 'Enter a whole number' : 'Required';
      continue;
    }
    const n = Number(raw);
    if (n < min || n > max) errors[field] = `Must be between ${min} and ${max}`;
  }
  return errors;
}

export function toPayload(form: CrawlSettingsForm): CrawlPipelineSettingsUpdate {
  const num = (field: NumberField) => Number(form[field].trim());
  return {
    crawlBatchSize: num('crawlBatchSize'),
    maxPagesPerSearch: num('maxPagesPerSearch'),
    dailyWebsiteCreationLimit: num('dailyWebsiteCreationLimit'),
    dailyCustomerReachLimit: num('dailyCustomerReachLimit'),
    minQueueBuffer: num('minQueueBuffer'),
    maxDailyCrawlRuns: num('maxDailyCrawlRuns'),
    followUpDelayDays: num('followUpDelayDays'),
    autoRecrawlEnabled: form.autoRecrawlEnabled,
    targetCountry: form.targetCountry,
    targetCities: form.targetCities,
    targetIndustries: form.targetIndustries,
    followUpEnabled: form.followUpEnabled,
    followUpMode: form.followUpMode,
    followUpPreferredHour: form.followUpPreferredHour,
    followUpSubject: form.followUpSubject.trim() || null,
    followUpBodyTemplate: form.followUpBodyTemplate.trim() || null,
  };
}

/** Changing the country clears the cities: they belong to the old country and the API rejects them. */
export function withCountry(form: CrawlSettingsForm, country: string): CrawlSettingsForm {
  return country === form.targetCountry ? form : { ...form, targetCountry: country, targetCities: [] };
}

export type FormState = { values: CrawlSettingsForm; baseline: CrawlSettingsForm };

/**
 * New saved settings (first load, a save, the engine switch, another editor) become the baseline. The form follows
 * them only when it has no unsaved edits, so a refresh never overwrites what the user is typing.
 */
export function syncFromServer(state: FormState | null, saved: CrawlSettingsForm): FormState {
  if (!state || sameForm(state.values, state.baseline)) return { values: saved, baseline: saved };
  return { values: state.values, baseline: saved };
}

/** Searches and the most Places calls one crawl run makes (each search is up to `maxPages` result pages). */
export function crawlCost(batchSize: number, maxPages: number): { searches: number; maxCalls: number } {
  const searches = Math.max(1, Math.ceil((batchSize || 20) / 20));
  return { searches, maxCalls: searches * Math.max(1, Math.min(3, maxPages || 3)) };
}
