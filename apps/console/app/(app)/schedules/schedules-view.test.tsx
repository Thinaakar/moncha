import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { renderWithClient } from '@/test/render';
import { crawlSettings, discoveryOptions, pipelineStatus, progress } from '@/test/fixtures';
import type { CrawlPipelineSettingsView, ScheduleSkip } from '@/lib/types';

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

function backend(
  active: boolean,
  opts: {
    settings?: Partial<CrawlPipelineSettingsView>;
    skips?: ScheduleSkip[];
    usage?: { crawlsRunToday: number; scheduledRunsToday: number };
    groups?: typeof scheduleGroups;
  } = {},
) {
  apiMock.mockImplementation(async (path: string) => {
    if (path === 'schedules') return opts.groups ?? scheduleGroups;
    if (path === 'schedules/runs') return { runs: [] };
    if (path === 'schedules/skips') return { skips: opts.skips ?? [] };
    if (path === 'site-automation/crawls') return { items: [] };
    if (path === 'crawl-settings')
      return pipelineStatus(
        crawlSettings({
          active,
          targetCountry: 'SG',
          targetCities: ['Tampines', 'Bedok'],
          maxDailyCrawlRuns: 7,
          ...opts.settings,
        }),
        progress(opts.usage ?? {}),
      );
    if (path === 'discovery/options') return discoveryOptions;
    if (path === 'discovery/industries') return { industries: [] };
    throw new Error(`unexpected api call ${path}`);
  });
}

/** A Singapore slot later today, for the today's-plan checks. */
const todayGroups = {
  countries: [
    {
      countryCode: 'SG',
      country: 'Singapore',
      timesPerDay: 1,
      schedules: [
        {
          id: 's9',
          countryCode: 'SG',
          country: 'Singapore',
          time: '23:59',
          timezone: 'Asia/Singapore',
          nextRunAt: new Date(Date.now() + 60_000).toISOString(),
          nextRunDay: 'today',
          lastRunAt: null,
          industries: ['dentist', 'gym'],
        },
      ],
    },
  ],
};

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
    backend(true, { settings: { scheduleReservedRuns: 2 }, usage: { crawlsRunToday: 3, scheduledRunsToday: 1 } });
    renderWithClient(<SchedulesView />);
    expect(await screen.findByText('Engine on')).toBeTruthy();
    expect(screen.getByText('Crawl & Pipeline Settings control scheduled crawls')).toBeTruthy();
    expect(await screen.findByText(/7 per UTC day, every trigger counted, 2 reserved for schedules/)).toBeTruthy();
    expect(screen.getByText(/4 left today for schedules/)).toBeTruthy();
    expect(screen.getByText(/the 2 target cities/)).toBeTruthy();
    expect(screen.getByText(/for\s+Singapore/)).toBeTruthy();
    expect(screen.queryByText('Paused')).toBeNull();
  });

  it('warns that schedules are skipped while the crawl mode is Auto-recrawl only', async () => {
    backend(true, { settings: { crawlMode: 'auto_only' } });
    renderWithClient(<SchedulesView />);
    expect(await screen.findByText('Crawl mode is Auto-recrawl only: scheduled crawls are skipped')).toBeTruthy();
  });

  it("shows today's plan for each slot with the reason it will be skipped", async () => {
    backend(false, { groups: todayGroups });
    renderWithClient(<SchedulesView />);
    const plan = await screen.findByRole('list', { name: "Today's plan" });
    expect(await within(plan).findByText('Will be skipped')).toBeTruthy();
    expect(within(plan).getByText('engine paused')).toBeTruthy();
  });

  it('predicts the daily run limit once no run is left for schedules', async () => {
    backend(true, { groups: todayGroups, usage: { crawlsRunToday: 7, scheduledRunsToday: 2 } });
    renderWithClient(<SchedulesView />);
    const plan = await screen.findByRole('list', { name: "Today's plan" });
    expect(await within(plan).findByText('daily run limit reached')).toBeTruthy();
  });

  it('lists skipped slots in the run history with their reason', async () => {
    backend(true, {
      skips: [
        {
          id: 'k1',
          scheduleId: 's1',
          day: '2026-11-04',
          countryCode: 'MY',
          country: 'Malaysia',
          time: '10:00',
          timezone: 'Asia/Kuala_Lumpur',
          scheduledFor: '2026-11-04T02:00:00.000Z',
          reason: 'daily_run_limit',
          detail: null,
          createdAt: '2026-11-04T02:00:05.000Z',
        },
      ],
    });
    renderWithClient(<SchedulesView />);
    const reason = await screen.findByText('daily run limit reached');
    const row = reason.closest('tr')!;
    expect(within(row).getByText('Skipped')).toBeTruthy();
    expect(within(row).getByText('2026-11-04')).toBeTruthy();
    expect(within(row).getByText('Malaysia')).toBeTruthy();
  });

  it('labels each schedule with the industries it crawls', async () => {
    backend(true);
    renderWithClient(<SchedulesView />);
    expect(await screen.findByText('Crawl settings industries')).toBeTruthy();
    cleanup();
    backend(true, { groups: todayGroups });
    renderWithClient(<SchedulesView />);
    expect(await screen.findByText('2 custom industries')).toBeTruthy();
  });
});
