'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CountryBars, type CountryCount } from '@/components/country-bars';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { JobTimeline, type TimelineJob } from '@/components/job-timeline';
import { PageHeader } from '@/components/page-header';
import { QueueDonut } from '@/components/queue-donut';
import { ServiceHealth } from '@/components/service-health';
import { StatCard } from '@/components/stat-card';
import { formatStatus, statusChip } from '@/lib/ui';

const QUEUES = [
  { queue: 'QUALIFIED', label: 'Qualified', color: '#22c55e' },
  { queue: 'PENDING_AUDIT', label: 'Pending audit', color: '#d97706' },
  { queue: 'NEEDS_REVIEW', label: 'Needs review', color: '#ea580c' },
  { queue: 'HAS_ASSISTANT', label: 'Has assistant', color: '#dc2626' },
  { queue: 'NO_WEBSITE', label: 'No website', color: '#9ca3af' },
  { queue: 'INACTIVE', label: 'Inactive', color: '#64748b' },
];

type Counts = Record<string, number>;
type Lead = {
  id: string;
  queue: string;
  company?: { name?: string; domain?: string | null; country?: string | null };
};
type Run = {
  id: string;
  country: string;
  trigger: string;
  status: string;
  found: number;
  saved: number;
  skipped: number;
  startedAt: string;
  error?: string | null;
};

export default function Dashboard() {
  const [counts, setCounts] = useState<Counts>({});
  const [leads, setLeads] = useState<Lead[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/v1/leads/counts', { cache: 'no-store' }),
      fetch('/api/v1/leads?pageSize=5', { cache: 'no-store' }),
      fetch('/api/v1/schedules/runs?limit=5', { cache: 'no-store' }),
    ])
      .then(async ([countsResponse, leadsResponse, runsResponse]) => {
        const countsData = await countsResponse.json();
        const leadsData = await leadsResponse.json();
        const runsData = await runsResponse.json();
        if (!countsResponse.ok) throw new Error(countsData.error?.message || 'Could not load lead counts');
        if (!leadsResponse.ok) throw new Error(leadsData.error?.message || 'Could not load recent leads');
        if (!runsResponse.ok) throw new Error(runsData.error?.message || 'Could not load recent discovery runs');
        if (cancelled) return;
        setCounts(countsData as Counts);
        setLeads(Array.isArray(leadsData.items) ? leadsData.items : []);
        setRuns(Array.isArray(runsData.runs) ? runsData.runs : []);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Backend data unavailable');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const slices = QUEUES.map((queue) => ({ ...queue, count: counts[queue.queue] || 0 }));
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  const countryMap = leads.reduce((map, lead) => {
    const country = lead.company?.country;
    if (country) map.set(country, (map.get(country) || 0) + 1);
    return map;
  }, new Map<string, number>());
  const countries: CountryCount[] = [...countryMap].map(([country, count]) => ({ country, count }));
  const recentJobs: TimelineJob[] = runs.map((run) => ({
    id: run.id,
    title: `${run.trigger === 'schedule' ? 'Scheduled' : 'Manual'} discovery · ${run.country}`,
    when: new Date(run.startedAt).toLocaleString(),
    status: run.status,
    detail: `${run.found} found · ${run.saved} saved · ${run.skipped} skipped`,
    error: run.error,
  }));

  return (
    <main>
      <PageHeader
        title="Overview"
        description="Live leads, discovery activity, and service status."
        action={<Link href="/discover" className="btn">Start Discover</Link>}
      />
      <ServiceHealth />
      {error ? <p className="notice error" role="alert">{error}</p> : null}
      <div className="kpi-grid">
        <StatCard label="Total leads" value={loading ? '…' : total} tone="blue" icon={<Icon name="users" />} hint="all queues" href="/leads?queue=ALL" />
        <StatCard label="Qualified" value={loading ? '…' : counts.QUALIFIED || 0} tone="green" icon={<Icon name="check" />} hint="ready to use" href="/leads?queue=QUALIFIED" />
        <StatCard label="Open reviews" value={loading ? '…' : counts.openReviewTasks || 0} tone="amber" icon={<Icon name="percent" />} hint="requiring attention" />
      </div>
      <div className="split-panels chart-panels">
        <section className="card">
          <div className="card-head"><h2>Leads by queue</h2></div>
          {loading ? <p className="muted">Loading counts…</p> : <QueueDonut slices={slices} total={total} />}
        </section>
        <section className="card">
          <div className="card-head"><h2>Countries in latest leads</h2></div>
          {loading ? <p className="muted">Loading leads…</p> : countries.length ? <CountryBars rows={countries} /> : <EmptyState title="No countries yet">Run Discover to find companies.</EmptyState>}
        </section>
      </div>
      <div className="split-panels">
        <section className="card">
          <div className="card-head"><h2>Recent leads</h2><Link href="/leads?queue=ALL">View all</Link></div>
          {loading ? <p className="muted">Loading leads…</p> : leads.length === 0 ? <EmptyState title="No leads yet"><Link href="/discover">Run Discover</Link> to find companies.</EmptyState> : (
            <ul className="mini-list">{leads.map((lead) => (
              <li key={lead.id}>
                <span className="lead-avatar" aria-hidden="true">{(lead.company?.name || '?').charAt(0).toUpperCase()}</span>
                <div className="mini-list-text"><Link href={`/leads/${lead.id}`}>{lead.company?.name || 'Unnamed company'}</Link><span>{lead.company?.domain || 'No website'}</span></div>
                <span className={statusChip(lead.queue)}>{formatStatus(lead.queue)}</span>
              </li>
            ))}</ul>
          )}
        </section>
        <section className="card">
          <div className="card-head"><h2>Recent discovery runs</h2><Link href="/jobs">View schedules</Link></div>
          {loading ? <p className="muted">Loading runs…</p> : recentJobs.length ? <JobTimeline jobs={recentJobs} /> : <EmptyState title="No discovery runs yet">Run Discover or wait for a scheduled run.</EmptyState>}
        </section>
      </div>
    </main>
  );
}
