'use client';

import {
  AlertTriangle,
  Check,
  Clock,
  Code2,
  Download,
  Github,
  Hammer,
  Loader2,
  Radio,
  Rocket,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatEta } from '@/components/sites/automation';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { SiteCopyProgress, SiteCopyStep, SiteCopyStepState } from '@/lib/types';
import { cn } from '@/lib/utils';

export const COPY_STEPS: Record<SiteCopyStep, { label: string; icon: LucideIcon; active: string }> = {
  queued: { label: 'Queued', icon: Clock, active: 'Waiting in the queue' },
  copying: { label: 'Copying website', icon: Download, active: 'Opening the website and downloading its pages and assets' },
  reading_source: { label: 'Viewing source code', icon: Code2, active: 'Reading the source code for the brand, colours and contact details' },
  building: { label: 'Building website', icon: Hammer, active: 'Building the website files and saving them' },
  updating_git: { label: 'Updating Git', icon: Github, active: 'Pushing the website to its own GitHub repository' },
  deploying_url: { label: 'Deploying URL', icon: Rocket, active: 'Deploying the website to its own Cloudflare Worker URL' },
  live: { label: 'Live', icon: Radio, active: 'The website is live' },
};

function badgeFor(progress: SiteCopyProgress): { label: string; variant: BadgeVariant } {
  const label = COPY_STEPS[progress.step].label;
  switch (progress.state) {
    case 'done':
      return progress.step === 'live' ? { label: 'Live', variant: 'success' } : { label: 'Ready', variant: 'success' };
    case 'active':
      return { label, variant: 'info' };
    case 'retrying':
      return { label: `${label} · retrying`, variant: 'warning' };
    case 'failed':
      return { label: `${label} failed`, variant: 'destructive' };
    case 'waiting':
      return { label: progress.step === 'queued' ? 'Queued' : `${label} · waiting`, variant: 'muted' };
    default:
      return { label: `${label} · not started`, variant: 'muted' };
  }
}

/** The copy's current step as one badge, for cards and table rows. */
export function CopyProgressBadge({ progress }: { progress: SiteCopyProgress }) {
  const { label, variant } = badgeFor(progress);
  const live = progress.state === 'done' && progress.step === 'live';
  return (
    <Badge variant={variant} title={progress.error ?? undefined}>
      {progress.state === 'active' ? (
        <Loader2 className="animate-spin" />
      ) : live ? (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      ) : progress.state === 'done' ? (
        <Check />
      ) : progress.state === 'failed' ? (
        <X />
      ) : progress.state === 'retrying' ? (
        <AlertTriangle />
      ) : (
        <Clock />
      )}
      {label}
    </Badge>
  );
}

const DOT: Record<SiteCopyStepState, string> = {
  done: 'border-success bg-success text-background',
  active: 'border-info bg-info/10 text-info ring-4 ring-info/15',
  retrying: 'border-warning bg-warning/10 text-warning',
  failed: 'border-destructive bg-destructive/10 text-destructive',
  waiting: 'border-border bg-muted text-muted-foreground',
  not_started: 'border-dashed border-border bg-background text-muted-foreground/70',
};

function StepDot({ step, state }: { step: SiteCopyStep; state: SiteCopyStepState }) {
  const Icon = COPY_STEPS[step].icon;
  return (
    <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors', DOT[state])}>
      {state === 'done' ? (
        <Check className="size-4" strokeWidth={3} />
      ) : state === 'active' ? (
        <Loader2 className="size-4 animate-spin" />
      ) : state === 'failed' ? (
        <X className="size-4" strokeWidth={3} />
      ) : state === 'retrying' ? (
        <AlertTriangle className="size-3.5" />
      ) : (
        <Icon className="size-3.5" />
      )}
    </span>
  );
}

/** Short line under the current step: when it started, when it runs next, or what it waits for. */
function currentNote(progress: SiteCopyProgress): string | null {
  const { state, step, since, nextAt } = progress;
  if (state === 'active') return since ? `Started ${formatRelative(since)}` : 'In progress';
  if (state === 'retrying') return nextAt ? `Retrying ${formatEta(nextAt)}` : 'Retrying soon';
  if (state === 'failed') return 'Stopped';
  if (state === 'waiting') return nextAt ? `Starts ${formatEta(nextAt)}` : step === 'queued' ? 'Waiting for its turn' : 'Starts soon';
  if (state === 'not_started') return 'Not queued';
  return since ? formatRelative(since) : null;
}

function headline(progress: SiteCopyProgress): string {
  const meta = COPY_STEPS[progress.step];
  switch (progress.state) {
    case 'done':
      return progress.step === 'live' ? 'The website is live on its own URL' : 'The website copy is ready';
    case 'active':
      return `${meta.active}…`;
    case 'retrying':
      return `${meta.label} hit an error and will try again`;
    case 'failed':
      return `${meta.label} failed`;
    case 'waiting':
      return progress.step === 'queued'
        ? 'Waiting in the queue to start copying'
        : progress.step === 'updating_git'
          ? 'Waiting to update Git; the URL is deployed right after'
          : `Waiting for ${meta.label.toLowerCase()}`;
    default:
      return progress.step === 'updating_git'
        ? 'Git has not been updated for this copy yet'
        : `${meta.label} has not been queued for this copy`;
  }
}

/**
 * Step tracker from the queue to the live URL: Queued, Copying website, Viewing source code, Building website,
 * Updating Git, Deploying URL, Live. The Worker deploy starts only after Git is updated.
 */
export function CopyProgressSteps({ progress, className }: { progress: SiteCopyProgress; className?: string }) {
  const steps = progress.steps;
  const doneCount = steps.filter((s) => s.state === 'done').length;
  const percent = Math.round((doneCount / steps.length) * 100);
  const note = currentNote(progress);
  const allDone = doneCount === steps.length;

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="space-y-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Status</p>
            <p className="font-display text-base font-semibold">{headline(progress)}</p>
            {progress.error && (progress.state === 'retrying' || progress.state === 'failed') && (
              <p className="font-mono text-xs break-all text-muted-foreground">{progress.error}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <CopyProgressBadge progress={progress} />
            <span className="text-xs tabular-nums text-muted-foreground">
              {doneCount}/{steps.length} steps
            </span>
          </div>
        </div>

        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full transition-all duration-500', allDone ? 'bg-success' : 'bg-primary')}
            style={{ width: `${percent}%` }}
          />
        </div>

        <ol className="grid gap-x-2 gap-y-3 sm:grid-flow-col sm:auto-cols-fr">
          {steps.map(({ step, state }, i) => {
            const current = !allDone && step === progress.step;
            const afterGit = step === 'deploying_url' && state !== 'done' && progress.step === 'updating_git' && !allDone;
            const at = (current || (allDone && i === steps.length - 1)) ? note : afterGit ? 'After the Git update' : null;
            return (
              <li key={step} className="relative flex items-center gap-3 sm:flex-col sm:items-center sm:gap-2 sm:text-center">
                {i < steps.length - 1 && (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute top-4 left-[calc(50%+1.25rem)] hidden h-0.5 w-[calc(100%-2.5rem+0.5rem)] sm:block',
                      state === 'done' ? 'bg-success' : 'bg-border',
                    )}
                  />
                )}
                <StepDot step={step} state={state} />
                <div className="min-w-0">
                  <p
                    className={cn(
                      'text-xs font-medium',
                      state === 'not_started' || state === 'waiting' ? 'text-muted-foreground' : 'text-foreground',
                      current && 'font-semibold',
                    )}
                  >
                    {COPY_STEPS[step].label}
                  </p>
                  {at ? (
                    <p
                      className="text-[11px] text-muted-foreground"
                      title={progress.since ? formatDateTime(progress.since) : undefined}
                    >
                      {at}
                    </p>
                  ) : state === 'done' ? (
                    <p className="text-[11px] text-success">Done</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
