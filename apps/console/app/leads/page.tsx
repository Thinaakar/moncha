import Link from 'next/link';
import { prisma } from '@moncha/db';
import { getServerAuth } from '@/lib/auth';
import { omitChatbotSites } from '@/lib/flags';
import { statusChip, websiteLabel } from '@/lib/ui';
import type { LeadQueue, Prisma } from '@prisma/client';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const ALL_QUEUES: LeadQueue[] = [
  'PENDING_AUDIT',
  'QUALIFIED',
  'NEEDS_REVIEW',
  'HAS_ASSISTANT',
  'NO_WEBSITE',
  'INACTIVE',
];

type QueueFilter = LeadQueue | 'ALL';

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function queueLabel(queue: QueueFilter) {
  if (queue === 'ALL') return 'All';
  return queue.replaceAll('_', ' ');
}

function parseQueue(raw: string | undefined, allowed: LeadQueue[]): QueueFilter {
  // Product default: QUALIFIED-only dashboard (matches contracts leadListQuerySchema).
  if (!raw) return 'QUALIFIED';
  const normalized = raw.trim().toUpperCase();
  if (normalized === 'ALL') return 'ALL';
  if (allowed.includes(normalized as LeadQueue)) return normalized as LeadQueue;
  return 'QUALIFIED';
}

function leadsQuery(opts: {
  search?: string;
  country?: string;
  queue: QueueFilter;
  page?: number;
}) {
  const params = new URLSearchParams();
  if (opts.search) params.set('search', opts.search);
  if (opts.country) params.set('country', opts.country);
  params.set('queue', opts.queue);
  if (opts.page && opts.page > 1) params.set('page', String(opts.page));
  const qs = params.toString();
  return qs ? `/leads?${qs}` : '/leads';
}

export default async function Leads({ searchParams }: { searchParams: SearchParams }) {
  const auth = await getServerAuth();
  if (!auth) {
    return (
      <main>
        <div className="page-head">
          <div>
            <h1>Leads</h1>
            <p>Sign in to review discovered companies.</p>
          </div>
        </div>
        <div className="card">
          <p>
            Authentication required. <Link href="/login">Login</Link>
          </p>
        </div>
      </main>
    );
  }

  const omitChatbots = omitChatbotSites();
  const visibleQueues = omitChatbots
    ? ALL_QUEUES.filter((q) => q !== 'HAS_ASSISTANT')
    : ALL_QUEUES;

  const params = await searchParams;
  const search = (first(params.search) || '').trim();
  const country = (first(params.country) || '').trim();
  const queue = parseQueue(first(params.queue), visibleQueues);
  const page = Math.max(1, Number(first(params.page) || 1) || 1);
  const pageSize = 25;

  const baseTenant: Prisma.LeadWhereInput = {
    tenantId: auth.tenantId,
    ...(omitChatbots ? { queue: { not: 'HAS_ASSISTANT' } } : {}),
  };

  const queueCounts = await prisma.lead.groupBy({
    by: ['queue'],
    where: baseTenant,
    _count: { _all: true },
  });
  const countByQueue = Object.fromEntries(
    queueCounts.map((row) => [row.queue, row._count._all]),
  ) as Partial<Record<LeadQueue, number>>;
  const totalAll = Object.values(countByQueue).reduce((a, b) => a + (b || 0), 0);

  const where: Prisma.LeadWhereInput = {
    tenantId: auth.tenantId,
    ...(queue === 'ALL'
      ? omitChatbots
        ? { queue: { not: 'HAS_ASSISTANT' } }
        : {}
      : { queue }),
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

  const [total, leads, countries] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      include: { company: { include: { website: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.company.findMany({
      where: { tenantId: auth.tenantId, country: { not: null } },
      select: { country: true },
      distinct: ['country'],
      orderBy: { country: 'asc' },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const tabs: QueueFilter[] = ['ALL', ...visibleQueues];

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Leads</h1>
          <p>
            {queue === 'ALL'
              ? `${totalAll} lead${totalAll === 1 ? '' : 's'}${omitChatbots ? ' (chatbot sites omitted)' : ''}.`
              : `${total} in ${queueLabel(queue).toLowerCase()} · ${totalAll} total.`}
          </p>
        </div>
        <Link href="/discover" className="btn">
          Discover more
        </Link>
      </div>

      {omitChatbots ? (
        <div className="notice" style={{ marginBottom: 12 }}>
          <code>OMIT_CHATBOT_SITES=true</code> — listing sites without chatbots only (HAS_ASSISTANT
          hidden). Set to <code>false</code> to show all.
        </div>
      ) : null}

      <div className="card">
        <div className="filters" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
          {tabs.map((q) => {
            const n = q === 'ALL' ? totalAll : countByQueue[q] || 0;
            const active = q === queue;
            return (
              <Link
                key={q}
                href={leadsQuery({ search, country, queue: q })}
                className={active ? 'btn' : 'btn btn-secondary'}
                style={{ fontSize: 13, padding: '6px 12px' }}
              >
                {queueLabel(q)} ({n})
              </Link>
            );
          })}
        </div>

        <form className="filters" method="get">
          {queue !== 'ALL' ? <input type="hidden" name="queue" value={queue} /> : null}
          <input name="search" placeholder="Search company or domain" defaultValue={search} />
          <select name="country" defaultValue={country}>
            <option value="">All countries</option>
            {countries.map((c) => (
              <option key={c.country || 'x'} value={c.country || ''}>
                {c.country}
              </option>
            ))}
          </select>
          <button type="submit">Filter</button>
        </form>

        {leads.length === 0 ? (
          <div className="empty">
            No leads yet. <Link href="/discover">Run Discover</Link> to find companies.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Domain</th>
                  <th>Country</th>
                  <th>Queue</th>
                  <th>Website</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const website = websiteLabel(
                    lead.company.website?.status,
                    Boolean(lead.company.website),
                  );
                  return (
                    <tr key={lead.id}>
                      <td>
                        <Link href={`/leads/${lead.id}`}>{lead.company.name}</Link>
                      </td>
                      <td>{lead.company.domain || '—'}</td>
                      <td>{lead.company.country || '—'}</td>
                      <td>
                        <span className={statusChip(lead.queue)}>{lead.queue}</span>
                      </td>
                      <td>
                        <span className={statusChip(website)}>{website}</span>
                      </td>
                      <td>{lead.createdAt.toLocaleDateString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, gap: 10 }}>
          <span className="muted">
            Page {page} of {totalPages}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {page > 1 && (
              <Link
                className="btn btn-secondary"
                href={leadsQuery({ search, country, queue, page: page - 1 })}
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                className="btn btn-secondary"
                href={leadsQuery({ search, country, queue, page: page + 1 })}
              >
                Next
              </Link>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
