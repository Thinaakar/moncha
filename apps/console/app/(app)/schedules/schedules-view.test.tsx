import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithClient } from '@/test/render';
import { crawlSettings, discoveryOptions, pipelineStatus } from '@/test/fixtures';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), api: apiMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/app/user-context', () => ({ useCanEdit: () => true }));

import { SchedulesView } from './schedules-view';

const scheduleGroups = {
  countries: [
    {
      countryCode: 'MY',
      country: 'Malaysia',
      timesPerDay: 1,
      schedules: [
        {
          id: 's1',
          countryCode: 'MY',
          country: 'Malaysia',
          time: '10:00',
          timezone: 'Asia/Kuala_Lumpur',
          nextRunAt: '2026-11-06T02:00:00.000Z',
          nextRunDay: 'tomorrow',
          lastRunAt: null,
        },
      ],
    },
  ],
};

function backend(active: boolean) {
  apiMock.mockImplementation(async (path: string) => {
    if (path === 'schedules') return scheduleGroups;
    if (path === 'schedules/runs') return { runs: [] };
    if (path === 'site-automation/crawls') return { items: [] };
    if (path === 'crawl-settings')
      return pipelineStatus(crawlSettings({ active, targetCountry: 'SG', targetCities: ['Tampines', 'Bedok'], maxDailyCrawlRuns: 7 }));
    if (path === 'discovery/options') return discoveryOptions;
    if (path === 'discovery/industries') return { industries: [] };
    throw new Error(`unexpected api call ${path}`);
  });
}

beforeEach(() => {
  apiMock.mockReset();
});

describe('Target region schedule page', () => {
  it('shows the engine as paused, on the page and on each country', async () => {
    backend(false);
    renderWithClient(<SchedulesView />);
    expect(await screen.findByText('Engine paused')).toBeTruthy();
    expect(await screen.findByText('Engine paused: scheduled crawls are skipped')).toBeTruthy();
    expect(await screen.findByText('Paused')).toBeTruthy();
    expect(screen.getByText('Next slot (skipped while paused)')).toBeTruthy();
  });

  it('explains how the crawl settings shape each scheduled run', async () => {
    backend(true);
    renderWithClient(<SchedulesView />);
    expect(await screen.findByText('Engine on')).toBeTruthy();
    expect(screen.getByText('Crawl & Pipeline Settings control scheduled crawls')).toBeTruthy();
    expect(screen.getByText(/Max Daily Crawl Runs \(7, UTC day/)).toBeTruthy();
    expect(screen.getByText(/the 2 target cities/)).toBeTruthy();
    expect(screen.getByText(/for\s+Singapore/)).toBeTruthy();
    expect(screen.queryByText('Paused')).toBeNull();
  });
});
