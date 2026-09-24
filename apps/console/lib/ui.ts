export function statusChip(status: string) {
  const map: Record<string, string> = {
    discovered: 'chip chip-blue',
    review: 'chip chip-amber',
    rejected: 'chip chip-red',
    pending: 'chip chip-amber',
    running: 'chip chip-blue',
    done: 'chip chip-green',
    failed: 'chip chip-red',
    reachable: 'chip chip-green',
    unreachable: 'chip chip-red',
    unchecked: 'chip chip-gray',
  };
  return map[status] || 'chip chip-gray';
}

export function websiteLabel(reachable?: boolean | null, hasWebsite?: boolean) {
  if (!hasWebsite) return 'unchecked';
  return reachable ? 'reachable' : 'unreachable';
}
