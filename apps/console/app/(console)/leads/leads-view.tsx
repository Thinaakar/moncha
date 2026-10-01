'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { EmptyState } from '@/components/empty-state';
import { LeadsTable, type LeadRow } from '@/components/leads-table';
import { PageHeader } from '@/components/page-header';
import { formatStatus, websiteLabel } from '@/lib/ui';

const QUEUES = ['QUALIFIED', 'PENDING_AUDIT', 'NEEDS_REVIEW', 'HAS_ASSISTANT', 'NO_WEBSITE', 'INACTIVE'] as const;
type Queue = (typeof QUEUES)[number] | 'ALL';
type ApiLead = {
  id: string;
  queue: string;
  createdAt: string;
  company?: {
    name?: string;
    domain?: string | null;
    country?: string | null;
    city?: string | null;
    website?: { status?: string } | null;
  };
};
type ListData = { items?: ApiLead[]; total?: number; totalPages?: number };
type Counts = Record<string, number>;

function queryUrl(search: string, country: string, queue: Queue, page: number) {
  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (search) params.set('search', search);
  if (country) params.set('country', country);
  if (queue !== 'ALL') params.set('queue', queue);
  return `/api/v1/leads?${params}`;
}

function errorText(data: unknown) {
  if (data && typeof data === 'object' && 'error' in data) {
    const error = (data as { error?: { message?: string } | string }).error;
    if (typeof error === 'string') return error;
    if (error?.message) return error.message;
  }
  return 'Unable to load leads from the backend.';
}

export function LeadsView() {
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [queue, setQueue] = useState<Queue>('QUALIFIED');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawQueue = params.get('queue')?.toUpperCase();
    setSearch(params.get('search') || '');
    setCountry(params.get('country') || '');
    setQueue(rawQueue === 'ALL' || QUEUES.includes(rawQueue as (typeof QUEUES)[number]) ? rawQueue as Queue : 'QUALIFIED');
    setPage(Math.max(1, Number(params.get('page') || '1') || 1));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      fetch(queryUrl(search, country, queue, page), { cache: 'no-store' }),
      fetch('/api/v1/leads/counts', { cache: 'no-store' }),
    ])
      .then(async ([listResponse, countResponse]) => {
        const listData: ListData = await listResponse.json();
        const countData: Counts = countResponse.ok ? await countResponse.json() : {};
        if (!listResponse.ok) throw new Error(errorText(listData));
        if (cancelled) return;
        setRows((listData.items || []).map((lead) => ({
          id: lead.id,
          name: lead.company?.name || 'Unnamed company',
          domain: lead.company?.domain ?? null,
          city: lead.company?.city ?? null,
          country: lead.company?.country ?? null,
          queue: lead.queue,
          website: websiteLabel(lead.company?.website?.status, Boolean(lead.company?.website)),
          created: new Date(lead.createdAt).toLocaleDateString(),
        })));
        setCounts(countData);
        setTotal(listData.total || 0);
        setTotalPages(Math.max(1, listData.totalPages || 1));
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load leads.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [search, country, queue, page]);

  const totalAll = Object.entries(counts).filter(([key]) => QUEUES.includes(key as (typeof QUEUES)[number])).reduce((sum, [, count]) => sum + count, 0);
  const tabs: Queue[] = ['ALL', ...QUEUES];

  function changeQueue(next: Queue) {
    setQueue(next);
    setPage(1);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSearch(String(form.get('search') || '').trim());
    setCountry(String(form.get('country') || '').trim());
    setPage(1);
  }

  return (
    <main>
      <PageHeader
        title="Leads"
        description={queue === 'ALL' ? `${totalAll} leads` : `${total} in ${formatStatus(queue).toLowerCase()} · ${totalAll} total`}
        action={<Link href="/discover" className="btn">Discover more</Link>}
      />
      <div className="card">
        <nav className="tabs" aria-label="Lead queues">
          {tabs.map((item) => (
            <button key={item} type="button" className={queue === item ? 'tab is-active' : 'tab'} onClick={() => changeQueue(item)}>
              {item === 'ALL' ? 'All' : formatStatus(item)}
              <span className="tab-count">{item === 'ALL' ? totalAll : counts[item] || 0}</span>
            </button>
          ))}
        </nav>
        <form className="search-bar" onSubmit={submitSearch}>
          <input name="search" placeholder="Search company or domain…" defaultValue={search} />
          <input name="country" placeholder="Country" defaultValue={country} />
          <button type="submit">Search</button>
        </form>
        {error ? <p className="notice error" role="alert">{error}</p> : null}
        {loading ? <p className="muted">Loading leads…</p> : rows.length === 0 ? (
          <EmptyState title={error ? 'Leads unavailable' : 'No leads found'}>
            {error ? 'Check the backend connection and retry.' : 'Run discovery to add leads to this list.'}
          </EmptyState>
        ) : <LeadsTable rows={rows} />}
        {totalPages > 1 ? (
          <div className="pagination">
            <span className="muted">Page {page} of {totalPages}</span>
            <div className="pagination-buttons">
              <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
