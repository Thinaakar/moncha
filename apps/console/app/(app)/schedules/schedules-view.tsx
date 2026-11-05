'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CalendarClock, CalendarPlus, Clock, History, Plus, SlidersHorizontal, Tags, Trash2 } from 'lucide-react';
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
  useDiscoveryIndustries,
  useDiscoveryOptions,
  useScheduleRuns,
  useScheduleSkips,
  useSchedules,
  useSiteAutomationCrawls,
} from '@/lib/queries';
import { formatDateTime, formatDuration, formatNumber, formatRelative, humanize } from '@/lib/format';
import type {
  CrawlPipelineSettingsView,
  Schedule,
  ScheduleEffectiveCrawl,
  ScheduleGroup,
  ScheduleRun,
  ScheduleSkip,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { runsLeftToday } from '../crawl-settings/form';
import { AddScheduleDialog } from './add-schedule-dialog';
import { ScheduleIndustriesDialog } from './schedule-industries-dialog';
import { mergeHistory, SKIP_REASON_LABEL, slotPlanToday, type SlotPlan } from './today-plan';

type PendingDelete = { kind: 'one'; schedule: Schedule } | { kind: 'country'; group: ScheduleGroup };

/** How the central crawl settings shape every scheduled run (mirrors the worker's enqueueDueSchedules). */
function CrawlSettingsNotice({
  settings,
  countryNames,
  runsLeft,
}: {
  settings: CrawlPipelineSettingsView;
  countryNames: Map<string, string>;
  runsLeft: { schedules: number; unreserved: number } | null;
}) {
  const searches = Math.max(1, Math.ceil((settings.crawlBatchSize || 20) / 20));
  const pages = Math.min(3, Math.max(1, settings.maxPagesPerSearch || 3));
  const target = countryNames.get(settings.targetCountry) ?? settings.targetCountry;
  const autoOnly = settings.crawlMode === 'auto_only';
  const reserved = settings.scheduleReservedRuns ?? 0;
  return (
    <InlineAlert
      variant={settings.active && !autoOnly ? 'info' : 'warning'}
      icon={SlidersHorizontal}
      title={
        !settings.active
          ? 'Engine paused: scheduled crawls are skipped'
          : autoOnly
            ? 'Crawl mode is Auto-recrawl only: scheduled crawls are skipped'
            : 'Crawl & Pipeline Settings control scheduled crawls'
      }
    >
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        <li>
          {settings.active && !autoOnly
            ? 'Each schedule crawls its own country at its time while the engine is on.'
            : 'Each due run is skipped and moves to its next time. Skipped runs are not made up later.'}
        </li>
        <li>
          Daily crawl runs: {formatNumber(settings.maxDailyCrawlRuns)} per UTC day, every trigger counted
          {reserved ? `, ${formatNumber(reserved)} reserved for schedules` : ''}.
          {runsLeft ? ` ${formatNumber(runsLeft.schedules)} left today for schedules.` : ''} A run is skipped when none is
          left.
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

function listTooltip(names: string[]) {
  return names.length > 12 ? `${names.slice(0, 12).join(', ')} and ${names.length - 12} more` : names.join(', ');
}

/** What the next run of one schedule crawls, worked out by the worker from the current Crawl settings. */
function EffectiveCrawl({ effective, industryName }: { effective: ScheduleEffectiveCrawl; industryName: (slug: string) => string }) {
  const fromSettings = effective.industriesFrom === 'crawl_settings';
  const industries = effective.industries.length
    ? `${formatNumber(effective.industries.length)} ${fromSettings ? 'target' : 'custom'} industr${effective.industries.length === 1 ? 'y' : 'ies'}`
    : 'all standard industries';
  const cities = effective.cities.length
    ? `${formatNumber(effective.cities.length)} target cit${effective.cities.length === 1 ? 'y' : 'ies'}`
    : 'all cities';
  return (
    <p className="text-xs text-muted-foreground" data-testid="effective-crawl">
      <span className="font-medium text-foreground/80">Next run: </span>
      <Tooltip content={effective.industries.length ? listTooltip(effective.industries.map(industryName)) : industries}>
        <span className="underline decoration-dotted underline-offset-2">{industries}</span>
      </Tooltip>
      {fromSettings ? ' (Crawl settings)' : ' (this schedule)'} ·{' '}
      <Tooltip content={effective.cities.length ? listTooltip(effective.cities) : cities}>
        <span className="underline decoration-dotted underline-offset-2">{cities}</span>
      </Tooltip>{' '}
      · batch {formatNumber(effective.batchSize)} ({formatNumber(effective.maxSearches)} search
      {effective.maxSearches === 1 ? '' : 'es'}, up to {effective.maxPages} page{effective.maxPages === 1 ? '' : 's'})
    </p>
  );
}

function ScheduleGroupCard({
  group,
  canEdit,
  paused,
  industryName,
  onAdd,
  onDelete,
  onEditIndustries,
}: {
  group: ScheduleGroup;
  canEdit: boolean;
  paused: boolean;
  industryName: (slug: string) => string;
  onAdd: () => void;
  onDelete: (target: PendingDelete) => void;
  onEditIndustries: (schedule: Schedule) => void;
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
        <ul className="divide-y rounded-lg border" aria-label={`${group.country} schedules`}>
          {group.schedules.map((s) => {
            const custom = Boolean(s.industries && s.industries.length > 0);
            return (
              <li key={s.id} className="group space-y-1 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium tabular-nums">
                    <Clock className="size-3.5 text-muted-foreground" />
                    {s.time}
                    <span className="text-xs font-normal text-muted-foreground">{zoneCity(s.timezone)}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Badge variant={custom ? 'secondary' : 'muted'} className="text-[10px]">
                      {custom ? `${s.industries!.length} custom industries` : 'Crawl settings industries'}
                    </Badge>
                    {canEdit && (
                      <>
                        <button
                          type="button"
                          onClick={() => onEditIndustries(s)}
                          className="rounded p-0.5 text-muted-foreground opacity-60 transition hover:bg-muted hover:text-foreground group-hover:opacity-100"
                          aria-label={`Change industries for ${s.time} schedule`}
                        >
                          <Tags className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete({ kind: 'one', schedule: s })}
                          className="rounded p-0.5 text-muted-foreground opacity-60 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                          aria-label={`Delete ${s.time} schedule`}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </>
                    )}
                  </span>
                </div>
                {s.effective && <EffectiveCrawl effective={s.effective} industryName={industryName} />}
              </li>
            );
          })}
        </ul>
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

const zoneCity = (timezone: string) => timezone.split('/').pop()?.replace(/_/g, ' ');

function RunHistoryRow({ run, copies }: { run: ScheduleRun; copies: Parameters<typeof CrawlCopiesCell>[0]['crawl'] }) {
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{run.day}</div>
        <div className="text-xs text-muted-foreground">
          {run.time} {zoneCity(run.timezone)}
        </div>
      </TableCell>
      <TableCell>{run.country || run.countryCode}</TableCell>
      <TableCell>
        <Badge variant={run.trigger === 'schedule' ? 'default' : 'secondary'}>
          {run.trigger === 'auto' ? 'Auto-recrawl' : humanize(run.trigger)}
        </Badge>
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
        <CrawlCopiesCell crawl={copies} finished={run.status === 'done' || run.status === 'failed'} />
      </TableCell>
      <TableCell className="text-muted-foreground">
        <Tooltip content={`Started ${formatDateTime(run.startedAt)}`}>
          <span>{formatDuration(run.startedAt, run.finishedAt)}</span>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
}

function SkipHistoryRow({ skip }: { skip: ScheduleSkip }) {
  const label = SKIP_REASON_LABEL[skip.reason];
  return (
    <TableRow className="bg-muted/20">
      <TableCell>
        <div className="font-medium">{skip.day}</div>
        <div className="text-xs text-muted-foreground">
          {skip.time} {zoneCity(skip.timezone)}
        </div>
      </TableCell>
      <TableCell>{skip.country || skip.countryCode}</TableCell>
      <TableCell>
        <Badge variant="default">Schedule</Badge>
      </TableCell>
      <TableCell className="max-w-[220px]">
        <Badge variant="warning">Skipped</Badge>
        <Tooltip content={skip.detail ?? label}>
          <span className="mt-1 block truncate text-xs text-muted-foreground">{label}</span>
        </Tooltip>
      </TableCell>
      {Array.from({ length: 5 }, (_, i) => (
        <TableCell key={i} className={cn('text-muted-foreground', i < 3 && 'text-right')}>
          —
        </TableCell>
      ))}
    </TableRow>
  );
}

const PLAN_BADGE: Record<SlotPlan['status'], { label: string; variant: 'success' | 'warning' | 'info' | 'muted' | 'default' }> = {
  ran: { label: 'Ran', variant: 'success' },
  skipped: { label: 'Skipped', variant: 'warning' },
  will_run: { label: 'Will run', variant: 'info' },
  will_skip: { label: 'Will be skipped', variant: 'warning' },
  no_slot_today: { label: 'Next run tomorrow', variant: 'muted' },
};

/** Every schedule's slot today: ran, skipped (and why), or what will happen with the current settings. */
function TodayPlan({
  schedules,
  runs,
  skips,
  settings,
  scheduleRunsLeft,
}: {
  schedules: Schedule[];
  runs: ScheduleRun[];
  skips: ScheduleSkip[];
  settings: CrawlPipelineSettingsView | undefined;
  scheduleRunsLeft: number;
}) {
  if (!schedules.length) return null;
  const rows = schedules
    .map((schedule) => ({ schedule, plan: slotPlanToday({ schedule, runs, skips, settings, scheduleRunsLeft }) }))
    .sort((a, b) => a.schedule.nextRunAt.localeCompare(b.schedule.nextRunAt));
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4 text-primary" /> Today&apos;s plan
        </CardTitle>
        <CardDescription>
          Each schedule&apos;s slot today in its own time zone. Upcoming slots show what happens with the current Crawl
          settings and today&apos;s run usage.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y" aria-label="Today's plan">
          {rows.map(({ schedule: s, plan }) => {
            const badge = PLAN_BADGE[plan.status];
            const why =
              plan.status === 'skipped' || plan.status === 'will_skip'
                ? SKIP_REASON_LABEL[plan.reason]
                : plan.status === 'ran'
                  ? humanize(plan.run.status)
                  : plan.status === 'no_slot_today'
                    ? `${humanize(s.nextRunDay)} at ${s.time}`
                    : `at ${s.time}`;
            return (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span className="flex items-center gap-2">
                  <span className="font-medium">{s.country}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {s.time} {zoneCity(s.timezone)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{why}</span>
                  <Badge variant={badge.variant} dot>
                    {badge.label}
                  </Badge>
                </span>
              </li>
            );
          })}
        </ul>
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
  const skips = useScheduleSkips(50);
  const crawls = useSiteAutomationCrawls(100);
  const copiesByRun = new Map((crawls.data ?? []).map((c) => [c.crawlJobId, c]));
  const history = mergeHistory(runs.data ?? [], skips.data ?? []).slice(0, 50);
  const progress = pipeline.data?.progress;
  const runsLeft = crawlSettings
    ? runsLeftToday(crawlSettings, { runs: progress?.crawlsRunToday ?? 0, scheduledRuns: progress?.scheduledRunsToday ?? 0 })
    : null;
  const allSchedules = (schedules.data ?? []).flatMap((g) => g.schedules);
  const [addOpen, setAddOpen] = useState(false);
  const [addCountry, setAddCountry] = useState<string | undefined>();
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const industries = useDiscoveryIndustries();
  const industryNames = new Map((industries.data?.industries ?? []).map((i) => [i.slug, i.name]));
  const industryName = (slug: string) => industryNames.get(slug) ?? slug;

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
        description="Where and when to crawl: each schedule is a country and a daily local time. How each run crawls (engine, mode, run limits, batch size, pages, cities and industries) comes from Crawl & Pipeline Settings."
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

      {crawlSettings && (
        <CrawlSettingsNotice settings={crawlSettings} countryNames={countryNames} runsLeft={runsLeft} />
      )}

      <TodayPlan
        schedules={allSchedules}
        runs={runs.data ?? []}
        skips={skips.data ?? []}
        settings={crawlSettings}
        scheduleRunsLeft={runsLeft?.schedules ?? Number.POSITIVE_INFINITY}
      />

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
                industryName={industryName}
                onAdd={() => openAdd(group.countryCode)}
                onDelete={setPending}
                onEditIndustries={setEditing}
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
          <CardDescription>The last 50 country crawls (scheduled, auto-recrawl and manual) and skipped schedule slots</CardDescription>
        </CardHeader>
        {runs.error ? (
          <ErrorState error={runs.error} onRetry={() => runs.refetch()} />
        ) : runs.isLoading ? (
          <TableSkeleton rows={5} columns={7} />
        ) : !history.length ? (
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
              {history.map((entry) =>
                entry.kind === 'skip' ? (
                  <SkipHistoryRow key={`skip-${entry.skip.id}`} skip={entry.skip} />
                ) : (
                  <RunHistoryRow key={entry.run.id} run={entry.run} copies={copiesByRun.get(entry.run.id)} />
                ),
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      <AddScheduleDialog open={addOpen} onOpenChange={setAddOpen} defaultCountry={addCountry} />

      <ScheduleIndustriesDialog
        key={editing?.id ?? 'closed'}
        schedule={editing}
        targetIndustries={crawlSettings?.targetIndustries ?? []}
        onClose={() => setEditing(null)}
      />

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
