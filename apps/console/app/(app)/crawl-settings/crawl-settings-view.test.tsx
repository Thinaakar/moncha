import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import { renderWithClient } from '@/test/render';
import { crawlSettings, discoveryOptions, gate, pipelineStatus } from '@/test/fixtures';
import type { CrawlPipelineSettingsView } from '@/lib/types';

const apiMock = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), api: apiMock }));
vi.mock('sonner', () => ({ toast }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/app/user-context', () => ({ useCanEdit: () => true }));
vi.mock('@/components/app/job-tracker', () => ({ JobTracker: () => null }));

import { CrawlSettingsView } from './crawl-settings-view';

type Init = { method?: string; body?: unknown } | undefined;

function backend(opts: {
  settings?: CrawlPipelineSettingsView;
  load?: () => Promise<unknown>;
  put?: (body: Record<string, unknown>) => Promise<unknown>;
  gateResult?: () => Promise<unknown>;
} = {}) {
  let saved = opts.settings ?? crawlSettings();
  const puts: Array<Record<string, unknown>> = [];
  apiMock.mockImplementation(async (path: string, init: Init) => {
    if (path === 'crawl-settings' && init?.method === 'PUT') {
      const body = init.body as Record<string, unknown>;
      puts.push(body);
      if (opts.put) return opts.put(body);
      saved = { ...saved, ...(body as Partial<CrawlPipelineSettingsView>), updatedAt: new Date().toISOString() };
      return { settings: saved };
    }
    if (path === 'crawl-settings') return opts.load ? opts.load() : pipelineStatus(saved);
    if (path === 'discovery/options') return discoveryOptions;
    if (path === 'cold-emails/gate') return opts.gateResult ? opts.gateResult() : gate();
    throw new Error(`unexpected api call ${init?.method ?? 'GET'} ${path}`);
  });
  return { puts };
}

const saveButtons = () => screen.getAllByRole('button', { name: 'Save changes' });

beforeEach(() => {
  apiMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe('Crawl & Pipeline Settings page', () => {
  it('shows a loading state, then the saved settings', async () => {
    backend();
    renderWithClient(<CrawlSettingsView />);
    expect(screen.getByLabelText('Loading crawl settings')).toBeTruthy();
    const batch = (await screen.findByLabelText('Batch size')) as HTMLInputElement;
    expect(batch.value).toBe('20');
    expect((screen.getByLabelText('Website copies') as HTMLInputElement).value).toBe('5');
    expect(saveButtons()[0]!.hasAttribute('disabled')).toBe(true);
  });

  it('shows an error with a retry instead of editable defaults when loading fails', async () => {
    let fail = true;
    backend({
      load: async () => {
        if (fail) throw new ApiError(500, 'internal_error', 'Internal server error');
        return pipelineStatus();
      },
    });
    renderWithClient(<CrawlSettingsView />);
    expect(await screen.findByText('Could not load crawl settings')).toBeTruthy();
    expect(screen.queryByLabelText('Batch size')).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByLabelText('Batch size')).toBeTruthy();
  });

  it('tracks unsaved changes, blocks the manual crawl, and saves the edited values', async () => {
    const { puts } = backend();
    renderWithClient(<CrawlSettingsView />);
    const batch = await screen.findByLabelText('Batch size');
    fireEvent.change(batch, { target: { value: '45' } });

    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(screen.getByRole('button', { name: /run crawl now/i }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/makes 3 searches, at most 9 Google Places calls/)).toBeTruthy();

    fireEvent.click(saveButtons()[0]!);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ crawlBatchSize: 45, targetCountry: 'SG', targetCities: ['Tampines'] });
    expect(puts[0]).not.toHaveProperty('active');
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('Settings saved');
  });

  it('blocks saving a value outside the limits and explains why', async () => {
    const { puts } = backend();
    renderWithClient(<CrawlSettingsView />);
    fireEvent.change(await screen.findByLabelText('Crawl runs'), { target: { value: '101' } });
    expect(screen.getByText('Must be between 1 and 100')).toBeTruthy();
    expect(screen.getByText('Fix the highlighted fields before saving.')).toBeTruthy();
    for (const b of saveButtons()) expect(b.hasAttribute('disabled')).toBe(true);
    expect(puts).toHaveLength(0);
  });

  it('discards edits back to the saved values', async () => {
    backend();
    renderWithClient(<CrawlSettingsView />);
    const copies = (await screen.findByLabelText('Website copies')) as HTMLInputElement;
    fireEvent.change(copies, { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(copies.value).toBe('5');
    expect(screen.queryByText('Unsaved changes')).toBeNull();
  });

  it('puts the engine switch back and reports the error when saving it fails', async () => {
    backend({
      settings: crawlSettings({ active: false }),
      put: async () => {
        throw new ApiError(500, 'internal_error', 'Database down');
      },
    });
    renderWithClient(<CrawlSettingsView />);
    const engine = await screen.findByRole('switch', { name: 'Automation engine' });
    expect(engine.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(engine);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not change the engine', { description: 'Database down' }));
    expect(screen.getByRole('switch', { name: 'Automation engine' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Engine paused')).toBeTruthy();
  });

  it('keeps unsaved edits when the engine switch saves', async () => {
    const { puts } = backend({ settings: crawlSettings({ active: false }) });
    renderWithClient(<CrawlSettingsView />);
    const batch = (await screen.findByLabelText('Batch size')) as HTMLInputElement;
    fireEvent.change(batch, { target: { value: '60' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Automation engine' }));
    await waitFor(() => expect(puts).toEqual([{ active: true }]));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Automation engine' }).getAttribute('aria-checked')).toBe('true'));
    expect(batch.value).toBe('60');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('shows the real email delivery mode from the backend', async () => {
    backend({ gateResult: async () => gate({ isDevMode: true }) });
    renderWithClient(<CrawlSettingsView />);
    expect(await screen.findByText('Email delivery: Development mode')).toBeTruthy();
  });

  it('warns when backend sending is off, and stays quiet for viewers', async () => {
    backend({ gateResult: async () => gate({ isDevMode: false, sendingEnabled: false }) });
    const first = renderWithClient(<CrawlSettingsView />);
    expect(await screen.findByText('Email delivery: Sending off')).toBeTruthy();
    first.unmount();

    backend({
      gateResult: async () => {
        throw new ApiError(403, 'forbidden', 'Viewers cannot view cold email settings');
      },
    });
    renderWithClient(<CrawlSettingsView />);
    expect(await screen.findByText('Editors only')).toBeTruthy();
    expect(screen.queryByText(/^Email delivery:/)).toBeNull();
  });

  it("previews the follow-up time on the target country's clock", async () => {
    backend();
    renderWithClient(<CrawlSettingsView />);
    expect(await screen.findByText(/10:00 Singapore time/)).toBeTruthy();
  });
});
