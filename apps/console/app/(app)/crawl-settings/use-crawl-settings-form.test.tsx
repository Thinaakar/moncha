import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { crawlSettings } from '@/test/fixtures';
import type { CrawlPipelineSettingsView } from '@/lib/types';
import { useCrawlSettingsForm } from './use-crawl-settings-form';

describe('useCrawlSettingsForm', () => {
  it('clears cities on a country change and reports the form as dirty', () => {
    const { result } = renderHook(() => useCrawlSettingsForm(crawlSettings({ targetCities: ['Tampines'] })));
    expect(result.current.dirty).toBe(false);
    act(() => result.current.setCountry('MY'));
    expect(result.current.values).toMatchObject({ targetCountry: 'MY', targetCities: [] });
    expect(result.current.dirty).toBe(true);
  });

  it('keeps edits when the saved settings refresh, and resets after markSaved', () => {
    const { result, rerender } = renderHook(({ saved }: { saved: CrawlPipelineSettingsView }) => useCrawlSettingsForm(saved), {
      initialProps: { saved: crawlSettings() },
    });
    act(() => result.current.set('crawlBatchSize', '80'));
    rerender({ saved: crawlSettings({ active: false, updatedAt: '2026-11-05T05:00:00.000Z' }) });
    expect(result.current.values?.crawlBatchSize).toBe('80');
    expect(result.current.dirty).toBe(true);

    act(() => result.current.markSaved(crawlSettings({ crawlBatchSize: 80 })));
    expect(result.current.dirty).toBe(false);
    expect(result.current.values?.crawlBatchSize).toBe('80');
  });

  it('exposes validation errors and validity', () => {
    const { result } = renderHook(() => useCrawlSettingsForm(crawlSettings()));
    act(() => result.current.set('followUpDelayDays', '45'));
    expect(result.current.valid).toBe(false);
    expect(result.current.errors.followUpDelayDays).toBe('Must be between 1 and 30');
  });
});
