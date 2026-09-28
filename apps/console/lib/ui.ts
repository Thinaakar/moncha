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
