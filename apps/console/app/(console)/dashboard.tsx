'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CountryBars, type CountryCount } from '@/components/country-bars';
import { EmptyState } from '@/components/empty-state';
import { JobTimeline, type TimelineJob } from '@/components/job-timeline';
import { MetricCard, type MetricPill } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { QueueDonut } from '@/components/queue-donut';
import { ServiceHealth } from '@/components/service-health';
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
type ScheduleGroup = { country: string; timesPerDay: number };

function lastRunCard(run: Run | undefined): { value: number | string; hint: string; pill: MetricPill } {
  if (!run) return { value: '—', hint: 'No discovery runs yet', pill: { label: 'Run now →', tone: 'blue', href: '/discover' } };
  if (run.status === 'done') {
    return {
      value: run.saved,
      hint: `Saved · ${run.found} found · ${run.skipped} skipped`,
      pill: { label: 'Done', tone: 'green', href: '/jobs' },
    };
  }
  if (run.status === 'failed') {
    return { value: run.saved, hint: run.error || `${run.country} · run failed`, pill: { label: 'Failed', tone: 'red', href: '/jobs' } };
  }
  if (run.status === 'running') {
    return { value: run.saved, hint: `${run.country} · in progress`, pill: { label: 'Running', tone: 'blue', href: '/jobs' } };
  }
  return { value: run.saved, hint: `${run.country} · waiting for worker`, pill: { label: 'Pending', tone: 'amber', href: '/jobs' } };
}

export default function Dashboard() {
  const [counts, setCounts] = useState<Counts>({});
  const [leads, setLeads] = useState<Lead[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [schedules, setSchedules] = useState<ScheduleGroup[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/v1/leads/counts', { cache: 'no-store' }),
      fetch('/api/v1/leads?pageSize=5', { cache: 'no-store' }),
      fetch('/api/v1/schedules/runs?limit=5', { cache: 'no-store' }),
      fetch('/api/v1/schedules', { cache: 'no-store' }).catch(() => null),
    ])
      .then(async ([countsResponse, leadsResponse, runsResponse, schedulesResponse]) => {
        const countsData = await countsResponse.json();
        const leadsData = await leadsResponse.json();
        const runsData = await runsResponse.json();
        const schedulesData = schedulesResponse?.ok ? await schedulesResponse.json().catch(() => null) : null;
        if (!countsResponse.ok) throw new Error(countsData.error?.message || 'Could not load lead counts');
        if (!leadsResponse.ok) throw new Error(leadsData.error?.message || 'Could not load recent leads');
        if (!runsResponse.ok) throw new Error(runsData.error?.message || 'Could not load recent discovery runs');
        if (cancelled) return;
        setCounts(countsData as Counts);
        setLeads(Array.isArray(leadsData.items) ? leadsData.items : []);
        setRuns(Array.isArray(runsData.runs) ? runsData.runs : []);
        setSchedules(Array.isArray(schedulesData?.countries) ? schedulesData.countries : null);
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

  const qualified = counts.QUALIFIED || 0;
  const pending = counts.PENDING_AUDIT || 0;
  const review = counts.NEEDS_REVIEW || 0;
  const inactive = counts.INACTIVE || 0;
  const attention = review + inactive;
  const qualifyRate = total ? Math.round((qualified / total) * 100) : 0;
  const runsPerDay = (schedules || []).reduce((sum, group) => sum + (group.timesPerDay || 0), 0);
  const scheduledCountries = (schedules || []).length;
  const lastRun = lastRunCard(runs[0]);

  return (
    <main>
      <PageHeader
        title="Overview"
        description="Live leads, discovery activity, and service status."
        action={<Link href="/discover" className="btn">Start Discover</Link>}
      />
      <ServiceHealth />
      {error ? <p className="notice error" role="alert">{error}</p> : null}
      <div className="metric-grid">
        <MetricCard
          label="Total Leads"
          value={total}
          hint="All queues"
          icon="users"
          tone="blue"
          loading={loading}
          pill={{ label: 'View all →', tone: 'blue', href: '/leads?queue=ALL' }}
        />
        <MetricCard
          label="Qualified"
          value={qualified}
          hint={`${qualifyRate}% of all leads`}
          icon="check"
          tone="green"
          loading={loading}
          pill={{ label: 'Sales ready', tone: 'green', href: '/leads?queue=QUALIFIED' }}
        />
        <MetricCard
          label="Pending Audit"
          value={pending}
          hint="Waiting for website check"
          icon="jobs"
          tone="amber"
          loading={loading}
          pill={
            pending
              ? { label: 'In progress', tone: 'amber', href: '/leads?queue=PENDING_AUDIT' }
              : { label: 'Up to date', tone: 'green', href: '/leads?queue=PENDING_AUDIT' }
          }
        />
        <MetricCard
          label="Daily Schedules"
          value={schedules ? runsPerDay : '—'}
          hint={
            !schedules
              ? 'Could not load schedules'
              : runsPerDay
                ? `Runs per day · ${scheduledCountries} ${scheduledCountries === 1 ? 'country' : 'countries'}`
                : 'No daily runs yet'
          }
          icon="calendar"
          tone="violet"
          loading={loading}
          pill={{ label: runsPerDay ? 'Edit times →' : 'Add schedule →', tone: 'violet', href: '/jobs' }}
        />
        <MetricCard
          label="Last Discovery Run"
          value={lastRun.value}
          hint={lastRun.hint}
          icon="discover"
          tone="teal"
          loading={loading}
          pill={lastRun.pill}
        />
        <MetricCard
          label="Needs Attention"
          value={attention}
          hint={`${review} review · ${inactive} inactive`}
          icon="info"
          tone="red"
          loading={loading}
          pill={
            attention
              ? { label: 'Needs Review', tone: 'red', href: review ? '/leads?queue=NEEDS_REVIEW' : '/leads?queue=INACTIVE' }
              : { label: 'All clear', tone: 'green' }
          }
        />
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
