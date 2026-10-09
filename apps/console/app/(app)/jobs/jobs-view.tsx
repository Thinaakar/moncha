'use client';

import Link from 'next/link';
import { Activity, AlertTriangle, Cpu, ExternalLink, ListChecks, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogDescription, DialogTitle, SheetContent } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/app/page-header';
import { Pagination } from '@/components/app/pagination';
import { EmptyState, ErrorState, InlineAlert, TableSkeleton } from '@/components/app/states';
import { JOB_TYPES, JobStatusBadge, jobTypeLabel } from '@/components/app/status';
import { CopyButton, DetailRow, JsonView } from '@/components/app/widgets';
import { useJob, useJobs, useWorkerHealth } from '@/lib/queries';
import { useUrlState } from '@/lib/use-url-state';
import { formatBytes, formatDateTime, formatDuration, formatNumber, formatRelative } from '@/lib/format';
import { OriginBadge } from '@/components/sites/automation';
import type { Job, JobStatus, JobType, SiteCopyOrigin, SiteSnapshotJobResult } from '@/lib/types';
import { cn } from '@/lib/utils';

const STATUSES: Array<{ value: JobStatus; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'running', label: 'Running' },
  { value: 'done', label: 'Done' },
  { value: 'failed', label: 'Failed' },
];

function str(value: unknown) {
  return typeof value === 'string' && value ? value : null;
}

/** One-line description of what a job works on, derived from its payload. */
function jobTarget(job: Job): { text: string; href?: string } {
  const p = job.payload ?? {};
  switch (job.type) {
    case 'website_audit':
      return { text: str(p.url)?.replace(/^https?:\/\//, '') ?? '—', href: str(p.leadId) ? `/leads/${p.leadId}` : undefined };
    case 'country_discovery': {
      const country = str(p.country) ?? str(p.countryCode) ?? 'Country';
      const time = str(p.time);
      return { text: p.origin === 'schedule' ? `${country} · scheduled${time ? ` ${time}` : ''}` : country };
    }
    case 'csv_import': {
      const rows = typeof p.rows === 'number' ? p.rows : null;
      return { text: rows === null ? 'CSV file' : `${formatNumber(rows)} rows` };
    }
    case 'site_snapshot':
      return {
        text: str(p.url)?.replace(/^https?:\/\//, '') ?? '—',
        href: str(p.snapshotId) ? `/sites/${p.snapshotId}` : undefined,
      };
    default: {
      const query = str(p.query) ?? str(p.textQuery);
      return { text: query ?? '—' };
    }
  }
}

function SiteSnapshotSummary({ result }: { result: SiteSnapshotJobResult }) {
  if (result.skipped) return null;
  const items = [
    { label: 'Assets', value: formatNumber(result.assetCount) },
    { label: 'Skipped', value: formatNumber(result.skippedAssetCount) },
    { label: 'Size', value: formatBytes(result.totalBytes) },
    { label: 'Brand', value: result.brandSource === 'evidence' ? 'Page data' : result.brandSource ? 'AI' : '—' },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {items.map((i) => (
          <div key={i.label} className="rounded-lg border bg-muted/30 px-3 py-2">
            <p className="text-xs text-muted-foreground">{i.label}</p>
            <p className="text-sm font-semibold tabular-nums">{i.value}</p>
          </div>
        ))}
      </div>
      {result.snapshotId && (
        <Button variant="outline" size="sm" asChild>
          <Link href={`/sites/${result.snapshotId}`}>
            Open website copy <ExternalLink />
          </Link>
        </Button>
      )}
    </div>
  );
}

function WorkerStrip() {
  const { data } = useWorkerHealth();
  if (!data) return null;
  const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);
  const items = [
    { label: 'Worker', value: data.status === 'online' ? 'Online' : 'Offline', tone: data.status === 'online' ? 'text-success' : 'text-destructive' },
    { label: 'Pending jobs', value: formatNumber(sum(data.jobs.pending)) },
    { label: 'Running jobs', value: formatNumber(sum(data.jobs.running)) },
    { label: 'Last heartbeat', value: data.lastSeenAt ? formatRelative(data.lastSeenAt) : 'Never' },
  ];
  return (
    <Card className="mb-6 py-0">
      <CardContent className="grid grid-cols-2 divide-x divide-y px-0 sm:grid-cols-4 sm:divide-y-0">
        {items.map((i) => (
          <div key={i.label} className="px-5 py-4">
            <p className="text-xs text-muted-foreground">{i.label}</p>
            <p className={cn('mt-0.5 font-display text-lg font-semibold tabular-nums', i.tone)}>{i.value}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function JobDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: job, error, isLoading } = useJob(id);
  const target = job ? jobTarget(job) : null;
  return (
    <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
      <div className="flex items-start justify-between gap-3 border-b px-6 py-5">
        <div className="min-w-0 space-y-1">
          <DialogTitle className="flex items-center gap-2 font-display text-lg">
            {job ? jobTypeLabel(job.type) : 'Job'} {job && <JobStatusBadge status={job.status} />}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-1 font-mono text-xs">
            {id} <CopyButton value={id} />
          </DialogDescription>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5 scrollbar-thin">
        {error ? (
          <ErrorState error={error} />
        ) : isLoading || !job ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-6" />
            ))}
          </div>
        ) : (
          <>
            {(job.status === 'pending' || job.status === 'running') && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
              </div>
            )}
            {job.lastError && (
              <InlineAlert
                variant={job.status === 'failed' ? 'destructive' : 'warning'}
                icon={AlertTriangle}
                title={job.status === 'failed' ? 'Failed' : 'Last error'}
              >
                <span className="break-words">{job.lastError}</span>
              </InlineAlert>
            )}
            <dl className="divide-y">
              <DetailRow label="Target">
                {target?.href ? (
                  <Link href={target.href} className="inline-flex items-center gap-1 text-primary hover:underline">
                    {target.text} <ExternalLink className="size-3" />
                  </Link>
                ) : (
                  target?.text
                )}
              </DetailRow>
              <DetailRow label="Created">{formatDateTime(job.createdAt)}</DetailRow>
              <DetailRow label="Run after">{formatDateTime(job.runAfter)}</DetailRow>
              <DetailRow label="Started">{formatDateTime(job.startedAt)}</DetailRow>
              <DetailRow label="Finished">{formatDateTime(job.finishedAt)}</DetailRow>
              <DetailRow label="Duration">{formatDuration(job.startedAt, job.finishedAt)}</DetailRow>
              <DetailRow label="Attempts">
                {job.attempts} of {job.maxAttempts}
              </DetailRow>
            </dl>
            {job.type === 'site_snapshot' && job.result && <SiteSnapshotSummary result={job.result as SiteSnapshotJobResult} />}
            <Separator />
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Result</h3>
              {job.result ? (
                <JsonView value={job.result} />
              ) : (
                <p className="text-sm text-muted-foreground">No result yet.</p>
              )}
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Payload</h3>
              <JsonView value={job.payload ?? {}} />
            </div>
          </>
        )}
      </div>
    </SheetContent>
  );
}

export function JobsView() {
  const url = useUrlState();
  const page = url.getNumber('page', 1);
  const pageSize = url.getNumber('pageSize', 25);
  const type = (url.get('type') || undefined) as JobType | undefined;
  const status = (url.get('status') || undefined) as JobStatus | undefined;
  const origin = type === 'site_snapshot' ? ((url.get('origin') || undefined) as SiteCopyOrigin | undefined) : undefined;
  const selected = url.get('job') || null;
  const jobs = useJobs({ page, pageSize, type, status, origin });
  const filtered = Boolean(type || status || origin);
  const clear = () => url.set({ type: null, status: null, origin: null }, { resetPage: true });

  return (
    <div>
      <PageHeader
        title="Jobs"
        description="Every background task the worker runs: website audits, country crawls, CSV imports and website copies."
      />

      <WorkerStrip />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
          <Select
            value={type ?? 'any'}
            onValueChange={(v) => url.set({ type: v === 'any' ? null : v, origin: null }, { resetPage: true })}
          >
            <SelectTrigger className="sm:w-52">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">All types</SelectItem>
              {JOB_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status ?? 'any'} onValueChange={(v) => url.set({ status: v === 'any' ? null : v }, { resetPage: true })}>
            <SelectTrigger className="sm:w-44">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {type === 'site_snapshot' && (
            <Select value={origin ?? 'any'} onValueChange={(v) => url.set({ origin: v === 'any' ? null : v }, { resetPage: true })}>
              <SelectTrigger className="sm:w-44">
                <SelectValue placeholder="Started by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Automatic and manual</SelectItem>
                <SelectItem value="auto">Automatic</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          )}
          {filtered && (
            <Button variant="ghost" size="sm" onClick={clear}>
              Clear filters
            </Button>
          )}
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground sm:ml-auto">
            <Activity className={cn('size-3.5', jobs.isFetching && 'animate-pulse text-primary')} /> Auto-refreshing
          </span>
        </div>

        {jobs.error ? (
          <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} />
        ) : jobs.isLoading || !jobs.data ? (
          <TableSkeleton rows={8} columns={6} />
        ) : jobs.data.items.length === 0 ? (
          <EmptyState
            icon={filtered ? ListChecks : Cpu}
            title={filtered ? 'No jobs match these filters' : 'No jobs yet'}
            description={
              filtered
                ? 'Try a different type or status.'
                : 'Jobs appear here when you start a crawl, import a CSV or a website audit is queued.'
            }
            action={
              filtered ? (
                <Button variant="outline" onClick={clear}>
                  Clear filters
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/discovery">Start a country crawl</Link>
                </Button>
              )
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Type</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={cn(jobs.isPlaceholderData && 'opacity-60')}>
                {jobs.data.items.map((job) => (
                  <TableRow
                    key={job.id}
                    className="cursor-pointer"
                    data-state={selected === job.id ? 'selected' : undefined}
                    onClick={() => url.set({ job: job.id })}
                  >
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {jobTypeLabel(job.type)}
                        {job.type === 'site_snapshot' && <OriginBadge origin={job.payload?.origin === 'auto' ? 'auto' : 'manual'} />}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-muted-foreground">{jobTarget(job).text}</TableCell>
                    <TableCell>
                      <JobStatusBadge status={job.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {job.attempts}/{job.maxAttempts}
                    </TableCell>
                    <TableCell>
                      <span title={formatDateTime(job.createdAt)}>{formatRelative(job.createdAt)}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{formatDuration(job.startedAt, job.finishedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={jobs.data.page}
              pageSize={jobs.data.pageSize}
              total={jobs.data.total}
              totalPages={jobs.data.totalPages}
              isFetching={jobs.isFetching}
              onPageChange={(p) => url.set({ page: p === 1 ? null : String(p) })}
              onPageSizeChange={(s) => url.set({ pageSize: s === 25 ? null : String(s) }, { resetPage: true })}
            />
          </>
        )}
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(o) => !o && url.set({ job: null })}>
        {selected && <JobDetail id={selected} onClose={() => url.set({ job: null })} />}
      </Dialog>
    </div>
  );
}
