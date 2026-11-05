import { CRAWL_SETTINGS_LIMITS, type CrawlModeView, type CrawlSettingsNumberField } from '@moncha/contracts';
import type { CrawlPipelineSettingsUpdate, CrawlPipelineSettingsView } from '@/lib/types';

/** Numeric settings edited as text, so a field can be cleared while typing. The hour is a select, not text. */
export const NUMBER_FIELDS = [
  'crawlBatchSize',
  'maxPagesPerSearch',
  'dailyWebsiteCreationLimit',
  'dailyCustomerReachLimit',
  'minQueueBuffer',
  'maxDailyCrawlRuns',
  'scheduleReservedRuns',
  'followUpDelayDays',
] as const satisfies readonly CrawlSettingsNumberField[];

export type NumberField = (typeof NUMBER_FIELDS)[number];

export const CRAWL_MODE_OPTIONS: Array<{ value: CrawlModeView; label: string; description: string }> = [
  {
    value: 'both',
    label: 'Schedules and auto-recrawl',
    description: 'Target region schedules run at their times, and auto-recrawl fills the queue in between.',
  },
  {
    value: 'scheduled_only',
    label: 'Scheduled only',
    description: 'Only Target region schedules start crawls. Auto-recrawl stays off. Most predictable cost.',
  },
  {
    value: 'auto_only',
    label: 'Auto-recrawl only',
    description: 'Crawls start when the lead queue runs low. Due schedules are skipped and moved to their next time.',
  },
];

/** Everything Save sends. The engine switch saves on its own and is not part of the form. */
export type CrawlSettingsForm = Record<NumberField, string> & {
  crawlMode: CrawlModeView;
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
    scheduleReservedRuns: String(s.scheduleReservedRuns ?? 0),
    followUpDelayDays: String(Math.max(CRAWL_SETTINGS_LIMITS.followUpDelayDays.min, s.followUpDelayDays)),
    crawlMode: s.crawlMode ?? 'both',
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
  if (!errors.scheduleReservedRuns && !errors.maxDailyCrawlRuns) {
    if (Number(form.scheduleReservedRuns) > Number(form.maxDailyCrawlRuns)) {
      errors.scheduleReservedRuns = 'Cannot be more than the crawl runs per day';
    }
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
    scheduleReservedRuns: num('scheduleReservedRuns'),
    followUpDelayDays: num('followUpDelayDays'),
    crawlMode: form.crawlMode,
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

/**
 * Runs each trigger may still start today, as the backend claims them: schedules may use every run of the limit,
 * auto-recrawl and Run crawl now only the unreserved ones.
 */
export function runsLeftToday(
  settings: Pick<CrawlPipelineSettingsView, 'maxDailyCrawlRuns' | 'scheduleReservedRuns'>,
  usage: { runs: number; scheduledRuns: number },
): { schedules: number; unreserved: number } {
  const max = settings.maxDailyCrawlRuns;
  const reserved = Math.min(max, Math.max(0, settings.scheduleReservedRuns ?? 0));
  const total = Math.max(0, max - usage.runs);
  return {
    schedules: total,
    unreserved: Math.max(0, Math.min(total, max - reserved - (usage.runs - usage.scheduledRuns))),
  };
}

/** Searches and the most Places calls one crawl run makes (each search is up to `maxPages` result pages). */
export function crawlCost(batchSize: number, maxPages: number): { searches: number; maxCalls: number } {
  const searches = Math.max(1, Math.ceil((batchSize || 20) / 20));
  return { searches, maxCalls: searches * Math.max(1, Math.min(3, maxPages || 3)) };
}
