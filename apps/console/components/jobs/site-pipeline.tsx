'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  Check,
  Clock,
  Cloud,
  Download,
  ExternalLink,
  Github,
  Loader2,
  RotateCcw,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { CopyButton } from '@/components/app/widgets';
import { formatEta } from '@/components/sites/automation';
import { failureText, isPermanentFailure } from '@/components/sites/labels';
import { publishErrorDetail, publishErrorInfo } from '@/components/sites/publish-errors';
import { DeployButton } from '@/components/sites/live-site';
import { GithubPushButton } from '@/components/sites/github-push';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { SiteSnapshotDetail, SiteSnapshotSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

export type StageKey = 'copy' | 'github' | 'deploy';
export type StageState = 'done' | 'active' | 'waiting' | 'retrying' | 'failed' | 'not_started';

export type StageError = { code: string; title: string; hint: string | null; detail: string | null; selfHealing: boolean };

export type Stage = {
  key: StageKey;
  label: string;
  icon: LucideIcon;
  state: StageState;
  /** When it finished (done) or started. */
  at: string | null;
  nextAt: string | null;
  attempts: number | null;
  maxAttempts: number | null;
  error: StageError | null;
};

const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

function copyStage(site: SiteSnapshotSummary): Stage {
  const base = { key: 'copy' as const, label: 'Copy', icon: Download, nextAt: null, attempts: site.attempts ?? null, maxAttempts: null };
  const error: StageError | null = site.failureReason
    ? {
        code: site.failureReason,
        title: failureText(site.failureReason) ?? 'The copy failed',
        hint:
          site.status === 'failed'
            ? isPermanentFailure(site.failureReason)
              ? 'Retrying would give the same result.'
              : 'Gave up after its retries. Start a new copy from the lead page.'
            : 'The worker retries by itself.',
        detail: site.failureDetail ?? null,
        selfHealing: site.status !== 'failed',
      }
    : null;
  switch (site.status) {
    case 'done':
      return { ...base, state: 'done', at: site.finishedAt, error: null };
    case 'running':
      return { ...base, state: 'active', at: null, error: null };
    case 'failed':
      return { ...base, state: 'failed', at: site.finishedAt, error };
    default:
      return { ...base, state: error ? 'retrying' : 'waiting', at: site.createdAt, error };
  }
}

function publishError(error: string | null | undefined): StageError | null {
  const info = publishErrorInfo(error);
  return info ? { code: info.code, title: info.title, hint: info.hint, detail: publishErrorDetail(error), selfHealing: info.selfHealing } : null;
}

function githubStage(site: SiteSnapshotSummary): Stage {
  const g = site.github;
  const base = { key: 'github' as const, label: 'GitHub', icon: Github };
  if (!g) return { ...base, state: 'not_started', at: null, nextAt: null, attempts: null, maxAttempts: null, error: null };
  const error = g.status === 'pushed' ? null : publishError(g.error);
  const state: StageState =
    g.status === 'pushed' ? 'done' : g.status === 'pushing' ? 'active' : g.status === 'failed' ? 'failed' : error ? 'retrying' : 'waiting';
  return { ...base, state, at: g.pushedAt, nextAt: state === 'waiting' || state === 'retrying' ? g.nextAt : null, attempts: g.attempts, maxAttempts: g.maxAttempts, error };
}

function deployStage(site: SiteSnapshotSummary): Stage {
  const d = site.deploy;
  const base = { key: 'deploy' as const, label: 'Deploy', icon: Cloud };
  if (!d) return { ...base, state: 'not_started', at: null, nextAt: null, attempts: null, maxAttempts: null, error: null };
  const error = d.status === 'deployed' ? null : publishError(d.error);
  const state: StageState =
    d.status === 'deployed' ? 'done' : d.status === 'deploying' ? 'active' : d.status === 'failed' ? 'failed' : error ? 'retrying' : 'waiting';
  return { ...base, state, at: d.deployedAt, nextAt: state === 'waiting' || state === 'retrying' ? d.nextAt : null, attempts: d.attempts, maxAttempts: d.maxAttempts, error };
}

export function siteStages(site: SiteSnapshotSummary): Stage[] {
  return [copyStage(site), githubStage(site), deployStage(site)];
}

export function liveUrlOf(site: SiteSnapshotSummary | null | undefined): string | null {
  return site?.deploy?.status === 'deployed' && site.deploy.url ? site.deploy.url : null;
}

type Overall = { label: string; variant: BadgeVariant; icon: LucideIcon | 'live' | 'spin' };

/** One label for the whole way from copy to live URL. */
export function overallStatus(site: SiteSnapshotSummary): Overall {
  const [copy, github, deploy] = siteStages(site) as [Stage, Stage, Stage];
  if (copy.state === 'failed') return { label: 'Copy failed', variant: 'destructive', icon: X };
  if (copy.state === 'active') return { label: 'Copying', variant: 'info', icon: 'spin' };
  if (copy.state === 'retrying') return { label: 'Copy retrying', variant: 'warning', icon: RotateCcw };
  if (copy.state === 'waiting') return { label: 'Queued', variant: 'muted', icon: Clock };
  if (deploy.state === 'done') return { label: 'Live', variant: 'success', icon: 'live' };
  for (const stage of [github, deploy]) {
    const name = stage.key === 'github' ? 'GitHub push' : 'Deploy';
    if (stage.state === 'failed') return { label: `${name} failed`, variant: 'destructive', icon: X };
    if (stage.state === 'retrying') {
      if (stage.error?.code === 'worker_limit_reached') return { label: 'Worker limit reached', variant: 'warning', icon: AlertTriangle };
      if (stage.error?.code === 'github_rate_limited') return { label: 'GitHub rate limited', variant: 'warning', icon: AlertTriangle };
      return { label: `${name} retrying`, variant: 'warning', icon: RotateCcw };
    }
    if (stage.state === 'active') return { label: stage.key === 'github' ? 'Pushing to GitHub' : 'Deploying', variant: 'info', icon: 'spin' };
  }
  if (deploy.state === 'waiting') return { label: github.state === 'done' || github.state === 'not_started' ? 'Waiting to deploy' : 'Waiting for GitHub', variant: 'info', icon: Clock };
  if (github.state === 'waiting') return { label: 'Waiting for GitHub', variant: 'info', icon: Clock };
  return { label: 'Not deployed', variant: 'muted', icon: Cloud };
}

export function OverallBadge({ site }: { site: SiteSnapshotSummary }) {
  const { label, variant, icon: Icon } = overallStatus(site);
  return (
    <Badge variant={variant}>
      {Icon === 'live' ? (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      ) : Icon === 'spin' ? (
        <Loader2 className="animate-spin" />
      ) : (
        <Icon />
      )}
      {label}
    </Badge>
  );
}

const DOT: Record<StageState, string> = {
  done: 'bg-success text-background',
  active: 'bg-info/15 text-info ring-2 ring-info/30',
  retrying: 'bg-warning/15 text-warning',
  failed: 'bg-destructive/15 text-destructive',
  waiting: 'bg-muted text-muted-foreground',
  not_started: 'border border-dashed border-border text-muted-foreground/60',
};

const STATE_TEXT: Record<StageState, string> = {
  done: 'Done',
  active: 'In progress',
  waiting: 'Waiting',
  retrying: 'Retrying after an error',
  failed: 'Failed',
  not_started: 'Not started',
};

function StageDot({ stage, size = 'sm' }: { stage: Stage; size?: 'sm' | 'md' }) {
  const Icon = stage.icon;
  const box = size === 'sm' ? 'size-5' : 'size-8';
  const glyph = size === 'sm' ? 'size-3' : 'size-4';
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-full', box, DOT[stage.state])} title={`${stage.label}: ${STATE_TEXT[stage.state]}`}>
      {stage.state === 'done' ? (
        <Check className={glyph} strokeWidth={3} />
      ) : stage.state === 'active' ? (
        <Loader2 className={cn(glyph, 'animate-spin')} />
      ) : stage.state === 'failed' ? (
        <X className={glyph} strokeWidth={3} />
      ) : stage.state === 'retrying' ? (
        <AlertTriangle className={glyph} />
      ) : (
        <Icon className={glyph} />
      )}
    </span>
  );
}

/** First stage with an error: the one that blocks the website from going live. */
function blockingStage(stages: Stage[]): Stage | null {
  return stages.find((s) => s.error && (s.state === 'retrying' || s.state === 'failed')) ?? null;
}

function nextStep(stage: Stage): string | null {
  if (stage.state === 'failed') return stage.error?.selfHealing === false ? 'Needs you' : 'Stopped';
  if (stage.state === 'retrying') return stage.nextAt ? `Retrying ${formatEta(stage.nextAt)}` : 'Retrying soon';
  return null;
}

/** Status column of a website copy job: Copy → GitHub → Deploy dots, one overall label and the blocking error. */
export function SitePipelineCell({ site }: { site: SiteSnapshotSummary }) {
  const stages = siteStages(site);
  const blocking = blockingStage(stages);
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center">
          {stages.map((stage, i) => (
            <span key={stage.key} className="flex items-center">
              {i > 0 && <span className={cn('h-px w-2', stages[i - 1]!.state === 'done' ? 'bg-success' : 'bg-border')} />}
              <StageDot stage={stage} />
            </span>
          ))}
        </span>
        <OverallBadge site={site} />
      </div>
      {blocking?.error && (
        <p className="max-w-72 text-xs leading-snug" title={blocking.error.detail ?? undefined}>
          <span className={cn('font-medium', blocking.state === 'failed' ? 'text-destructive' : 'text-warning')}>
            {blocking.label}: {blocking.error.title}
          </span>
          {nextStep(blocking) && <span className="text-muted-foreground"> · {nextStep(blocking)}</span>}
        </p>
      )}
    </div>
  );
}

/** Live URL column: the website's own Worker address once deployed. */
export function LiveUrlCell({ site }: { site: SiteSnapshotSummary | null | undefined }) {
  const url = liveUrlOf(site);
  if (!url) return <span className="text-xs text-muted-foreground">{site ? 'Not live yet' : '—'}</span>;
  return (
    <span className="inline-flex max-w-60 items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <span className="size-1.5 shrink-0 rounded-full bg-success" />
      <a href={url} target="_blank" rel="noreferrer noopener" title={url} className="min-w-0 truncate font-mono text-xs font-medium text-primary hover:underline">
        {host(url)}
      </a>
      <CopyButton value={url} label="Copy link" />
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        aria-label="Open the live website in a new tab"
        title="Open in new tab"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ExternalLink className="size-3.5" />
      </a>
    </span>
  );
}

function StageError({ stage }: { stage: Stage }) {
  const error = stage.error;
  if (!error) return null;
  const failed = stage.state === 'failed';
  return (
    <div className={cn('mt-2 space-y-1 rounded-lg border p-3 text-xs', failed ? 'border-destructive/30 bg-destructive/5' : 'border-warning/30 bg-warning/5')}>
      <p className={cn('flex items-start gap-1.5 font-medium', failed ? 'text-destructive' : 'text-warning')}>
        <AlertTriangle className="mt-px size-3.5 shrink-0" /> {error.title}
      </p>
      {error.hint && (
        <p className="flex items-start gap-1.5 text-foreground">
          {error.selfHealing ? <RotateCcw className="mt-px size-3.5 shrink-0 text-muted-foreground" /> : <Wrench className="mt-px size-3.5 shrink-0 text-muted-foreground" />}
          {error.hint}
        </p>
      )}
      {error.detail && <p className="font-mono text-[11px] break-all text-muted-foreground">{error.detail}</p>}
    </div>
  );
}

function stageNote(stage: Stage): string | null {
  const tries = stage.attempts && stage.maxAttempts ? `try ${stage.attempts} of ${stage.maxAttempts}` : null;
  switch (stage.state) {
    case 'done':
      return stage.at ? `Done ${formatRelative(stage.at)}` : 'Done';
    case 'active':
      return 'In progress now';
    case 'waiting':
      return stage.nextAt ? `Starts ${formatEta(stage.nextAt)}` : stage.key === 'deploy' ? 'Deploys after the GitHub push' : 'Waiting for its turn';
    case 'retrying':
      return [stage.nextAt ? `Next try ${formatEta(stage.nextAt)}` : 'Retrying soon', tries].filter(Boolean).join(' · ');
    case 'failed':
      return ['Stopped', tries].filter(Boolean).join(' · ');
    default:
      return stage.key === 'copy' ? null : 'Not queued';
  }
}

/** Website section of the job panel: each step to the live URL with its links, errors and retry buttons. */
export function SitePipelinePanel({ site, detail }: { site: SiteSnapshotSummary; detail?: SiteSnapshotDetail | null }) {
  const stages = siteStages(site);
  const url = liveUrlOf(site);
  const { github, deploy } = site;
  const repoUrl = github?.status === 'pushed' ? (github.folderUrl ?? github.commitUrl) : null;
  const copyDone = site.status === 'done';
  const canPush = Boolean(detail?.githubConfigured) && copyDone && github?.status !== 'pushing' && !(github?.status === 'pending' && !github.error);
  const canDeploy = Boolean(detail?.deployConfigured) && copyDone && deploy?.status !== 'deploying' && !(deploy?.status === 'pending' && !deploy.error);
  const gitFirst = Boolean(detail?.githubConfigured) && github?.status !== 'pushed';

  return (
    <div className="space-y-4">
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border px-3 py-2.5',
          url ? 'border-success/40 bg-success/5' : 'bg-muted/30',
        )}
      >
        <Cloud className={cn('size-4 shrink-0', url ? 'text-success' : 'text-muted-foreground')} />
        {url ? (
          <>
            <a href={url} target="_blank" rel="noreferrer noopener" className="min-w-0 truncate font-mono text-sm font-medium hover:text-primary" title={url}>
              {host(url)}
            </a>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              <CopyButton value={url} label="Copy link" />
              <a href={url} target="_blank" rel="noreferrer noopener" aria-label="Open the live website" className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
                <ExternalLink className="size-3.5" />
              </a>
            </span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">Not live yet · {overallStatus(site).label}</span>
        )}
      </div>

      <ol className="space-y-3">
        {stages.map((stage, i) => (
          <li key={stage.key} className="relative flex gap-3">
            {i < stages.length - 1 && (
              <span aria-hidden className={cn('absolute top-9 bottom-[-0.75rem] left-4 w-px', stage.state === 'done' ? 'bg-success' : 'bg-border')} />
            )}
            <StageDot stage={stage} size="md" />
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-semibold">
                  {stage.key === 'copy' ? 'Website copy' : stage.key === 'github' ? 'GitHub repository' : 'Cloudflare Worker'}
                </p>
                <span className="text-xs text-muted-foreground" title={stage.at ? formatDateTime(stage.at) : undefined}>
                  {stageNote(stage)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {stage.key === 'copy' && (
                  <Link href={`/sites/${site.id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                    Open website copy <ExternalLink className="size-3" />
                  </Link>
                )}
                {stage.key === 'github' &&
                  (repoUrl ? (
                    <a href={repoUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-mono text-primary hover:underline">
                      {github?.repo ?? 'Repository'} <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    <span className="font-mono">{github?.repo ?? (stage.state === 'not_started' ? 'Not pushed' : '—')}</span>
                  ))}
                {stage.key === 'deploy' && <span className="font-mono">{deploy?.name ?? site.siteName ?? '—'}</span>}
              </div>
              <StageError stage={stage} />
              {stage.key === 'github' && canPush && (
                <div className="mt-2">
                  <GithubPushButton snapshotId={site.id} label={!github ? 'Push to GitHub' : github.status === 'pushed' ? 'Push again' : 'Retry push'} />
                </div>
              )}
              {stage.key === 'deploy' && canDeploy && (
                <div className="mt-2">
                  <DeployButton
                    snapshotId={site.id}
                    label={!deploy ? 'Deploy website' : deploy.status === 'deployed' ? 'Redeploy' : 'Retry deploy'}
                    variant={!deploy || deploy.status === 'failed' ? 'default' : 'outline'}
                    afterGit={gitFirst}
                  />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
