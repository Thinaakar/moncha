const numberFmt = new Intl.NumberFormat('en-US');

export function formatNumber(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : numberFmt.format(value);
}

export function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let n = value / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
];

export function formatRelative(value: string | Date | null | undefined, now = Date.now()) {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  const diff = Math.round((date.getTime() - now) / 1000);
  if (Math.abs(diff) < 10) return 'just now';
  for (const [unit, seconds] of UNITS) {
    if (Math.abs(diff) >= seconds || unit === 'second') return rtf.format(Math.round(diff / seconds), unit);
  }
  return '—';
}

export function formatDuration(start: string | null | undefined, end: string | null | undefined) {
  if (!start) return '—';
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  if (ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** `no_assistant_high_confidence` → `No assistant high confidence`. */
export function humanize(value: string | null | undefined) {
  if (!value) return '—';
  const text = value.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function initials(name: string | null | undefined, email: string) {
  const source = name?.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function websiteHref(domain: string | null | undefined, url?: string | null) {
  if (url) return url;
  return domain ? `https://${domain}` : null;
}
