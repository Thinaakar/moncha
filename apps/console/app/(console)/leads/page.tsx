import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { LeadDrawer } from '@/components/lead-detail';
import { LeadsTable, type LeadRow } from '@/components/leads-table';
import { PageHeader } from '@/components/page-header';
import { getServerAuth } from '@/lib/auth';
import { DUMMY_LEADS } from '@/lib/dummy-leads';
import { omitChatbotSites } from '@/lib/flags';
import { dummyRow, loadLeadDetail } from '@/lib/leads';
import { formatStatus, websiteLabel } from '@/lib/ui';
import type { LeadQueue, Prisma } from '@prisma/client';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const ALL_QUEUES: LeadQueue[] = [
  'QUALIFIED',
  'PENDING_AUDIT',
  'NEEDS_REVIEW',
  'HAS_ASSISTANT',
  'NO_WEBSITE',
  'INACTIVE',
];

const PAGE_SIZE = 25;

type QueueFilter = LeadQueue | 'ALL';

type Filters = { search: string; country: string; queue: QueueFilter; page: number };

type LeadList = {
  rows: LeadRow[];
  countByQueue: Partial<Record<LeadQueue, number>>;
  totalAll: number;
  total: number;
  totalPages: number;
  countries: string[];
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function queueLabel(queue: QueueFilter) {
  return queue === 'ALL' ? 'All' : formatStatus(queue);
}

function parseQueue(raw: string | undefined, allowed: LeadQueue[]): QueueFilter {
  // Product default: QUALIFIED-only dashboard (matches contracts leadListQuerySchema).
  if (!raw) return 'QUALIFIED';
  const normalized = raw.trim().toUpperCase();
  if (normalized === 'ALL') return 'ALL';
  if (allowed.includes(normalized as LeadQueue)) return normalized as LeadQueue;
  return 'QUALIFIED';
}

function leadsQuery(opts: Partial<Filters> & { queue: QueueFilter; lead?: string }) {
  const params = new URLSearchParams();
  if (opts.search) params.set('search', opts.search);
  if (opts.country) params.set('country', opts.country);
  params.set('queue', opts.queue);
  if (opts.page && opts.page > 1) params.set('page', String(opts.page));
  if (opts.lead) params.set('lead', opts.lead);
  return `/leads?${params.toString()}`;
}

function loadDemoLeads(filters: Filters, omitChatbots: boolean): LeadList {
  const pool = DUMMY_LEADS.filter((lead) => !(omitChatbots && lead.queue === 'HAS_ASSISTANT'));
  const countByQueue: Partial<Record<LeadQueue, number>> = {};
  for (const lead of pool) {
    const queue = lead.queue as LeadQueue;
    countByQueue[queue] = (countByQueue[queue] || 0) + 1;
  }
  const search = filters.search.toLowerCase();
  const country = filters.country.toLowerCase();
  const matches = pool.filter(
    (lead) =>
      (filters.queue === 'ALL' || lead.queue === filters.queue) &&
      (!country || lead.country?.toLowerCase() === country) &&
      (!search || lead.name.toLowerCase().includes(search) || lead.domain?.toLowerCase().includes(search)),
  );
  const countries = [...new Set(pool.map((lead) => lead.country).filter((c): c is string => Boolean(c)))].sort();

  return {
    rows: matches.map(dummyRow),
    countByQueue,
    totalAll: pool.length,
    total: matches.length,
    totalPages: 1,
    countries,
  };
}

async function loadLiveLeads(tenantId: string, filters: Filters, omitChatbots: boolean): Promise<LeadList> {
  const { prisma } = await import('@moncha/db');
  const { search, country, queue, page } = filters;

  const baseTenant: Prisma.LeadWhereInput = {
    tenantId,
    ...(omitChatbots ? { queue: { not: 'HAS_ASSISTANT' } } : {}),
  };

  const where: Prisma.LeadWhereInput = {
    ...baseTenant,
    ...(queue === 'ALL' ? {} : { queue }),
    company: {
      ...(country ? { country: { equals: country, mode: 'insensitive' as const } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { domain: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
  };

  const [queueCounts, total, leads, countries] = await Promise.all([
    prisma.lead.groupBy({ by: ['queue'], where: baseTenant, _count: { _all: true } }),
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      include: { company: { include: { website: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.company.findMany({
      where: { tenantId, country: { not: null } },
      select: { country: true },
      distinct: ['country'],
      orderBy: { country: 'asc' },
    }),
  ]);

  const countByQueue = Object.fromEntries(
    queueCounts.map((row) => [row.queue, row._count._all]),
  ) as Partial<Record<LeadQueue, number>>;

  return {
    rows: leads.map((lead) => ({
      id: lead.id,
      name: lead.company.name,
      domain: lead.company.domain,
      city: lead.company.city,
      country: lead.company.country,
      queue: lead.queue,
      website: websiteLabel(lead.company.website?.status, Boolean(lead.company.website)),
      created: lead.createdAt.toLocaleDateString(),
    })),
    countByQueue,
    totalAll: Object.values(countByQueue).reduce((a, b) => a + (b || 0), 0),
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    countries: countries.map((c) => c.country).filter((c): c is string => Boolean(c)),
  };
}

export default async function Leads({ searchParams }: { searchParams: SearchParams }) {
  const auth = await getServerAuth();
  const omitChatbots = omitChatbotSites();
  const visibleQueues = omitChatbots ? ALL_QUEUES.filter((q) => q !== 'HAS_ASSISTANT') : ALL_QUEUES;

  const params = await searchParams;
  const filters: Filters = {
    search: (first(params.search) || '').trim(),
    country: (first(params.country) || '').trim(),
    queue: parseQueue(first(params.queue), visibleQueues),
    page: Math.max(1, Number(first(params.page) || 1) || 1),
  };
  const leadId = first(params.lead);

  const live = Boolean(auth && process.env.DATABASE_URL);
  const list =
    auth && live
      ? await loadLiveLeads(auth.tenantId, filters, omitChatbots)
      : loadDemoLeads(filters, omitChatbots);
  const detail = leadId ? await loadLeadDetail(leadId, auth) : null;

  const { rows, countByQueue, totalAll, total, totalPages, countries } = list;
  const tabs: QueueFilter[] = ['ALL', ...visibleQueues];
  const hasFilters = Boolean(filters.search || filters.country);

  return (
    <main>
      <PageHeader
        title="Leads"
        description={
          <>
            {filters.queue === 'ALL'
              ? `${totalAll} lead${totalAll === 1 ? '' : 's'}`
              : `${total} in ${queueLabel(filters.queue).toLowerCase()} · ${totalAll} total`}
            {live ? '' : ' · sample data'}
            {omitChatbots ? ' · chatbot sites hidden' : ''}
          </>
        }
        action={
          <Link href="/discover" className="btn">
            Discover more
          </Link>
        }
      />

      <div className="card">
        <nav className="tabs" aria-label="Lead queues">
          {tabs.map((q) => {
            const count = q === 'ALL' ? totalAll : countByQueue[q] || 0;
            return (
              <Link
                key={q}
                href={leadsQuery({ search: filters.search, country: filters.country, queue: q })}
                className={q === filters.queue ? 'tab is-active' : 'tab'}
              >
                {queueLabel(q)}
                <span className="tab-count">{count}</span>
              </Link>
            );
          })}
        </nav>

        <form className="search-bar" method="get">
          <input type="hidden" name="queue" value={filters.queue} />
          <input name="search" placeholder="Search company or domain…" defaultValue={filters.search} />
          <select name="country" defaultValue={filters.country}>
            <option value="">All countries</option>
            {countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button type="submit">Search</button>
        </form>

        {rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No leads match your search' : `No leads in ${queueLabel(filters.queue).toLowerCase()}`}
            action={
              hasFilters ? (
                <Link href={leadsQuery({ queue: filters.queue })} className="btn btn-secondary">
                  Clear search
                </Link>
              ) : (
                <Link href="/discover" className="btn">
                  Run Discover
                </Link>
              )
            }
          >
            {hasFilters ? 'Try a different name, domain, or country.' : 'Discover finds new companies for this queue.'}
          </EmptyState>
        ) : (
          <LeadsTable rows={rows} viewHref={(id) => leadsQuery({ ...filters, lead: id })} />
        )}

        {totalPages > 1 ? (
          <div className="pagination">
            <span className="muted">
              Page {filters.page} of {totalPages}
            </span>
            <div className="pagination-buttons">
              {filters.page > 1 ? (
                <Link className="btn btn-secondary btn-sm" href={leadsQuery({ ...filters, page: filters.page - 1 })}>
                  ← Previous
                </Link>
              ) : null}
              {filters.page < totalPages ? (
                <Link className="btn btn-secondary btn-sm" href={leadsQuery({ ...filters, page: filters.page + 1 })}>
                  Next →
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {detail ? <LeadDrawer lead={detail} closeHref={leadsQuery(filters)} /> : null}
    </main>
  );
}
