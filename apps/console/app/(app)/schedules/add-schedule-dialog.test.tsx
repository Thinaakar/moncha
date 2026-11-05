import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithClient } from '@/test/render';
import { discoveryOptions } from '@/test/fixtures';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), api: apiMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AddScheduleDialog } from './add-schedule-dialog';

const industries = [
  { id: 'i1', name: 'Dentist', slug: 'dentist', category: 'Healthcare', isDefault: true, isCustom: false },
  { id: 'i2', name: 'Gym', slug: 'gym', category: 'Fitness', isDefault: true, isCustom: false },
];

function backend() {
  const posts: Array<Record<string, unknown>> = [];
  apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
    if (path === 'discovery/options') return discoveryOptions;
    if (path === 'discovery/industries') return { industries };
    if (path === 'schedules' && init?.method === 'POST') {
      posts.push(init.body as Record<string, unknown>);
      return { id: 's1', country: 'Singapore', time: '09:00', timezone: 'Asia/Singapore', nextRunDay: 'tomorrow' };
    }
    throw new Error(`unexpected api call ${init?.method ?? 'GET'} ${path}`);
  });
  return { posts };
}

beforeEach(() => {
  apiMock.mockReset();
});

describe('Add daily schedule dialog', () => {
  it('uses the Crawl settings industries by default and saves no industry list', async () => {
    const { posts } = backend();
    renderWithClient(<AddScheduleDialog open onOpenChange={() => undefined} />);
    const useSettings = await screen.findByRole('radio', { name: /Use the industries from Crawl & Pipeline Settings/ });
    expect((useSettings as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByPlaceholderText('Search industries or categories...')).toBeNull();

    const submit = screen.getByRole('button', { name: 'Add schedule' });
    await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ country: 'SG', time: '09:00', timezone: 'Asia/Singapore' });
  });

  it('saves the picked industries when the schedule has custom industries', async () => {
    const { posts } = backend();
    renderWithClient(<AddScheduleDialog open onOpenChange={() => undefined} />);
    const custom = await screen.findByRole('radio', { name: /Custom industries for this schedule/ });
    // Choose before the countries finish loading: the choice must survive their arrival.
    fireEvent.click(custom);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('discovery/options'));
    expect(await screen.findByPlaceholderText('Search industries or categories...')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /Gym/ }));

    const submit = await screen.findByRole('button', { name: 'Add schedule (1 industries)' });
    fireEvent.click(submit);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ country: 'SG', industries: ['dentist'] });
  });
});
