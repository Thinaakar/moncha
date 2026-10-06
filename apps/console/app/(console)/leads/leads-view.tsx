'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { Icon, type IconName } from '@/components/icon';
import { LeadCards, LeadsTable, type CheckState, type LeadRow } from '@/components/leads-table';
import { PageHeader } from '@/components/page-header';
import { formatStatus, websiteLabel } from '@/lib/ui';

const QUEUES = ['QUALIFIED', 'PENDING_AUDIT', 'NEEDS_REVIEW', 'HAS_ASSISTANT', 'NO_WEBSITE', 'INACTIVE'] as const;
type QueueName = (typeof QUEUES)[number];
type Queue = QueueName | 'ALL';
type Sort = 'newest' | 'oldest' | 'name';
type View = 'table' | 'cards';

type CardKey = 'ALL' | 'QUALIFIED' | 'PENDING_AUDIT' | 'NEEDS_REVIEW' | 'NOT_FIT';

const NOT_FIT: { queue: QueueName; label: string; short: string; icon: IconName }[] = [
  { queue: 'HAS_ASSISTANT', label: 'Has bot', short: 'bot', icon: 'chat' },
  { queue: 'NO_WEBSITE', label: 'No site', short: 'no site', icon: 'ban' },
  { queue: 'INACTIVE', label: 'Inactive', short: 'down', icon: 'power' },
];
const NOT_FIT_QUEUES: QueueName[] = NOT_FIT.map((item) => item.queue);

const MAIN_CARDS: { key: CardKey; label: string; icon: IconName; tone: string }[] = [
  { key: 'ALL', label: 'All leads', icon: 'leads', tone: 'stat-tone-blue' },
  { key: 'QUALIFIED', label: 'Qualified', icon: 'check', tone: 'stat-tone-green' },
  { key: 'PENDING_AUDIT', label: 'Pending check', icon: 'jobs', tone: 'stat-tone-amber' },
  { key: 'NEEDS_REVIEW', label: 'Needs review', icon: 'discover', tone: 'stat-tone-violet' },
  { key: 'NOT_FIT', label: 'Not a fit', icon: 'ban', tone: 'stat-tone-red' },
];

const COUNTRIES = [
  { code: '', name: '' },
  { code: 'SG', name: 'Singapore' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'JP', name: 'Japan' },
];

const PAGE_SIZES = [25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 350;
const NOTICE_MS = 5000;
const VIEW_KEY = 'moncha-leads-view';
const EXPORT_PAGE_SIZE = 100;
const EXPORT_MAX_PAGES = 50;

type ApiLead = {
  id: string;
  queue: string;
  createdAt: string;
  company?: {
    name?: string;
    domain?: string | null;
    phone?: string | null;
    address?: string | null;
    country?: string | null;
    city?: string | null;
    website?: { status?: string } | null;
  };
};
type ListData = { items?: ApiLead[]; total?: number; totalPages?: number };
type Counts = Record<string, number>;
type Notice = { tone: 'success' | 'error'; text: string } | null;

function queryUrl(search: string, country: string, queue: Queue, page: number, pageSize: number) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
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

function toRow(lead: ApiLead): LeadRow {
  return {
    id: lead.id,
    name: lead.company?.name || 'Unnamed company',
    domain: lead.company?.domain ?? null,
    phone: lead.company?.phone ?? null,
    city: lead.company?.city ?? null,
    country: lead.company?.country ?? null,
    queue: lead.queue,
    website: websiteLabel(lead.company?.website?.status, Boolean(lead.company?.website)),
    createdAt: lead.createdAt,
  };
}

function pageList(page: number, totalPages: number): (number | 'gap')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = [...new Set([1, page - 1, page, page + 1, totalPages])]
    .filter((value) => value >= 1 && value <= totalPages)
    .sort((a, b) => a - b);
  const result: (number | 'gap')[] = [];
  let previous = 0;
  for (const value of pages) {
    if (previous && value - previous > 1) result.push('gap');
    result.push(value);
    previous = value;
  }
  return result;
}

function csvCell(value: string | null | undefined) {
  let text = value ?? '';
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(leads: ApiLead[]) {
  const header = ['Company', 'Domain', 'Queue', 'Website', 'City', 'Country', 'Phone', 'Address', 'Added'];
  const lines = leads.map((lead) => {
    const row = toRow(lead);
    return [
      row.name,
      row.domain,
      formatStatus(row.queue),
      formatStatus(row.website),
      row.city,
      row.country,
      row.phone,
      lead.company?.address,
      new Date(row.createdAt).toISOString(),
    ]
      .map(csvCell)
      .join(',');
  });
  return [header.join(','), ...lines].join('\n');
}

export function LeadsView() {
  const [ready, setReady] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [queue, setQueue] = useState<Queue>('QUALIFIED');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sort, setSort] = useState<Sort>('newest');
  const [view, setView] = useState<View>('table');
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [checks, setChecks] = useState<Record<string, CheckState | undefined>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawQueue = params.get('queue')?.toUpperCase();
    const initialSearch = params.get('search') || '';
    const rawSize = Number(params.get('pageSize'));
    setSearch(initialSearch);
    setSearchInput(initialSearch);
    setCountry(params.get('country') || '');
    setQueue(rawQueue === 'ALL' || QUEUES.includes(rawQueue as QueueName) ? (rawQueue as Queue) : 'QUALIFIED');
    setPage(Math.max(1, Number(params.get('page') || '1') || 1));
    setPageSize(PAGE_SIZES.includes(rawSize) ? rawSize : DEFAULT_PAGE_SIZE);
    if (window.localStorage.getItem(VIEW_KEY) === 'cards') setView('cards');
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams({ queue });
    if (search) params.set('search', search);
    if (country) params.set('country', country);
    if (page > 1) params.set('page', String(page));
    if (pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(pageSize));
    window.history.replaceState(null, '', `/leads?${params}`);
  }, [ready, queue, search, country, page, pageSize]);

  useEffect(() => {
    const next = searchInput.trim();
    if (next === search) return;
    const timer = window.setTimeout(() => {
      setSearch(next);
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput, search]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      fetch(queryUrl(search, country, queue, page, pageSize), { cache: 'no-store' }),
      fetch('/api/v1/leads/counts', { cache: 'no-store' }),
    ])
      .then(async ([listResponse, countResponse]) => {
        const listData: ListData = await listResponse.json();
        const countData: Counts = countResponse.ok ? await countResponse.json() : {};
        if (!listResponse.ok) throw new Error(errorText(listData));
        if (cancelled) return;
        setRows((listData.items || []).map(toRow));
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
    return () => {
      cancelled = true;
    };
  }, [ready, search, country, queue, page, pageSize]);

  const totalAll = QUEUES.reduce((sum, name) => sum + (counts[name] || 0), 0);
  const qualified = counts.QUALIFIED || 0;
  const qualifyRate = totalAll ? Math.round((qualified / totalAll) * 100) : 0;
  const notFitTotal = NOT_FIT_QUEUES.reduce((sum, name) => sum + (counts[name] || 0), 0);
  const activeCard: CardKey = NOT_FIT_QUEUES.includes(queue as QueueName) ? 'NOT_FIT' : (queue as CardKey);

  function cardCount(key: CardKey) {
    if (key === 'ALL') return totalAll;
    if (key === 'NOT_FIT') return notFitTotal;
    return counts[key] || 0;
  }

  function cardHint(key: CardKey) {
    if (key === 'ALL') return 'Every company found';
    if (key === 'QUALIFIED') return `▲ ${qualifyRate}% of all leads`;
    if (key === 'PENDING_AUDIT') return 'Waiting for website check';
    if (key === 'NEEDS_REVIEW') return 'A person needs to decide';
    return NOT_FIT.map((item) => `${counts[item.queue] || 0} ${item.short}`).join(' · ');
  }

  function selectCard(key: CardKey) {
    if (key === 'NOT_FIT') {
      if (activeCard === 'NOT_FIT') return changeQueue('ALL');
      const first = NOT_FIT.find((item) => (counts[item.queue] || 0) > 0);
      return changeQueue(first?.queue ?? 'HAS_ASSISTANT');
    }
    changeQueue(activeCard === key && key !== 'ALL' ? 'ALL' : key);
  }

  const sortedRows = useMemo(() => {
    if (sort === 'oldest') return [...rows].reverse();
    if (sort === 'name') return [...rows].sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }, [rows, sort]);

  function changeQueue(next: Queue) {
    setQueue(next);
    setPage(1);
  }

  function changeCountry(next: string) {
    setCountry(next);
    setPage(1);
  }

  function changeView(next: View) {
    setView(next);
    window.localStorage.setItem(VIEW_KEY, next);
  }

  function clearSearch() {
    setSearchInput('');
    setSearch('');
    setPage(1);
  }

  function clearAll() {
    setSearchInput('');
    setSearch('');
    setCountry('');
    setQueue('ALL');
    setPage(1);
  }

  const recheck = useCallback(async (lead: LeadRow) => {
    setChecks((current) => ({ ...current, [lead.id]: 'busy' }));
    try {
      const res = await fetch(`/api/v1/leads/${encodeURIComponent(lead.id)}/website-check`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(data));
      setChecks((current) => ({ ...current, [lead.id]: 'queued' }));
      setNotice({
        tone: 'success',
        text: data.deduped
          ? `A website check for ${lead.name} is already queued.`
          : `Website check queued for ${lead.name}. Results appear once the worker runs it.`,
      });
    } catch (cause) {
      setChecks((current) => ({ ...current, [lead.id]: 'error' }));
      setNotice({ tone: 'error', text: cause instanceof Error ? cause.message : 'Could not queue the website check.' });
    }
  }, []);

  async function exportCsv() {
    setExporting(true);
    try {
      const all: ApiLead[] = [];
      let pages = 1;
      for (let current = 1; current <= pages && current <= EXPORT_MAX_PAGES; current += 1) {
        const res = await fetch(queryUrl(search, country, queue, current, EXPORT_PAGE_SIZE), { cache: 'no-store' });
        const data: ListData = await res.json();
        if (!res.ok) throw new Error(errorText(data));
        all.push(...(data.items || []));
        pages = data.totalPages || 1;
      }
      const blob = new Blob([toCsv(all)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `moncha-leads-${queue.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice({ tone: 'success', text: `Exported ${all.length} lead${all.length === 1 ? '' : 's'}.` });
    } catch (cause) {
      setNotice({ tone: 'error', text: cause instanceof Error ? cause.message : 'Export failed.' });
    } finally {
      setExporting(false);
    }
  }

  const filters = [
    ...(queue !== 'ALL' ? [{ key: 'queue', label: formatStatus(queue), clear: () => changeQueue('ALL') }] : []),
    ...(country ? [{ key: 'country', label: country, clear: () => changeCountry('') }] : []),
    ...(search ? [{ key: 'search', label: `“${search}”`, clear: clearSearch }] : []),
  ];

  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, total);

  return (
    <main>
      <PageHeader
        title="Leads"
        description={`${qualified} qualified · ${totalAll} total`}
        action={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={exportCsv}
              disabled={exporting || loading || total === 0}
              title="Download all leads that match the current filters as CSV"
            >
              <Icon name="download" size={16} />
              {exporting ? 'Exporting…' : 'Export'}
            </button>
            <Link href="/discover" className="btn">
              <Icon name="add" size={16} />
              Discover
            </Link>
          </>
        }
      />

      <div className="queue-cards" role="group" aria-label="Filter by group">
        {MAIN_CARDS.map((card) => {
          const active = activeCard === card.key;
          return (
            <button
              key={card.key}
              type="button"
              className={`queue-card ${card.tone}${active ? ' is-active' : ''}`}
              aria-pressed={active}
              onClick={() => selectCard(card.key)}
              title={active && card.key !== 'ALL' ? 'Show all leads' : `Show ${card.label.toLowerCase()}`}
            >
              <span className="queue-card-top">
                <span className="queue-card-icon">
                  <Icon name={card.icon} size={16} />
                </span>
                {card.label}
              </span>
              <strong className="queue-card-count">{cardCount(card.key).toLocaleString()}</strong>
              <span className={card.key === 'QUALIFIED' ? 'queue-card-hint is-up' : 'queue-card-hint'}>
                {cardHint(card.key)}
              </span>
            </button>
          );
        })}
      </div>

      {activeCard === 'NOT_FIT' ? (
        <div className="queue-subfilters" role="group" aria-label="Not a fit groups">
          <span>Not a fit:</span>
          {NOT_FIT.map((item) => (
            <button
              key={item.queue}
              type="button"
              className={queue === item.queue ? 'queue-subchip is-active' : 'queue-subchip'}
              aria-pressed={queue === item.queue}
              onClick={() => changeQueue(item.queue)}
            >
              <Icon name={item.icon} size={14} />
              {item.label}
              <b>{(counts[item.queue] || 0).toLocaleString()}</b>
            </button>
          ))}
        </div>
      ) : null}

      <div className="card leads-panel">
        <div className="leads-toolbar">
          <div className="leads-search">
            <Icon name="discover" size={16} />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search company or domain…"
              aria-label="Search company or domain"
            />
            {searchInput ? (
              <button type="button" className="leads-search-clear" onClick={clearSearch} aria-label="Clear search">
                <Icon name="close" size={14} />
              </button>
            ) : null}
          </div>

          <div className="leads-controls">
            <div className="segmented" role="group" aria-label="Country">
              {COUNTRIES.map((item) => (
                <button
                  key={item.code || 'all'}
                  type="button"
                  className={country === item.name ? 'is-active' : ''}
                  aria-pressed={country === item.name}
                  onClick={() => changeCountry(item.name)}
                  title={item.name || 'All countries'}
                >
                  {item.code || 'All'}
                </button>
              ))}
            </div>

            <label className="inline-select" title="Sorts the leads shown on this page">
              Sort
              <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="name">Name A–Z</option>
              </select>
            </label>

            <div className="segmented" role="group" aria-label="View">
              <button
                type="button"
                className={view === 'table' ? 'is-active' : ''}
                aria-pressed={view === 'table'}
                onClick={() => changeView('table')}
              >
                <Icon name="list" size={15} />
                Table
              </button>
              <button
                type="button"
                className={view === 'cards' ? 'is-active' : ''}
                aria-pressed={view === 'cards'}
                onClick={() => changeView('cards')}
              >
                <Icon name="grid" size={15} />
                Cards
              </button>
            </div>
          </div>
        </div>

        {filters.length > 0 ? (
          <div className="active-filters">
            <span>Active filters:</span>
            {filters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                className="filter-chip"
                onClick={filter.clear}
                aria-label={`Remove filter ${filter.label}`}
              >
                {filter.label}
                <Icon name="close" size={12} />
              </button>
            ))}
            <button type="button" className="link-button" onClick={clearAll}>
              Clear all
            </button>
          </div>
        ) : null}

        {notice ? (
          <p className={notice.tone === 'success' ? 'notice success' : 'notice error'} role="status">
            {notice.text}
          </p>
        ) : null}
        {error ? (
          <p className="notice error" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="skeleton-list" aria-label="Loading leads">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="skeleton-row" key={index}>
                <span className="skeleton skeleton-avatar" />
                <span className="skeleton skeleton-line" />
                <span className="skeleton skeleton-chip" />
                <span className="skeleton skeleton-chip" />
                <span className="skeleton skeleton-short" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title={error ? 'Leads unavailable' : 'No leads found'}>
            {error
              ? 'Check the backend connection and retry.'
              : filters.length > 0
                ? 'Try removing a filter, or run discovery to add more leads.'
                : 'Run discovery to add leads to this list.'}
          </EmptyState>
        ) : view === 'cards' ? (
          <LeadCards rows={sortedRows} checks={checks} onRecheck={recheck} />
        ) : (
          <LeadsTable rows={sortedRows} checks={checks} onRecheck={recheck} />
        )}

        {total > 0 ? (
          <div className="leads-pagination">
            <span className="muted">
              Showing {start}–{end} of {total}
            </span>
            <div className="page-numbers">
              <button
                type="button"
                className="page-button"
                disabled={page <= 1 || loading}
                onClick={() => setPage(page - 1)}
                aria-label="Previous page"
              >
                ‹
              </button>
              {pageList(page, totalPages).map((item, index) =>
                item === 'gap' ? (
                  <span key={`gap-${index}`} className="page-gap">
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    className={item === page ? 'page-button is-active' : 'page-button'}
                    aria-current={item === page ? 'page' : undefined}
                    disabled={loading}
                    onClick={() => setPage(item)}
                  >
                    {item}
                  </button>
                ),
              )}
              <button
                type="button"
                className="page-button"
                disabled={page >= totalPages || loading}
                onClick={() => setPage(page + 1)}
                aria-label="Next page"
              >
                ›
              </button>
            </div>
            <label className="inline-select">
              Rows
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </div>
    </main>
  );
}
