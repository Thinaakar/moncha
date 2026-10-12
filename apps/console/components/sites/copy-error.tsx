'use client';

import { AlertTriangle, RotateCcw } from 'lucide-react';
import { failureText, isPermanentFailure } from '@/components/sites/labels';
import type { SiteSnapshotSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

type CopyErrorSnapshot = Pick<SiteSnapshotSummary, 'status' | 'failureReason' | 'failureDetail' | 'attempts'>;

/** "after 3 attempts" / "after 1 attempt"; empty when the API did not say. */
function attemptsText(attempts: number | undefined) {
  return attempts ? `after ${attempts} attempt${attempts === 1 ? '' : 's'}` : '';
}

/** One line about the attempts behind a failure, e.g. "Failed after 3 attempts" or "Not retried: …". */
export function copyAttemptsSummary(snapshot: CopyErrorSnapshot) {
  if (snapshot.failureReason === 'cancelled') return null;
  if (snapshot.status === 'failed') {
    if (isPermanentFailure(snapshot.failureReason) && (snapshot.attempts ?? 1) <= 1) {
      return 'Not retried: trying again would give the same result';
    }
    return `Failed ${attemptsText(snapshot.attempts)}`.trim();
  }
  if (snapshot.failureReason && (snapshot.status === 'pending' || snapshot.status === 'running')) {
    return snapshot.attempts ? `Attempt ${snapshot.attempts} failed, retrying` : 'Last attempt failed, retrying';
  }
  return null;
}

/**
 * Why a website copy failed (or why its last attempt failed while it waits for a retry): the plain-language
 * reason, the error message behind it and the attempt count. Renders nothing for copies without an error.
 */
export function CopyError({ snapshot, className, clamp = false }: { snapshot: CopyErrorSnapshot; className?: string; clamp?: boolean }) {
  const { status, failureReason, failureDetail } = snapshot;
  if (!failureReason || status === 'done') return null;
  const failed = status === 'failed';
  const cancelled = failureReason === 'cancelled';
  const summary = copyAttemptsSummary(snapshot);
  const Icon = failed ? AlertTriangle : RotateCcw;
  return (
    <div className={cn('min-w-0 space-y-1 text-xs', className)}>
      <p
        className={cn(
          'flex items-start gap-1.5 font-medium',
          cancelled ? 'text-muted-foreground' : failed ? 'text-destructive' : 'text-warning',
        )}
      >
        {!cancelled && <Icon className="mt-px size-3.5 shrink-0" />}
        <span className={cn(clamp && 'line-clamp-2')}>{failureText(failureReason)}</span>
      </p>
      {failureDetail && (
        <p
          className={cn('break-words font-mono text-[11px] leading-snug text-muted-foreground', clamp && 'line-clamp-2')}
          title={failureDetail}
        >
          {failureDetail}
        </p>
      )}
      {summary && <p className="text-muted-foreground">{summary}</p>}
    </div>
  );
}
