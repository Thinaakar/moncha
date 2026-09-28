const lastRequestAt = new Map<string, number>();

/**
 * In-process per-host rate limit (FR-027): at most 1 request/sec per host.
 * Concurrent callers for the same host queue behind the delay.
 */
export async function waitForHostSlot(
  host: string,
  minIntervalMs = 1_000,
): Promise<void> {
  const key = host.toLowerCase();
  const now = Date.now();
  const last = lastRequestAt.get(key) ?? 0;
  const wait = Math.max(0, minIntervalMs - (now - last));
  // Reserve the slot immediately so concurrent callers stagger.
  lastRequestAt.set(key, now + wait);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
}

/** Test helper. */
export function resetHostRateLimiter(): void {
  lastRequestAt.clear();
}
