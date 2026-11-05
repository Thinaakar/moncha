'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CrawlPipelineSettingsView } from '@/lib/types';
import {
  formFromSettings,
  sameForm,
  syncFromServer,
  validateForm,
  withCountry,
  type CrawlSettingsForm,
  type FormState,
} from './form';

export function useCrawlSettingsForm(saved: CrawlPipelineSettingsView | undefined) {
  const [state, setState] = useState<FormState | null>(null);

  useEffect(() => {
    if (!saved) return;
    setState((prev) => {
      const next = syncFromServer(prev, formFromSettings(saved));
      return prev && sameForm(prev.values, next.values) && sameForm(prev.baseline, next.baseline) ? prev : next;
    });
  }, [saved]);

  const set = useCallback(<K extends keyof CrawlSettingsForm>(key: K, value: CrawlSettingsForm[K]) => {
    setState((prev) => (prev ? { ...prev, values: { ...prev.values, [key]: value } } : prev));
  }, []);

  const setCountry = useCallback((country: string) => {
    setState((prev) => (prev ? { ...prev, values: withCountry(prev.values, country) } : prev));
  }, []);

  const discard = useCallback(() => {
    setState((prev) => (prev ? { ...prev, values: prev.baseline } : prev));
  }, []);

  /** After a successful save: the server's copy becomes both the form and the baseline. */
  const markSaved = useCallback((settings: CrawlPipelineSettingsView) => {
    const next = formFromSettings(settings);
    setState({ values: next, baseline: next });
  }, []);

  const errors = useMemo(() => (state ? validateForm(state.values) : {}), [state]);
  const dirty = state ? !sameForm(state.values, state.baseline) : false;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return {
    values: state?.values ?? null,
    errors,
    valid: Object.keys(errors).length === 0,
    dirty,
    set,
    setCountry,
    discard,
    markSaved,
  };
}

export type CrawlSettingsFormApi = ReturnType<typeof useCrawlSettingsForm>;
