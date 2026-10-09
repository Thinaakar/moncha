'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Globe, Hourglass, ListOrdered, Loader2, RotateCcw, ServerOff, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/misc';
import { EmptyState, ErrorState, InlineAlert, TableSkeleton } from '@/components/app/states';
import { CancelCopyButton } from '@/components/sites/cancel-copy';
import { formatAverage, formatEta, OriginBadge } from '@/components/sites/automation';
import { useSiteQueue, useWorkerHealth } from '@/lib/queries';
import { formatDateTime, formatDuration, formatNumber, formatRelative } from '@/lib/format';
import type { SiteQueueItem } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Re-renders every `ms` so elapsed times and estimates stay current between polls. */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const host = (item: SiteQueueItem) => (item.finalUrl ?? item.sourceUrl).replace(/^https?:\/\//, '').replace(/\/$/, '');

function CompanyCell({ item }: { item: SiteQueueItem }) {
  return (
    <div className="min-w-0">
      <Link href={`/sites/${item.id}`} className="block truncate font-medium text-foreground hover:text-primary">
        {item.company?.name ?? 'Unknown company'}
      </Link>
      <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
        <Globe className="size-3 shrink-0" />
        <span className="truncate">{host(item)}</span>
      </span>
    </div>
  );
}

function SourceCell({ item }: { item: SiteQueueItem }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <OriginBadge origin={item.origin} />
      {item.origin === 'auto' && item.crawlJobId && (
        <Link href={`/jobs?job=${item.crawlJobId}`} className="text-xs text-muted-foreground hover:text-primary hover:underline">
          From crawl
        </Link>
      )}
    </div>
  );
}

function RunningCard({ items, now }: { items: SiteQueueItem[]; now: number }) {
  return (
    <Card className="overflow-hidden border-info/30">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin text-info" /> Copying now
        </CardTitle>
        <CardDescription>The worker makes one website copy at a time.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg border bg-info/[0.04] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <CompanyCell item={item} />
              </div>
              <SourceCell item={item} />
              <div className="grid grid-cols-2 gap-x-6 text-xs sm:text-right">
                <div>
                  <p className="text-muted-foreground">Running for</p>
                  <p className="font-medium tabular-nums">{formatDuration(item.startedAt ?? item.createdAt, new Date(now).toISOString())}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Expected done</p>
                  <p className="font-medium">{formatEta(item.estimatedAt, now)}</p>
                </div>
              </div>
            </div>
            <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-info" />
            </div>
            {item.attempts > 1 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Attempt {item.attempts} of {item.maxAttempts}
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function QueuePanel() {
  const queue = useSiteQueue();
  const worker = useWorkerHealth();
  const now = useNow(5_000);
  const data = queue.data;
  const waiting = data?.waiting ?? [];
  const running = data?.running ?? [];
  const last = waiting.at(-1);
  const clearsAt = last ? new Date(new Date(last.estimatedAt).getTime() + (data?.averageRunMs ?? 0)) : null;
  const autoWaiting = waiting.filter((w) => w.origin === 'auto').length;

  if (queue.error) {
    return (
      <Card>
        <ErrorState error={queue.error} onRetry={() => queue.refetch()} />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {worker.data && !worker.data.running && (running.length > 0 || waiting.length > 0) && (
        <InlineAlert variant="warning" icon={ServerOff} title="The queue is paused">
          The background worker is offline, so no copies are being made. {worker.data.message}
        </InlineAlert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Copying now', value: formatNumber(data ? running.length : undefined), icon: Loader2, tone: 'bg-info/12 text-info' },
          {
            label: 'Waiting',
            value: formatNumber(data ? waiting.length : undefined),
            hint: data ? `${autoWaiting} automatic · ${waiting.length - autoWaiting} manual` : undefined,
            icon: ListOrdered,
            tone: 'bg-primary/10 text-primary',
          },
          {
            label: 'Average copy time',
            value: data ? formatAverage(data.averageRunMs) : '—',
            hint: data ? (data.measured ? 'From the last 20 finished copies' : 'Estimate until copies finish') : undefined,
            icon: Timer,
            tone: 'bg-muted text-muted-foreground',
          },
          {
            label: 'Queue clears',
            value: clearsAt ? formatEta(clearsAt, now).replace(/^in /, '') : data ? 'Empty' : '—',
            hint: clearsAt ? formatDateTime(clearsAt) : undefined,
            icon: Hourglass,
            tone: 'bg-success/12 text-success',
          },
        ].map((s) => (
          <div key={s.label} className="flex items-start justify-between gap-3 rounded-xl border bg-card p-5">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{s.label}</p>
              {queue.isLoading ? (
                <div className="mt-2 h-7 w-16 animate-pulse rounded-md bg-muted" />
              ) : (
                <p className="mt-1 font-display text-2xl font-semibold tracking-tight tabular-nums">{s.value}</p>
              )}
              {s.hint && <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>}
            </div>
            <span className={cn('flex size-9 items-center justify-center rounded-lg', s.tone)}>
              <s.icon className="size-[18px]" />
            </span>
          </div>
        ))}
      </div>

      {running.length > 0 && <RunningCard items={running} now={now} />}

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-start pb-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <ListOrdered className="size-4 text-primary" /> Waiting in line
            </CardTitle>
            <CardDescription>First in, first out. Retries wait for their retry time before they run.</CardDescription>
          </div>
          <CardAction>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/jobs?type=site_snapshot">Copy jobs</Link>
            </Button>
          </CardAction>
        </CardHeader>
        {queue.isLoading || !data ? (
          <TableSkeleton rows={4} columns={5} />
        ) : waiting.length === 0 ? (
          <EmptyState
            icon={ListOrdered}
            title={running.length ? 'Nothing else waiting' : 'The queue is empty'}
            description="Copies you start from a lead page, and copies the automation queues after each crawl, line up here."
            action={
              <Button variant="outline" size="sm" asChild>
                <Link href="/sites?tab=automation">Automation settings</Link>
              </Button>
            }
            className="py-10"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-12 text-center">#</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Queued</TableHead>
                <TableHead>Estimated start</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {waiting.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-center">
                    <span
                      className={cn(
                        'inline-flex size-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                        item.position === 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {item.position}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[320px]">
                    <CompanyCell item={item} />
                  </TableCell>
                  <TableCell>
                    <SourceCell item={item} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <span title={formatDateTime(item.createdAt)}>{formatRelative(item.createdAt, now)}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium" title={formatDateTime(item.estimatedAt)}>
                      {item.position === 1 && !item.retrying && running.length === 0 ? 'Next' : formatEta(item.estimatedAt, now)}
                    </span>
                    {item.retrying && (
                      <Tooltip content={item.lastError ?? 'The last attempt failed'}>
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-warning">
                          <RotateCcw className="size-3" /> Retry {item.attempts + 1} of {item.maxAttempts}
                        </span>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <CancelCopyButton snapshotId={item.id} company={item.company?.name} origin={item.origin} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
