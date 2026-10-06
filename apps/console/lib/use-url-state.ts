'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** Reads and writes list filters in the URL so views can be shared and survive reloads. */
export function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const get = useCallback((key: string, fallback = '') => params.get(key) ?? fallback, [params]);
  const getNumber = useCallback(
    (key: string, fallback: number) => {
      const n = Number(params.get(key));
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
    },
    [params],
  );

  const set = useCallback(
    (updates: Record<string, string | number | null | undefined>, opts: { resetPage?: boolean } = {}) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === '') next.delete(key);
        else next.set(key, String(value));
      }
      if (opts.resetPage) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return { get, getNumber, set };
}
