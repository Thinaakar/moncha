'use client';

import Link from 'next/link';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Gauge, Radar, RotateCcw, ScanEye, Sparkles, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch, Tooltip } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, InlineAlert, TableSkeleton } from '@/components/app/states';
import { useCanEdit } from '@/components/app/user-context';
import { CRAWL_COPY_STATUS } from '@/components/sites/automation';
import { useSiteAutomation, useSiteAutomationCrawls, useSiteQueue, useUpdateSiteAutomation } from '@/lib/queries';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatNumber, formatRelative, humanize } from '@/lib/format';
import type { SiteAutomationCrawl, SiteAutomationState } from '@/lib/types';
import { cn } from '@/lib/utils';

const STEPS = [
  { icon: Radar, title: 'A country crawl finishes', text: 'Scheduled and manual crawls both count. CSV imports and single leads do not.' },
  { icon: Clock, title: 'Its website audits finish', text: 'The automation waits for the audits the crawl started, for up to 3 hours.' },
  {
    icon: Sparkles,
    title: 'Every qualified lead is queued',
    text: 'All leads with no assistant and no earlier copy join the queue, first in, first out. There is no daily limit.',
  },
  {
    icon: RotateCcw,
    title: 'Up to 3 attempts per copy',
    text: 'A failed copy is retried up to 3 times. If it still fails, the error shows in All copies.',
  },
];

function TodayCard({ state }: { state: SiteAutomationState }) {
  const queue = useSiteQueue();
  const waiting = queue.data?.waiting.filter((w) => w.origin === 'auto').length;
  const stats = [
    { label: 'Queued today', value: formatNumber(state.today.used), hint: 'Automatic copies since 00:00 UTC' },
    { label: 'Waiting in the queue', value: formatNumber(waiting), hint: 'Automatic copies not started yet' },
    { label: 'Crawls waiting for audits', value: formatNumber(state.waitingCrawls), hint: 'Their leads are queued when audits finish' },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4 text-primary" /> Today
        </CardTitle>
        <CardDescription>Every qualified lead from a finished crawl is queued; nothing waits for tomorrow.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">{s.label}</p>
              <p className="text-xs text-muted-foreground">{s.hint}</p>
            </div>
            <p className="font-display text-xl font-semibold tabular-nums">{s.value}</p>
          </div>
        ))}
        <Button variant="outline" size="sm" className="w-full" asChild>
          <Link href="/sites?status=failed&origin=auto">
            <AlertTriangle /> See failed automatic copies
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function SettingsCard({ state }: { state: SiteAutomationState }) {
  const canEdit = useCanEdit();
  const update = useUpdateSiteAutomation();

  async function save(input: { enabled: boolean }) {
    try {
      const next = await update.mutateAsync(input);
      toast.success(next.enabled ? 'Copy automation is on' : 'Copy automation is off', {
        description: next.enabled ? 'Crawls that finish from now on will queue website copies.' : 'Copies already queued still run.',
      });
    } catch (e) {
      toast.error('Could not save', { description: errorMessage(e) });
    }
  }

  const blocked = !state.agentReady || !state.workerEnabled;

  return (
    <Card>
      <CardHeader className="flex-row items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Workflow className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <CardTitle className="flex items-center gap-2">
            Automatic website copies
            {state.enabled ? (
              <Badge variant={blocked ? 'warning' : 'success'} dot>
                {blocked ? 'On, but paused' : 'On'}
              </Badge>
            ) : (
              <Badge variant="muted" dot>
                Off
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            After each country crawl, copy the homepages of its new qualified leads so demos are ready without clicking.
          </CardDescription>
        </div>
        <Tooltip content={canEdit ? (state.enabled ? 'Turn off' : 'Turn on') : 'Viewers cannot change this'}>
          <span>
            <Switch
              checked={state.enabled}
              disabled={!canEdit || update.isPending}
              onCheckedChange={(enabled) => void save({ enabled })}
              aria-label="Automatic website copies"
            />
          </span>
        </Tooltip>
      </CardHeader>
      <CardContent className="space-y-5">
        {!state.agentReady && (
          <InlineAlert variant="destructive" icon={AlertTriangle} title="Website copies are not set up on the worker">
            The worker needs its R2 storage keys and preview secret before it can make copies. Nothing is queued until then.
          </InlineAlert>
        )}
        {state.agentReady && !state.workerEnabled && (
          <InlineAlert variant="warning" icon={AlertTriangle} title="Turned off on the worker">
            The worker runs with SITE_AUTO_COPY=false, so the automation is paused whatever this switch says.
          </InlineAlert>
        )}

        <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <step.icon className="size-4 text-muted-foreground" />
              </div>
              <p className="mt-2 text-sm font-medium">{step.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{step.text}</p>
            </li>
          ))}
        </ol>
      </CardContent>
      <CardFooter className="flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>
          Each lead is copied automatically at most once. Leads that already have a copy are skipped.
        </span>
        {state.enabledAt && state.enabled && <span>On since {formatDateTime(state.enabledAt)}</span>}
        {state.updatedBy && state.updatedAt && (
          <span>
            Last changed by {state.updatedBy} {formatRelative(state.updatedAt)}
          </span>
        )}
      </CardFooter>
    </Card>
  );
}

function CopyProgress({ crawl }: { crawl: SiteAutomationCrawl }) {
  const { done, running, pending, failed } = crawl.copies;
  const total = done + running + pending + failed;
  if (total === 0) return <span className="text-xs text-muted-foreground">—</span>;
  const seg = (n: number, cls: string, label: string) =>
    n > 0 ? <div key={label} className={cn('h-full', cls)} style={{ width: `${(n / total) * 100}%` }} title={`${label}: ${n}`} /> : null;
  return (
    <div className="min-w-32 space-y-1">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {seg(done, 'bg-success', 'Done')}
        {seg(running, 'bg-info', 'Running')}
        {seg(pending, 'bg-muted-foreground/40', 'Waiting')}
        {seg(failed, 'bg-destructive', 'Failed')}
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {done} done
        {running ? ` · ${running} running` : ''}
        {pending ? ` · ${pending} waiting` : ''}
        {failed ? ` · ${failed} failed` : ''}
      </p>
    </div>
  );
}

function CrawlsCard() {
  const crawls = useSiteAutomationCrawls(50);
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4 text-primary" /> Recent crawls
        </CardTitle>
        <CardDescription>Crawls the automation picked up and what happened to their qualified leads</CardDescription>
      </CardHeader>
      {crawls.error ? (
        <ErrorState error={crawls.error} onRetry={() => crawls.refetch()} />
      ) : crawls.isLoading ? (
        <TableSkeleton rows={4} columns={6} />
      ) : !crawls.data?.length ? (
        <EmptyState
          icon={Radar}
          title="No crawls picked up yet"
          description="Crawls that finish while the automation is on appear here."
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href="/schedules">Manage schedules</Link>
            </Button>
          }
          className="py-10"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Crawl</TableHead>
              <TableHead>Finished</TableHead>
              <TableHead className="text-right">New leads</TableHead>
              <TableHead>Audits</TableHead>
              <TableHead className="text-right">Qualified</TableHead>
              <TableHead className="text-right">Queued</TableHead>
              <TableHead>Copies</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {crawls.data.map((c) => {
              const meta = CRAWL_COPY_STATUS[c.status];
              const auditsDone = c.auditsTotal - c.auditsPending;
              return (
                <TableRow key={c.crawlJobId}>
                  <TableCell>
                    <Link href={`/jobs?job=${c.crawlJobId}`} className="font-medium hover:text-primary">
                      {c.country || c.countryCode || 'Country crawl'}
                    </Link>
                    <div className="mt-0.5">
                      <Badge variant={c.trigger === 'schedule' ? 'default' : 'secondary'}>{humanize(c.trigger)}</Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <span title={formatDateTime(c.crawlFinishedAt)}>{formatRelative(c.crawlFinishedAt)}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(c.leadsCreated)}</TableCell>
                  <TableCell>
                    {c.auditsTotal === 0 ? (
                      <span className="text-xs text-muted-foreground">None</span>
                    ) : (
                      <div className="min-w-24 space-y-1">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${(auditsDone / c.auditsTotal) * 100}%` }} />
                        </div>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {formatNumber(auditsDone)} / {formatNumber(c.auditsTotal)}
                        </p>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.status === 'waiting_audits' ? '—' : formatNumber(c.qualified)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className="font-medium">{formatNumber(c.queued)}</span>
                  </TableCell>
                  <TableCell>
                    <CopyProgress crawl={c} />
                  </TableCell>
                  <TableCell>
                    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', meta.tone)}>
                      {c.status === 'complete' ? <CheckCircle2 className="size-3.5" /> : <Clock className="size-3.5" />}
                      {meta.label}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

export function AutomationPanel() {
  const automation = useSiteAutomation();

  if (automation.error) {
    return (
      <Card>
        <ErrorState error={automation.error} onRetry={() => automation.refetch()} />
      </Card>
    );
  }
  if (automation.isLoading || !automation.data) {
    return (
      <div className="grid gap-6 xl:grid-cols-3">
        <Skeleton className="h-80 xl:col-span-2" />
        <Skeleton className="h-80" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SettingsCard state={automation.data} />
        </div>
        <TodayCard state={automation.data} />
      </div>
      <CrawlsCard />
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ScanEye className="size-3.5" /> Queued copies show up in the Queue tab and run one at a time.
      </p>
    </div>
  );
}
