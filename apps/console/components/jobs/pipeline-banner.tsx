'use client';

import Link from 'next/link';
import { AlertTriangle, CircleCheck, CirclePause, Loader2, RotateCcw, type LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatEta } from '@/components/sites/automation';
import { publishErrorDetail, publishErrorInfo } from '@/components/sites/publish-errors';
import { SitePipelineCell } from '@/components/jobs/site-pipeline';
import { useSitePipeline } from '@/lib/queries';
import { formatNumber } from '@/lib/format';
import type { SitePipelineState, SitePipelineStatus, SitePipelineStep } from '@/lib/types';
import { cn } from '@/lib/utils';

const STEP_TEXT: Record<SitePipelineStep, string> = {
  copy: 'Copying the website',
  github: 'Pushing to GitHub',
  deploy: 'Deploying to Cloudflare',
};

const STATE: Record<SitePipelineState, { label: string; icon: LucideIcon; tone: string; border: string }> = {
  working: { label: 'Working', icon: Loader2, tone: 'text-info', border: 'border-info/30' },
  retrying: { label: 'Retrying', icon: RotateCcw, tone: 'text-warning', border: 'border-warning/40' },
  paused: { label: 'Paused', icon: CirclePause, tone: 'text-warning', border: 'border-warning/50 bg-warning/5' },
};

function Counts({ data }: { data: SitePipelineStatus }) {
  return (
    <div className="flex shrink-0 gap-5 text-xs text-muted-foreground">
      <span>
        <span className="font-semibold text-foreground tabular-nums">{formatNumber(data.toPublish)}</span> copies waiting to publish
      </span>
      <span>
        <span className="font-semibold text-foreground tabular-nums">{formatNumber(data.waitingCopies)}</span> websites waiting to be copied
      </span>
    </div>
  );
}

function domainOf(data: NonNullable<SitePipelineStatus['current']>) {
  return data.site.company?.domain ?? data.site.sourceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/**
 * The worker takes one website at a time through copy, GitHub push and Cloudflare deploy; this shows which one,
 * the step it is on, and why it waits when it does.
 */
export function SitePipelineBanner({ className }: { className?: string }) {
  const { data } = useSitePipeline();
  if (!data || !data.enabled) return null;
  const current = data.current;

  if (!current) {
    return (
      <Card className={cn('mb-6 py-0', className)}>
        <CardContent className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <CircleCheck className="size-5 shrink-0 text-success" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">Website pipeline idle</p>
              <p className="text-xs text-muted-foreground">One website at a time: copy, GitHub repository, then the live Worker URL.</p>
            </div>
          </div>
          <Counts data={data} />
        </CardContent>
      </Card>
    );
  }

  const state = STATE[current.state];
  const Icon = state.icon;
  const error = current.step === 'copy' ? null : publishErrorInfo(current.error);
  const detail = current.step === 'copy' ? current.error : publishErrorDetail(current.error);
  const tries = current.attempts > 0 ? `try ${current.attempts} of ${current.maxAttempts}` : null;
  const wait =
    current.nextAt && current.state !== 'working'
      ? `${current.state === 'paused' ? 'Checks again' : 'Next try'} ${formatEta(current.nextAt)}`
      : null;

  return (
    <Card className={cn('mb-6 py-0', state.border, className)}>
      <CardContent className="space-y-3 px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <Icon className={cn('mt-0.5 size-5 shrink-0', state.tone, current.state === 'working' && 'animate-spin')} />
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-semibold">
                <span className={state.tone}>{state.label}</span>
                <span className="text-muted-foreground"> · </span>
                {STEP_TEXT[current.step]}{' '}
                <Link href={`/sites/${current.site.id}`} className="font-mono text-primary hover:underline">
                  {domainOf(current)}
                </Link>
              </p>
              <p className="text-xs text-muted-foreground">
                {[tries, wait, 'the next website starts once this one is live or a step gives up after its tries']
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </div>
          <Counts data={data} />
        </div>
        <SitePipelineCell site={current.site} />
        {current.error && current.state !== 'working' && (
          <div
            className={cn(
              'space-y-1 rounded-lg border p-3 text-xs',
              current.state === 'paused' ? 'border-warning/40 bg-warning/5' : 'border-warning/30 bg-warning/5',
            )}
          >
            <p className="flex items-start gap-1.5 font-medium text-warning">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              {current.state === 'paused'
                ? `${error?.title ?? 'Limit reached'}: the whole queue is paused on this website`
                : (error?.title ?? 'The last try failed')}
            </p>
            {error?.hint && <p className="text-foreground">{error.hint}</p>}
            {detail && <p className="font-mono text-[11px] break-all text-muted-foreground">{detail}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
