import Link from 'next/link';
import { CountryBars, type CountryCount } from '@/components/country-bars';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { JobTimeline, type TimelineJob } from '@/components/job-timeline';
import { PageHeader } from '@/components/page-header';
import { QueueDonut } from '@/components/queue-donut';
import { StatCard } from '@/components/stat-card';
import { getServerAuth } from '@/lib/auth';
import { DUMMY_JOBS, DUMMY_LEADS } from '@/lib/dummy-leads';
import { omitChatbotSites } from '@/lib/flags';
import { failedJobAction, formatStatus, jobTypeLabel, statusChip } from '@/lib/ui';

const QUEUES = [
  { queue: 'QUALIFIED', label: 'Qualified', color: '#22c55e' },
  { queue: 'PENDING_AUDIT', label: 'Pending audit', color: '#d97706' },
  { queue: 'NEEDS_REVIEW', label: 'Needs review', color: '#ea580c' },
  { queue: 'HAS_ASSISTANT', label: 'Has assistant', color: '#dc2626' },
  { queue: 'NO_WEBSITE', label: 'No website', color: '#9ca3af' },
  { queue: 'INACTIVE', label: 'Inactive', color: '#64748b' },
];

const TOP_COUNTRIES = 6;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type RecentLead = { id: string; name: string; domain: string | null; queue: string };

type OverviewData = {
  demo: boolean;
  counts: Record<string, number>;
  addedThisWeek: number;
  countries: CountryCount[];
  failedJobs: number;
  recentLeads: RecentLead[];
  recentJobs: TimelineJob[];
};

function topCountries(rows: CountryCount[]) {
  return [...rows].sort((a, b) => b.count - a.count).slice(0, TOP_COUNTRIES);
}

function Overview({ demo, counts, addedThisWeek, countries, failedJobs, recentLeads, recentJobs }: OverviewData) {
  const omitChatbots = omitChatbotSites();
  const slices = QUEUES.filter((q) => !(omitChatbots && q.queue === 'HAS_ASSISTANT')).map((q) => ({
    ...q,
    count: counts[q.queue] || 0,
  }));
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  const qualified = counts.QUALIFIED || 0;
  const rate = total > 0 ? Math.round((qualified / total) * 100) : 0;

  return (
    <main>
      <PageHeader
        title="Overview"
        description={
          demo
            ? 'Sample data. Connect a database to see live numbers.'
            : 'Find companies, check their websites, and review qualified leads.'
        }
        action={
          <Link href="/discover" className="btn">
            Start Discover
          </Link>
        }
      />

      <div className="kpi-grid">
        <StatCard
          label="Total leads"
          value={total}
          tone="blue"
          icon={<Icon name="users" />}
          hint="all queues"
          href="/leads?queue=ALL"
        />
        <StatCard
          label="Qualified"
          value={qualified}
          tone="green"
          icon={<Icon name="check" />}
          hint="ready to use"
          href="/leads?queue=QUALIFIED"
        />
        <StatCard label="Qualify rate" value={`${rate}%`} tone="violet" icon={<Icon name="percent" />} hint="of all leads" />
        <StatCard
          label="Added this week"
          value={addedThisWeek}
          tone="teal"
          icon={<Icon name="calendar" />}
          hint="new leads"
        />
      </div>

      <div className="split-panels chart-panels">
        <section className="card">
          <div className="card-head">
            <h2>Leads by queue</h2>
          </div>
          <QueueDonut slices={slices} total={total} />
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Leads by country</h2>
          </div>
          {countries.length === 0 ? (
            <EmptyState title="No countries yet">Run Discover to find companies.</EmptyState>
          ) : (
            <CountryBars rows={countries} />
          )}
        </section>
      </div>

      <div className="split-panels">
        <section className="card">
          <div className="card-head">
            <h2>Recent leads</h2>
            <Link href="/leads?queue=ALL">View all</Link>
          </div>
          {recentLeads.length === 0 ? (
            <EmptyState title="No leads yet" action={<Link href="/discover" className="btn">Run Discover</Link>}>
              Discover finds companies and adds them here.
            </EmptyState>
          ) : (
            <ul className="mini-list">
              {recentLeads.map((lead) => (
                <li key={lead.id}>
                  <span className="lead-avatar" aria-hidden="true">
                    {lead.name.charAt(0).toUpperCase()}
                  </span>
                  <div className="mini-list-text">
                    <Link href={`/leads?queue=ALL&lead=${lead.id}`}>{lead.name}</Link>
                    <span>{lead.domain || 'No website'}</span>
                  </div>
                  <span className={statusChip(lead.queue)}>{formatStatus(lead.queue)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <div className="card-head-title">
              <h2>Recent jobs</h2>
              {failedJobs > 0 ? <span className="chip chip-red">{failedJobs} failed</span> : null}
            </div>
            <Link href="/jobs">View all</Link>
          </div>
          {recentJobs.length === 0 ? (
            <EmptyState title="No jobs yet">Run Discover to create the first one.</EmptyState>
          ) : (
            <JobTimeline jobs={recentJobs} />
          )}
        </section>
      </div>
    </main>
  );
}

export default async function Home() {
  const auth = await getServerAuth();
  const omitChatbots = omitChatbotSites();

  if (!auth || !process.env.DATABASE_URL) {
    const leads = DUMMY_LEADS.filter((lead) => !(omitChatbots && lead.queue === 'HAS_ASSISTANT'));
    const counts: Record<string, number> = {};
    const byCountry = new Map<string | null, number>();
    for (const lead of leads) {
      counts[lead.queue] = (counts[lead.queue] || 0) + 1;
      byCountry.set(lead.country, (byCountry.get(lead.country) || 0) + 1);
    }
    const weekAgo = Date.now() - WEEK_MS;

    return (
      <Overview
        demo
        counts={counts}
        addedThisWeek={leads.filter((lead) => new Date(lead.createdAt).getTime() >= weekAgo).length}
        countries={topCountries([...byCountry].map(([country, count]) => ({ country, count })))}
        failedJobs={DUMMY_JOBS.filter((job) => job.status === 'failed').length}
        recentLeads={[...leads]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((lead) => ({ id: lead.id, name: lead.name, domain: lead.domain, queue: lead.queue }))}
        recentJobs={DUMMY_JOBS.map((job) => ({
          id: job.id,
          title: jobTypeLabel(job.type),
          when: job.when,
          status: job.status,
          detail: job.detail,
          error: job.error,
          action: job.status === 'failed' ? failedJobAction(job.type) : undefined,
        }))}
      />
    );
  }

  const { prisma } = await import('@moncha/db');
  const tenantId = auth.tenantId;
  const leadFilter = omitChatbots ? { queue: { not: 'HAS_ASSISTANT' as const } } : {};
  const [queueCounts, addedThisWeek, countryCounts, failedJobs, jobs, leads] = await Promise.all([
    prisma.lead.groupBy({ by: ['queue'], where: { tenantId }, _count: { _all: true } }),
    prisma.lead.count({ where: { tenantId, ...leadFilter, createdAt: { gte: new Date(Date.now() - WEEK_MS) } } }),
    prisma.company.groupBy({
      by: ['country'],
      where: { tenantId, leads: { some: leadFilter } },
      _count: { _all: true },
    }),
    prisma.jobRun.count({ where: { tenantId, status: 'failed' } }),
    prisma.jobRun.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.lead.findMany({
      where: { tenantId, ...leadFilter },
      include: { company: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ]);

  return (
    <Overview
      demo={false}
      counts={Object.fromEntries(queueCounts.map((row) => [row.queue, row._count._all]))}
      addedThisWeek={addedThisWeek}
      countries={topCountries(countryCounts.map((row) => ({ country: row.country, count: row._count._all })))}
      failedJobs={failedJobs}
      recentLeads={leads.map((lead) => ({
        id: lead.id,
        name: lead.company.name,
        domain: lead.company.domain,
        queue: lead.queue,
      }))}
      recentJobs={jobs.map((job) => ({
        id: job.id,
        title: jobTypeLabel(job.type),
        when: job.createdAt.toLocaleString(),
        status: job.status,
        error: job.lastError,
        action: job.status === 'failed' ? failedJobAction(job.type) : undefined,
      }))}
    />
  );
}
