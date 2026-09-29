export const DEFAULT_SCHEDULE_TIMEZONE = 'Asia/Kuala_Lumpur';

export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function localParts(at: Date, timezone: string): LocalParts {
  let fmt = formatters.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timezone, fmt);
  }
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(at)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as LocalParts;
}

/** Milliseconds the zone is ahead of UTC at `at`. */
function zoneOffset(at: Date, timezone: string): number {
  const p = localParts(at, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant when the zone's wall clock shows this date and time. */
function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - zoneOffset(new Date(wall), timezone);
  const second = wall - zoneOffset(new Date(first), timezone);
  return new Date(second);
}

/** Calendar date in the zone, "YYYY-MM-DD". */
export function localDate(at: Date, timezone: string): string {
  const p = localParts(at, timezone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Wall-clock time in the zone, "HH:mm". */
export function localTime(at: Date, timezone: string): string {
  const p = localParts(at, timezone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** First instant strictly after `after` when the zone's clock reads `timeOfDay` ("HH:mm"). */
export function computeNextRun(timeOfDay: string, timezone: string, after: Date): Date {
  if (!TIME_OF_DAY.test(timeOfDay)) throw new Error(`Invalid time "${timeOfDay}", expected HH:mm`);
  const [hour, minute] = timeOfDay.split(':').map(Number) as [number, number];
  const today = localParts(after, timezone);
  for (let addDays = 0; addDays < 3; addDays += 1) {
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + addDays));
    const candidate = zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, minute, timezone);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  throw new Error(`Could not compute next run for ${timeOfDay} ${timezone}`);
}

/** "today" / "tomorrow" relative to `now` in the zone, otherwise the local date. */
export function relativeDay(at: Date, timezone: string, now: Date): string {
  const target = localDate(at, timezone);
  if (target === localDate(now, timezone)) return 'today';
  if (target === localDate(new Date(now.getTime() + 86_400_000), timezone)) return 'tomorrow';
  return target;
}
