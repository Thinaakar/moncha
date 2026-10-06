'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { JobStatusBadge, jobTypeLabel } from '@/components/app/status';
import { CopyButton } from '@/components/app/widgets';
import { useJob } from '@/lib/queries';
import { formatDuration, formatNumber, formatRelative, humanize } from '@/lib/format';
import type { CountryDiscoveryResult } from '@/lib/types';

const STATS: Array<{ key: keyof CountryDiscoveryResult; label: string }> = [
  { key: 'found', label: 'Businesses found' },
  { key: 'created', label: 'New leads' },
  { key: 'duplicates', label: 'Already known' },
  { key: 'auditsEnqueued', label: 'Audits queued' },
  { key: 'searches', label: 'Searches run' },
  { key: 'calls', label: 'API calls' },
  { key: 'noWebsite', label: 'No website' },
  { key: 'failedSearches', label: 'Failed searches' },
];

/** Live view of one background job: status, timing and the result counters. */
export function JobTracker({ jobId, onDismiss }: { jobId: string; onDismiss?: () => void }) {
  const client = useQueryClient();
  const { data: job, error } = useJob(jobId);
  const announced = useRef(false);

  useEffect(() => {
    if (!job || announced.current) return;
    if (job.status === 'done' || job.status === 'failed') {
      announced.current = true;
      void client.invalidateQueries({ queryKey: ['leads'] });
      void client.invalidateQueries({ queryKey: ['schedules'] });
      if (job.status === 'done') toast.success(`${jobTypeLabel(job.type)} finished`);
      else toast.error(`${jobTypeLabel(job.type)} failed`, { description: job.lastError ?? undefined });
    }
  }, [job, client]);

  const result = (job?.result ?? {}) as CountryDiscoveryResult;
  const waiting = job?.status === 'pending' && job.lastError?.startsWith('waiting');

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-start border-b pb-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            {job ? jobTypeLabel(job.type) : 'Job'} {job && <JobStatusBadge status={job.status} />}
          </CardTitle>
          <CardDescription className="flex items-center gap-1 font-mono text-xs">
            {jobId} <CopyButton value={jobId} />
          </CardDescription>
        </div>
        {onDismiss && (
          <CardAction>
            <Button variant="ghost" size="icon-sm" onClick={onDismiss} aria-label="Dismiss">
              <X />
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-sm text-destructive">Could not load job status.</p>
        ) : !job ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : (
          <>
            {(job.status === 'pending' || job.status === 'running') && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
              </div>
            )}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" /> Queued {formatRelative(job.createdAt)}
              </span>
              {job.startedAt && <span>Running time {formatDuration(job.startedAt, job.finishedAt)}</span>}
              {result.country && <span>Country {result.country}</span>}
              {result.stoppedReason && <span>Stopped: {humanize(result.stoppedReason)}</span>}
            </div>
            {waiting && (
              <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">{job.lastError}</p>
            )}
            {job.status === 'failed' && job.lastError && (
              <p className="flex items-start gap-2 rounded-md bg-destructive/8 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {job.lastError}
              </p>
            )}
            {job.result ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {STATS.filter((s) => result[s.key] !== undefined).map((s) => (
                  <div key={s.key} className="rounded-lg border bg-muted/30 px-3 py-2.5">
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className="font-display text-xl font-semibold tabular-nums">{formatNumber(result[s.key] as number)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {job.status === 'pending'
                  ? 'Waiting for the background worker to pick this job up…'
                  : 'Crawling — results appear here when the run finishes.'}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
