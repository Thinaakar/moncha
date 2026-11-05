import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithClient } from '@/test/render';

const apiMock = vi.hoisted(() => vi.fn());
const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }));

vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), api: apiMock }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: nav.replace }),
  usePathname: () => '/sites',
  useSearchParams: () => nav.params,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/app/user-context', () => ({ useCanEdit: () => true }));

import { SitesView } from './sites-view';

const page = (total: number) => ({ items: [], total, page: 1, pageSize: 25, totalPages: total ? 1 : 0 });

function backend() {
  const listQueries: Array<Record<string, unknown>> = [];
  apiMock.mockImplementation(async (path: string, init?: { query?: Record<string, unknown> }) => {
    if (path === 'site-snapshots') {
      listQueries.push(init?.query ?? {});
      return page(init?.query?.pipeline === 'complete' ? 4 : 0);
    }
    if (path === 'site-snapshots/queue') return { running: [], waiting: [], averageRunMs: null, measured: 0 };
    if (path === 'site-automation') return { enabled: false, today: { used: 0 } };
    if (path === 'site-pipeline') return { enabled: false };
    throw new Error(`unexpected api call ${path}`);
  });
  return { listQueries };
}

beforeEach(() => {
  apiMock.mockReset();
  nav.params = new URLSearchParams();
});

describe('Website copies page', () => {
  it('counts the completed websites on their own tab', async () => {
    backend();
    renderWithClient(<SitesView />);
    const tab = await screen.findByRole('tab', { name: /Completed/ });
    await waitFor(() => expect(tab.textContent).toContain('4'));
    expect(screen.getByRole('tab', { name: /All copies/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('lists only live copies on the Completed tab, without the status filter', async () => {
    nav.params = new URLSearchParams('tab=completed&status=failed');
    const { listQueries } = backend();
    renderWithClient(<SitesView />);
    expect((await screen.findByRole('tab', { name: /Completed/ })).getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(listQueries.filter((q) => q.pageSize === 25)).toHaveLength(1));
    expect(listQueries.find((q) => q.pageSize === 25)).toMatchObject({ pipeline: 'complete', status: undefined });
    expect(screen.queryByText('All statuses')).toBeNull();
    expect(screen.queryByRole('combobox', { name: /status/i })).toBeNull();
  });

  it('keeps the status filter and every copy on All copies', async () => {
    nav.params = new URLSearchParams('status=done');
    const { listQueries } = backend();
    renderWithClient(<SitesView />);
    await waitFor(() => expect(listQueries.some((q) => q.pageSize === 25)).toBe(true));
    const list = listQueries.find((q) => q.pageSize === 25)!;
    expect(list).toMatchObject({ status: 'done' });
    expect(list.pipeline).toBeUndefined();
    expect(await screen.findByText('No copies match these filters')).toBeTruthy();
  });
});
