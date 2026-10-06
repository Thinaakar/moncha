export function statusChip(status: string) {
  const key = status.toLowerCase();
  const map: Record<string, string> = {
    pending_audit: 'chip chip-amber',
    qualified: 'chip chip-green',
    has_assistant: 'chip chip-red',
    no_website: 'chip chip-gray',
    needs_review: 'chip chip-amber',
    inactive: 'chip chip-gray',
    pending: 'chip chip-amber',
    running: 'chip chip-blue',
    done: 'chip chip-green',
    failed: 'chip chip-red',
    unchecked: 'chip chip-gray',
    active: 'chip chip-green',
    parked: 'chip chip-amber',
    inaccessible: 'chip chip-red',
    missing: 'chip chip-gray',
  };
  return map[key] || 'chip chip-gray';
}

export function websiteLabel(status?: string | null, hasWebsite?: boolean) {
  if (!hasWebsite) return 'MISSING';
  return status || 'UNCHECKED';
}

export function formatStatus(status: string) {
  const text = status.replaceAll('_', ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const SOURCE_LABELS: Record<string, string> = {
  google_places: 'Google Places',
  yelp: 'Yelp',
  foursquare: 'Foursquare',
  search: 'Search',
  csv: 'CSV import',
  csv_import: 'CSV import',
  manual: 'Manual entry',
};

export function sourceLabel(source: string) {
  return SOURCE_LABELS[source] || formatStatus(source);
}

const JOB_TYPE_LABELS: Record<string, string> = {
  places_discovery: 'Discovery',
  csv_import: 'CSV import',
  website_audit: 'Website check',
};

export function jobTypeLabel(type: string) {
  return JOB_TYPE_LABELS[type] || formatStatus(type);
}

export function failedJobAction(type: string) {
  if (type === 'places_discovery') return { href: '/discover', label: 'Run again' };
  if (type === 'csv_import') return { href: '/import', label: 'Import again' };
  return undefined;
}

export function locationText(city?: string | null, country?: string | null) {
  return [city, country].filter(Boolean).join(', ') || '—';
}

const COUNTRY_CODES: Record<string, string> = {
  singapore: 'SG',
  malaysia: 'MY',
  japan: 'JP',
};

export function countryCode(country?: string | null) {
  if (!country) return null;
  return COUNTRY_CODES[country.trim().toLowerCase()] || country.trim().slice(0, 2).toUpperCase();
}

export function timeAgo(iso: string, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (Number.isNaN(seconds)) return '—';
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
