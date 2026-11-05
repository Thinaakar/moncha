/** Calendar date the wall clock of `timeZone` shows at `at`. */
function localDate(at: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

export const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

/** "Singapore time" for Asia/Singapore, "UTC" for UTC. */
export function zoneLabel(timeZone: string): string {
  if (timeZone === 'UTC') return 'UTC';
  return `${timeZone.split('/').pop()!.replace(/_/g, ' ')} time`;
}

/**
 * When a follow-up for an email sent at `sentAt` goes out, as the worker computes it (calculateFollowUpDueDate):
 * days counted on the local calendar of `timeZone` (at least one), weekends skipped in business-day mode.
 */
export function followUpPreview(
  sentAt: Date,
  delayDays: number,
  mode: 'business_days' | 'calendar_days',
  hour: number,
  timeZone: string,
): string {
  const start = localDate(sentAt, timeZone);
  const day = new Date(Date.UTC(start.year, start.month - 1, start.day));
  const days = Math.max(1, Number.isFinite(delayDays) ? delayDays : 1);
  if (mode === 'calendar_days') {
    day.setUTCDate(day.getUTCDate() + days);
  } else {
    let added = 0;
    while (added < days) {
      day.setUTCDate(day.getUTCDate() + 1);
      if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) added += 1;
    }
  }
  const date = day.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  return `${date}, ${hourLabel(hour)} ${zoneLabel(timeZone)}`;
}
