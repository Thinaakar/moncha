'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CalendarClock, CalendarPlus, Clock, History, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/misc';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState, ErrorState, InlineAlert, TableSkeleton } from '@/components/app/states';
import { JobStatusBadge } from '@/components/app/status';
import { useCanEdit } from '@/components/app/user-context';
import { api, errorMessage } from '@/lib/api';
import { CrawlCopiesCell } from '@/components/sites/automation';
import {
  useApiMutation,
  useCrawlPipeline,
  useDiscoveryOptions,
  useScheduleRuns,
  useSchedules,
  useSiteAutomationCrawls,
} from '@/lib/queries';
import { formatDateTime, formatDuration, formatNumber, formatRelative, humanize } from '@/lib/format';
import type { CrawlPipelineSettingsView, Schedule, ScheduleGroup } from '@/lib/types';
import { cn } from '@/lib/utils';
import { AddScheduleDialog } from './add-schedule-dialog';

type PendingDelete = { kind: 'one'; schedule: Schedule } | { kind: 'country'; group: ScheduleGroup };

/** How the central crawl settings shape every scheduled run (mirrors the worker's enqueueDueSchedules). */
function CrawlSettingsNotice({ settings, countryNames }: { settings: CrawlPipelineSettingsView; countryNames: Map<string, string> }) {
  const searches = Math.max(1, Math.ceil((settings.crawlBatchSize || 20) / 20));
  const pages = Math.min(3, Math.max(1, settings.maxPagesPerSearch || 3));
  const target = countryNames.get(settings.targetCountry) ?? settings.targetCountry;
  return (
    <InlineAlert
      variant={settings.active ? 'info' : 'warning'}
      icon={SlidersHorizontal}
      title={settings.active ? 'Crawl & Pipeline Settings control scheduled crawls' : 'Engine paused: scheduled crawls are skipped'}
    >
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        <li>
          {settings.active
            ? 'Each schedule crawls its own country at its time while the engine is on.'
            : 'While the engine is off, each due run is skipped and moves to its next time. Skipped runs are not made up later.'}
        </li>
        <li>
          A run is skipped once today&apos;s Max Daily Crawl Runs ({formatNumber(settings.maxDailyCrawlRuns)}, UTC day,
          every trigger counted) is used.
        </li>
        <li>
          Size of each run: Crawl Batch Size {formatNumber(settings.crawlBatchSize)} ({searches} search
          {searches === 1 ? '' : 'es'}), up to {pages} page{pages === 1 ? '' : 's'} per search.
        </li>
        <li>
          Industries: the schedule&apos;s own, otherwise{' '}
          {settings.targetIndustries.length ? `the ${settings.targetIndustries.length} target industries` : 'all standard industries'}.
        </li>
        <li>
          Cities: {settings.targetCities.length ? `the ${settings.targetCities.length} target cities` : 'all cities'} for{' '}
          {target}; all cities for other countries.
        </li>
      </ul>
      <Link href="/crawl-settings" className="mt-2 inline-block font-medium text-primary hover:underline">
        Open Crawl & Pipeline Settings
      </Link>
    </InlineAlert>
  );
}

function ScheduleGroupCard({
  group,
  canEdit,
  paused,
  onAdd,
  onDelete,
}: {
  group: ScheduleGroup;
  canEdit: boolean;
  paused: boolean;
  onAdd: () => void;
  onDelete: (target: PendingDelete) => void;
}) {
  const next = [...group.schedules].sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt))[0];
  return (
    <Card>
      <CardHeader className="flex-row items-start">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
            {group.countryCode}
          </span>
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              {group.country}
              {paused && (
                <Badge variant="warning" dot>
                  Paused
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              {group.timesPerDay} run{group.timesPerDay === 1 ? '' : 's'} per day
            </CardDescription>
          </div>
        </div>
        {canEdit && (
          <CardAction>
            <Button variant="ghost" size="icon-sm" onClick={onAdd} aria-label={`Add time for ${group.country}`}>
              <Plus />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onDelete({ kind: 'country', group })}
              aria-label={`Delete all ${group.country} schedules`}
            >
              <Trash2 />
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {group.schedules.map((s) => (
            <span
              key={s.id}
              className="group inline-flex items-center gap-1.5 rounded-md border bg-muted/40 py-1 pr-1 pl-2.5 text-sm font-medium tabular-nums"
            >
              <Clock className="size-3.5 text-muted-foreground" />
              {s.time}
              <span className="text-xs font-normal text-muted-foreground">{s.timezone.split('/').pop()?.replace(/_/g, ' ')}</span>
              {s.industries && s.industries.length > 0 && (
                <span className="rounded border bg-background/80 px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                  {s.industries.length} industries
                </span>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onDelete({ kind: 'one', schedule: s })}
                  className="rounded p-0.5 text-muted-foreground opacity-60 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  aria-label={`Delete ${s.time} schedule`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </span>
          ))}
        </div>
        {next && (
          <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-xs">
            <span className="text-muted-foreground">{paused ? 'Next slot (skipped while paused)' : 'Next run'}</span>
            <span className={cn('font-medium', paused && 'text-muted-foreground line-through')}>
              {humanize(next.nextRunDay)} at {next.time} · {formatRelative(next.nextRunAt)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function SchedulesView() {
  const canEdit = useCanEdit();
  const schedules = useSchedules();
  const pipeline = useCrawlPipeline();
  const crawlSettings = pipeline.data?.settings;
  const paused = crawlSettings ? !crawlSettings.active : false;
  const options = useDiscoveryOptions();
  const countryNames = new Map((options.data?.countries ?? []).map((c) => [c.code, c.name]));
  const runs = useScheduleRuns(50);
  const crawls = useSiteAutomationCrawls(100);
  const copiesByRun = new Map((crawls.data ?? []).map((c) => [c.crawlJobId, c]));
  const [addOpen, setAddOpen] = useState(false);
  const [addCountry, setAddCountry] = useState<string | undefined>();
  const [pending, setPending] = useState<PendingDelete | null>(null);

  const remove = useApiMutation(
    (target: PendingDelete) =>
      target.kind === 'one'
        ? api(`schedules/${target.schedule.id}`, { method: 'DELETE' })
        : api('schedules', { method: 'DELETE', query: { country: target.group.countryCode } }),
    [['schedules']],
  );

  function openAdd(country?: string) {
    setAddCountry(country);
    setAddOpen(true);
  }

  async function confirmDelete() {
    if (!pending) return;
    try {
      await remove.mutateAsync(pending);
      toast.success(pending.kind === 'one' ? 'Schedule removed' : `All ${pending.group.country} schedules removed`);
    } catch (err) {
      toast.error('Could not delete', { description: errorMessage(err) });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Target region schedule"
        description="Daily country crawls at a fixed local time. Each run spends a capped number of API calls and picks up where the last one stopped."
        actions={
          <div className="flex items-center gap-3">
            {crawlSettings &&
              (paused ? (
                <Badge variant="warning" dot>
                  Engine paused
                </Badge>
              ) : (
                <Badge variant="success" dot>
                  Engine on
                </Badge>
              ))}
            {canEdit && (
              <Button onClick={() => openAdd()}>
                <CalendarPlus /> Add schedule
              </Button>
            )}
          </div>
        }
        className="pb-0"
      />

      {crawlSettings && <CrawlSettingsNotice settings={crawlSettings} countryNames={countryNames} />}

      <section>
        {schedules.error ? (
          <Card>
            <ErrorState error={schedules.error} onRetry={() => schedules.refetch()} />
          </Card>
        ) : schedules.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-44" />
            ))}
          </div>
        ) : !schedules.data?.length ? (
          <Card className="border-dashed">
            <EmptyState
              icon={CalendarClock}
              title="No schedules yet"
              description="Add a daily time for a country and the worker will crawl it automatically."
              action={
                canEdit && (
                  <Button onClick={() => openAdd()}>
                    <CalendarPlus /> Add your first schedule
                  </Button>
                )
              }
            />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {schedules.data.map((group) => (
              <ScheduleGroupCard
                key={group.countryCode}
                group={group}
                canEdit={canEdit}
                paused={paused}
                onAdd={() => openAdd(group.countryCode)}
                onDelete={setPending}
              />
            ))}
          </div>
        )}
      </section>

      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <History className="size-4 text-primary" /> Run history
          </CardTitle>
          <CardDescription>The last 50 scheduled and manual country crawls</CardDescription>
        </CardHeader>
        {runs.error ? (
          <ErrorState error={runs.error} onRetry={() => runs.refetch()} />
        ) : runs.isLoading ? (
          <TableSkeleton rows={5} columns={7} />
        ) : !runs.data?.length ? (
          <EmptyState icon={History} title="No runs yet" description="Runs appear here once a schedule fires or you start a crawl." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Day</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Found</TableHead>
                <TableHead className="text-right">Saved</TableHead>
                <TableHead className="text-right">Skipped</TableHead>
                <TableHead>
                  <Tooltip content="Website copies the automation queued for this crawl's new qualified leads">
                    <span>Copies</span>
                  </Tooltip>
                </TableHead>
                <TableHead>Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.data.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <div className="font-medium">{run.day}</div>
                    <div className="text-xs text-muted-foreground">
                      {run.time} {run.timezone.split('/').pop()?.replace(/_/g, ' ')}
                    </div>
                  </TableCell>
                  <TableCell>{run.country || run.countryCode}</TableCell>
                  <TableCell>
                    <Badge variant={run.trigger === 'schedule' ? 'default' : 'secondary'}>{humanize(run.trigger)}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    <JobStatusBadge status={run.status} />
                    {run.error && (
                      <Tooltip content={run.error}>
                        <span className="mt-1 block truncate text-xs text-destructive">{run.error}</span>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(run.found)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatNumber(run.saved)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(run.skipped)}</TableCell>
                  <TableCell>
                    <CrawlCopiesCell crawl={copiesByRun.get(run.id)} finished={run.status === 'done' || run.status === 'failed'} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <Tooltip content={`Started ${formatDateTime(run.startedAt)}`}>
                      <span>{formatDuration(run.startedAt, run.finishedAt)}</span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <AddScheduleDialog open={addOpen} onOpenChange={setAddOpen} defaultCountry={addCountry} />

      <AlertDialog open={Boolean(pending)} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === 'country' ? `Delete all ${pending.group.country} schedules?` : 'Delete this schedule?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === 'country'
                ? `${pending.group.timesPerDay} daily run${pending.group.timesPerDay === 1 ? '' : 's'} will stop. Past run history is kept.`
                : pending?.kind === 'one'
                  ? `The daily ${pending.schedule.country} crawl at ${pending.schedule.time} will stop. Past run history is kept.`
                  : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={remove.isPending}
            >
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
