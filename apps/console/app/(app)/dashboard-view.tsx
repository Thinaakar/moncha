'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Hourglass,
  Loader2,
  Radar,
  ScanEye,
  ServerOff,
  UserPlus,
} from 'lucide-react';
import { CrawlCopiesCell, formatEta, OriginBadge } from '@/components/sites/automation';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState, ErrorState, InlineAlert, TableSkeleton } from '@/components/app/states';
import { JobStatusBadge, QUEUES } from '@/components/app/status';
import { StatCard } from '@/components/app/widgets';
import { useUser } from '@/components/app/user-context';
import {
  useQueueCounts,
  useScheduleRuns,
  useSchedules,
  useSiteAutomation,
  useSiteAutomationCrawls,
  useSiteQueue,
  useWorkerHealth,
} from '@/lib/queries';
import { formatDateTime, formatNumber, formatRelative, humanize } from '@/lib/format';
import { cn } from '@/lib/utils';

const QUEUE_COLORS: Record<string, string> = {
  QUALIFIED: 'bg-success',
  PENDING_AUDIT: 'bg-info',
  NEEDS_REVIEW: 'bg-warning',
  HAS_ASSISTANT: 'bg-[#6366f1]',
  NO_WEBSITE: 'bg-muted-foreground/40',
  INACTIVE: 'bg-destructive',
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function PipelineCard() {
  const { data, isLoading, error, refetch } = useQueueCounts();
  const total = data ? QUEUES.reduce((sum, q) => sum + (data[q.value] ?? 0), 0) : 0;
  return (
    <Card>
      <CardHeader className="flex-row items-start">
        <div className="space-y-1">
          <CardTitle>Pipeline distribution</CardTitle>
          <CardDescription>{data ? `${formatNumber(total)} leads across all queues` : 'Where every lead sits right now'}</CardDescription>
        </div>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/leads?queue=ALL">
              View all <ArrowRight />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} className="py-6" />
        ) : isLoading || !data ? (
          <div className="space-y-4">
            <Skeleton className="h-3 w-full rounded-full" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
              {total > 0 &&
                QUEUES.map((q) =>
                  data[q.value] > 0 ? (
                    <div
                      key={q.value}
                      className={cn('h-full transition-all', QUEUE_COLORS[q.value])}
                      style={{ width: `${(data[q.value] / total) * 100}%` }}
                      title={`${q.label}: ${data[q.value]}`}
                    />
                  ) : null,
                )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {QUEUES.map((q) => (
                <Link
                  key={q.value}
                  href={`/leads?queue=${q.value}`}
                  className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition hover:border-border hover:bg-muted/50"
                >
                  <span className={cn('size-2.5 shrink-0 rounded-full', QUEUE_COLORS[q.value])} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-muted-foreground">{q.label}</p>
                    <p className="text-sm font-semibold tabular-nums">
                      {formatNumber(data[q.value])}
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        {total > 0 ? `${Math.round((data[q.value] / total) * 100)}%` : ''}
                      </span>
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecentRunsCard() {
  const { data, isLoading, error, refetch } = useScheduleRuns(8);
  const crawls = useSiteAutomationCrawls(50);
  const copiesByRun = new Map((crawls.data ?? []).map((c) => [c.crawlJobId, c]));
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-start pb-4">
        <div className="space-y-1">
          <CardTitle>Recent crawl runs</CardTitle>
          <CardDescription>Scheduled and manual country crawls</CardDescription>
        </div>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/schedules">
              History <ArrowRight />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} className="py-8" />
      ) : isLoading ? (
        <TableSkeleton rows={4} columns={4} />
      ) : !data?.length ? (
        <EmptyState
          icon={Radar}
          title="No crawls yet"
          description="Start a country crawl or add a daily schedule to begin discovering businesses."
          action={
            <Button size="sm" asChild>
              <Link href="/discovery">Start a crawl</Link>
            </Button>
          }
          className="py-10"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Country</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Found</TableHead>
              <TableHead className="text-right">Saved</TableHead>
              <TableHead>Copies</TableHead>
              <TableHead>Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((run) => (
              <TableRow key={run.id}>
                <TableCell>
                  <div className="font-medium">{run.country || run.countryCode}</div>
                  <div className="text-xs text-muted-foreground capitalize">
                    {run.trigger} · {run.time}
                  </div>
                </TableCell>
                <TableCell>
                  <JobStatusBadge status={run.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(run.found)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatNumber(run.saved)}</TableCell>
                <TableCell>
                  <CrawlCopiesCell crawl={copiesByRun.get(run.id)} finished={run.status === 'done' || run.status === 'failed'} />
                </TableCell>
                <TableCell className="text-muted-foreground">{formatRelative(run.startedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function QueueActivityCard() {
  const { data, isLoading } = useWorkerHealth();
  const rows = [
    { key: 'website_audit', label: 'Website audits' },
    { key: 'country_discovery', label: 'Country crawls' },
    { key: 'csv_import', label: 'CSV imports' },
    { key: 'site_snapshot', label: 'Website copies' },
  ] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Job queue</CardTitle>
        <CardDescription>Work waiting for the background worker</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading || !data
          ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10" />)
          : rows.map((row) => {
              const running = data.jobs.running[row.key] ?? 0;
              const pending = data.jobs.pending[row.key] ?? 0;
              return (
                <div key={row.key} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
                  <span className="font-medium">{row.label}</span>
                  <span className="flex items-center gap-3 text-xs tabular-nums">
                    <span className={cn(running > 0 ? 'text-info' : 'text-muted-foreground')}>{running} running</span>
                    <span className="text-muted-foreground">{pending} queued</span>
                  </span>
                </div>
              );
            })}
        <Button variant="outline" size="sm" className="w-full" asChild>
          <Link href="/jobs">Open job monitor</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function WebsiteCopiesCard() {
  const queue = useSiteQueue();
  const automation = useSiteAutomation();
  const q = queue.data;
  const a = automation.data;
  const current = q?.running[0];
  const next = q?.waiting.slice(0, 3) ?? [];
  const usedPct = a && a.today.cap > 0 ? Math.min(100, (a.today.used / a.today.cap) * 100) : 0;
  return (
    <Card>
      <CardHeader className="flex-row items-start">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <ScanEye className="size-4 text-primary" /> Website copies
          </CardTitle>
          <CardDescription>{q ? `${q.running.length} copying · ${q.waiting.length} waiting` : 'The copy queue'}</CardDescription>
        </div>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/sites?tab=queue">
              Queue <ArrowRight />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {queue.isLoading || automation.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-8" />
          </div>
        ) : (
          <>
            {current ? (
              <Link
                href={`/sites/${current.id}`}
                className="flex items-center gap-3 rounded-lg border border-info/30 bg-info/[0.05] px-3 py-2.5 transition hover:border-info/50"
              >
                <Loader2 className="size-4 shrink-0 animate-spin text-info" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{current.company?.name ?? 'Copying…'}</p>
                  <p className="text-xs text-muted-foreground">Done {formatEta(current.estimatedAt)}</p>
                </div>
                <OriginBadge origin={current.origin} />
              </Link>
            ) : (
              <p className="rounded-lg border border-dashed px-3 py-3 text-center text-sm text-muted-foreground">Nothing copying right now</p>
            )}
            {next.length > 0 && (
              <ul className="space-y-1.5">
                {next.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 text-sm">
                    <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">
                      {item.position}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.company?.name ?? item.sourceUrl}</span>
                    <span className="text-xs text-muted-foreground">{formatEta(item.estimatedAt)}</span>
                  </li>
                ))}
                {q && q.waiting.length > next.length && (
                  <li className="pl-7 text-xs text-muted-foreground">+{q.waiting.length - next.length} more</li>
                )}
              </ul>
            )}
            {a && (
              <Link href="/sites?tab=automation" className="block rounded-lg bg-muted/50 px-3 py-2.5 transition hover:bg-muted">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-medium">
                    <span className={cn('size-2 rounded-full', a.enabled ? 'bg-success' : 'bg-muted-foreground/40')} />
                    Automation {a.enabled ? 'on' : 'off'}
                  </span>
                  {a.enabled && (
                    <span className="tabular-nums text-muted-foreground">
                      {a.today.used} / {a.today.cap} today
                    </span>
                  )}
                </div>
                {a.enabled && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${usedPct}%` }} />
                  </div>
                )}
                {a.enabled && a.carriedOver > 0 && (
                  <p className="mt-1.5 text-xs text-warning">{a.carriedOver} qualified leads wait for tomorrow</p>
                )}
              </Link>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function UpcomingCard() {
  const { data, isLoading } = useSchedules();
  const upcoming = (data ?? [])
    .flatMap((g) => g.schedules)
    .sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt))
    .slice(0, 4);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming crawls</CardTitle>
        <CardDescription>Next scheduled country runs</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-11" />)
        ) : upcoming.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No schedules yet.{' '}
            <Link href="/schedules" className="font-medium text-primary hover:underline">
              Add one
            </Link>
          </div>
        ) : (
          upcoming.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
                {s.countryCode}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {s.country} · {s.time}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {humanize(s.nextRunDay)} · {formatDateTime(s.nextRunAt)}
                </p>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardView() {
  const { user } = useUser();
  const counts = useQueueCounts();
  const worker = useWorkerHealth();
  const c = counts.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting()}, ${user.name?.split(' ')[0] || user.email.split('@')[0]}`}
        description="Here is the state of your lead pipeline."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/leads/new">
                <UserPlus /> Add lead
              </Link>
            </Button>
            <Button asChild>
              <Link href="/discovery">
                <Radar /> Start crawl
              </Link>
            </Button>
          </>
        }
        className="pb-0"
      />

      {worker.data && !worker.data.running && (
        <InlineAlert variant="warning" icon={ServerOff} title="Background worker is offline">
          {worker.data.message}
        </InlineAlert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Qualified leads"
          value={formatNumber(c?.QUALIFIED)}
          hint="No assistant detected"
          icon={CheckCircle2}
          tone="success"
          href="/leads?queue=QUALIFIED"
          loading={counts.isLoading}
        />
        <StatCard
          label="Awaiting review"
          value={formatNumber(c?.openReviewTasks)}
          hint="Uncertain audits for a human"
          icon={ClipboardCheck}
          tone="warning"
          href="/reviews"
          loading={counts.isLoading}
        />
        <StatCard
          label="Pending audit"
          value={formatNumber(c?.PENDING_AUDIT)}
          hint="Queued for website checks"
          icon={Hourglass}
          tone="info"
          href="/leads?queue=PENDING_AUDIT"
          loading={counts.isLoading}
        />
        <StatCard
          label="Already have assistant"
          value={formatNumber(c?.HAS_ASSISTANT)}
          hint="Chatbot or live chat found"
          icon={Bot}
          tone="muted"
          href="/leads?queue=HAS_ASSISTANT"
          loading={counts.isLoading}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <PipelineCard />
          <RecentRunsCard />
        </div>
        <div className="space-y-6">
          <QueueActivityCard />
          <WebsiteCopiesCard />
          <UpcomingCard />
          <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/[0.07] to-transparent">
            <CardContent className="space-y-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <CalendarClock className="size-[18px]" />
              </span>
              <div>
                <p className="font-semibold">Automate discovery</p>
                <p className="text-sm text-muted-foreground">
                  Daily schedules crawl a slice of each country so new businesses keep flowing in.
                </p>
              </div>
              <Button size="sm" variant="outline" asChild>
                <Link href="/schedules">Manage schedules</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
