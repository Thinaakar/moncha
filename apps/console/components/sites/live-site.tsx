'use client';

import { AlertTriangle, Cloud, ExternalLink, Github, Globe, Loader2, Lock, Radio, RefreshCw, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/app/widgets';
import { useCanEdit } from '@/components/app/user-context';
import { formatEta, OriginBadge } from '@/components/sites/automation';
import { GithubPushButton, GithubStatusBadge } from '@/components/sites/github-push';
import { useDeploySiteSnapshot } from '@/lib/queries';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { SiteSnapshotDetail, SiteSnapshotSummary, SiteWorkerDeploy } from '@/lib/types';
import { cn } from '@/lib/utils';

const DEPLOY_STATUS: Record<SiteWorkerDeploy['status'], { label: string; variant: BadgeVariant }> = {
  pending: { label: 'Waiting to deploy', variant: 'info' },
  deploying: { label: 'Deploying', variant: 'info' },
  deployed: { label: 'Live', variant: 'success' },
  failed: { label: 'Deploy failed', variant: 'destructive' },
};

export const isWorkerLimit = (error: string | null | undefined) => Boolean(error?.startsWith('worker_limit_reached'));

function deployStatus(deploy: SiteWorkerDeploy) {
  if (deploy.status === 'pending' && isWorkerLimit(deploy.error)) return { label: 'Worker limit reached', variant: 'warning' as const };
  if (deploy.status === 'pending' && deploy.error) return { label: 'Retrying', variant: 'warning' as const };
  return DEPLOY_STATUS[deploy.status];
}

const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

export function DeployStatusBadge({ deploy }: { deploy: SiteWorkerDeploy }) {
  const status = deployStatus(deploy);
  return (
    <Badge variant={status.variant}>
      {deploy.status === 'deploying' ? (
        <Loader2 className="animate-spin" />
      ) : deploy.status === 'deployed' ? (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      ) : (
        <Cloud />
      )}
      {status.label}
    </Badge>
  );
}

/** Opens the copy's live website (its Worker, or the older shared link). Hidden until the API returns one. */
export function LiveSiteButton({
  url,
  size = 'default',
  variant = 'outline',
}: {
  url: string | null | undefined;
  size?: 'default' | 'sm';
  variant?: 'outline' | 'default' | 'ghost';
}) {
  if (!url) return null;
  return (
    <Button variant={variant} size={size} asChild>
      <a href={url} target="_blank" rel="noreferrer noopener">
        <Radio /> Live website
      </a>
    </Button>
  );
}

/** Compact link plus copy button for tables and detail rows. */
export function LiveSiteLink({ url, full = false }: { url: string | null | undefined; full?: boolean }) {
  if (!url) return <span className="text-muted-foreground">—</span>;
  const label = full ? host(url) : 'Open';
  return (
    <span className="inline-flex max-w-full items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex min-w-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        <span className={full ? 'break-all' : undefined}>{label}</span>
        <ExternalLink className="size-3 shrink-0" />
      </a>
      <CopyButton value={url} />
    </span>
  );
}

/** Queues a deploy now: first deploy of an older copy, a retry, or a redeploy. Hidden for viewers. */
export function DeployButton({
  snapshotId,
  label,
  size = 'sm',
  variant = 'outline',
  afterGit = false,
}: {
  snapshotId: string;
  label: string;
  size?: 'default' | 'sm';
  variant?: 'outline' | 'default';
  /** The copy's GitHub push is not done yet, so the deploy waits for it. */
  afterGit?: boolean;
}) {
  const canEdit = useCanEdit();
  const deploy = useDeploySiteSnapshot();
  if (!canEdit) return null;
  async function run() {
    try {
      await deploy.mutateAsync(snapshotId);
      toast.success('Queued for Cloudflare', {
        description: afterGit
          ? 'The worker deploys it right after its GitHub repository is updated.'
          : 'The worker deploys it within a few seconds.',
      });
    } catch (e) {
      toast.error('Could not queue the deploy', { description: errorMessage(e) });
    }
  }
  return (
    <Button variant={variant} size={size} onClick={run} loading={deploy.isPending}>
      {!deploy.isPending && (label.startsWith('Deploy') ? <Rocket /> : <RefreshCw />)} {label}
    </Button>
  );
}

/** Browser-style address bar for the live URL. */
function AddressBar({ url, live, placeholder }: { url: string | null; live: boolean; placeholder: string }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-background px-3 py-2.5 shadow-xs',
          live && 'border-success/40 ring-2 ring-success/10',
        )}
      >
        {url ? (
          <Lock className={cn('size-3.5 shrink-0', live ? 'text-success' : 'text-muted-foreground')} />
        ) : (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        )}
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="min-w-0 truncate font-mono text-sm font-medium text-foreground hover:text-primary"
            title={url}
          >
            <span className="text-muted-foreground">https://</span>
            {host(url)}
          </a>
        ) : (
          <span className="truncate text-sm text-muted-foreground">{placeholder}</span>
        )}
        {url && (
          <span className="ml-auto">
            <CopyButton value={url} label="Copy link" />
          </span>
        )}
      </div>
      {url && (
        <Button asChild className="shrink-0">
          <a href={url} target="_blank" rel="noreferrer noopener">
            <ExternalLink /> Open website
          </a>
        </Button>
      )}
    </div>
  );
}

function Tile({ icon: Icon, label, children }: { icon: typeof Globe; label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </p>
      <div className="mt-1.5 space-y-1 text-sm">{children}</div>
    </div>
  );
}

function domainOf(snapshot: SiteSnapshotSummary) {
  return host(snapshot.company?.domain || snapshot.finalUrl || snapshot.sourceUrl).replace(/^www\./, '').split('/')[0];
}

/**
 * The copy's published website: one website = one GitHub repo = one Cloudflare Worker = one URL.
 * Shown above the tabs once a copy is done.
 */
export function LiveWebsiteCard({ snapshot }: { snapshot: SiteSnapshotDetail }) {
  if (snapshot.status !== 'done') return null;
  const { deploy, github } = snapshot;
  const live = deploy?.status === 'deployed' && Boolean(deploy.url);
  const url = live ? deploy!.url : deploy ? null : (snapshot.publicUrl ?? null);
  const repo = github?.repo ?? snapshot.githubRepo ?? null;
  const repoUrl = github?.status === 'pushed' ? (github.folderUrl ?? github.commitUrl) : null;
  const deployFailed = deploy && (deploy.status === 'failed' || (deploy.status === 'pending' && deploy.error));
  const gitFirst = Boolean(snapshot.progress?.steps.some((s) => s.step === 'updating_git' && s.state !== 'done'));

  return (
    <Card className={cn('overflow-hidden', live && 'border-success/30 bg-gradient-to-br from-success/[0.04] via-transparent to-transparent')}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-xl',
              live ? 'bg-success/12 text-success' : 'bg-primary/10 text-primary',
            )}
          >
            <Globe className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 font-display text-base font-semibold">
              Live website
              {deploy ? <DeployStatusBadge deploy={deploy} /> : <Badge variant="muted">Not deployed</Badge>}
              <OriginBadge origin={snapshot.origin} />
            </h2>
            <p className="text-xs text-muted-foreground">One website · one GitHub repository · one Cloudflare Worker</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <AddressBar
          url={url}
          live={live}
          placeholder={
            deploy?.status === 'deploying'
              ? 'Deploying to Cloudflare…'
              : deploy?.status === 'pending' && !deploy.error
                ? gitFirst
                  ? 'Deploys right after the GitHub repository is updated…'
                  : 'Waiting for the worker to deploy…'
                : deployFailed
                  ? isWorkerLimit(deploy?.error)
                    ? 'Not live yet: the Cloudflare Worker limit is reached'
                    : 'Not live yet: the last deploy failed'
                  : snapshot.deployConfigured
                    ? 'Not deployed yet'
                    : 'Cloudflare deploys are not set up on the worker'
          }
        />
        {!deploy && url && (
          <p className="-mt-2 text-xs text-muted-foreground">Older shared link. Deploy the copy to give it its own address.</p>
        )}

        {deployFailed && deploy && (
          <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="min-w-0">
              <p className="font-medium">
                {deploy.status === 'failed'
                  ? `Deploy gave up after ${deploy.attempts} tries`
                  : isWorkerLimit(deploy.error)
                    ? `The Cloudflare account has no room for another Worker; checking again ${deploy.nextAt ? formatEta(deploy.nextAt) : 'later'}`
                    : `Deploy failed; try ${deploy.attempts + 1} of ${deploy.maxAttempts} runs ${deploy.nextAt ? formatEta(deploy.nextAt) : 'soon'}`}
              </p>
              {deploy.error && <p className="mt-0.5 font-mono text-xs break-all text-muted-foreground">{deploy.error}</p>}
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Tile icon={Globe} label="Website name">
            <p className="truncate font-mono font-semibold">{snapshot.siteName ?? '—'}</p>
            <p className="truncate text-xs text-muted-foreground">{domainOf(snapshot)}</p>
          </Tile>

          <Tile icon={Github} label="GitHub repository">
            {repo ? (
              repoUrl ? (
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex min-w-0 items-center gap-1 font-mono font-semibold text-primary hover:underline"
                >
                  <span className="truncate">{repo}</span> <ExternalLink className="size-3 shrink-0" />
                </a>
              ) : (
                <p className="truncate font-mono font-semibold text-muted-foreground">{repo}</p>
              )
            ) : (
              <p className="text-muted-foreground">Not set up</p>
            )}
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {github ? <GithubStatusBadge github={github} /> : <Badge variant="muted">Not pushed</Badge>}
              <Badge variant="muted">
                <Lock /> Private
              </Badge>
              {github?.pushedAt && <span title={formatDateTime(github.pushedAt)}>{formatRelative(github.pushedAt)}</span>}
            </div>
          </Tile>

          <Tile icon={Cloud} label="Cloudflare Worker">
            <p className="truncate font-mono font-semibold">{deploy?.name ?? snapshot.siteName ?? '—'}</p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {deploy ? <DeployStatusBadge deploy={deploy} /> : <Badge variant="muted">Not deployed</Badge>}
              {deploy?.deployedAt && <span title={formatDateTime(deploy.deployedAt)}>{formatRelative(deploy.deployedAt)}</span>}
            </div>
          </Tile>
        </div>
      </CardContent>

      {(snapshot.deployConfigured || snapshot.githubConfigured) && (
        <CardFooter className="flex flex-wrap gap-2 border-t bg-muted/20 py-3">
          {snapshot.deployConfigured && deploy?.status !== 'deploying' && !(deploy?.status === 'pending' && !deploy.error) && (
            <DeployButton
              snapshotId={snapshot.id}
              label={!deploy ? 'Deploy website' : deploy.status === 'deployed' ? 'Redeploy' : 'Retry deploy'}
              variant={!deploy || deploy.status === 'failed' ? 'default' : 'outline'}
              afterGit={gitFirst}
            />
          )}
          {snapshot.githubConfigured && github?.status !== 'pushing' && !(github?.status === 'pending' && !github.error) && (
            <GithubPushButton
              snapshotId={snapshot.id}
              label={!github ? 'Push to GitHub' : github.status === 'pushed' ? 'Push to GitHub again' : 'Retry push'}
            />
          )}
          <p className="ml-auto self-center text-xs text-muted-foreground">
            A newer copy of this website updates the same repo and URL.
          </p>
        </CardFooter>
      )}
    </Card>
  );
}

/** One-line live website summary for the lead page's copy card. */
export function LiveWebsiteStrip({ snapshot }: { snapshot: SiteSnapshotSummary }) {
  if (snapshot.status !== 'done') return null;
  const { deploy, github } = snapshot;
  const url = deploy?.status === 'deployed' ? deploy.url : deploy ? null : (snapshot.publicUrl ?? null);
  const repoUrl = github?.status === 'pushed' ? (github.folderUrl ?? github.commitUrl) : null;
  if (!url && !deploy && !github) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
      <Globe className={cn('size-4 shrink-0', url && deploy ? 'text-success' : 'text-muted-foreground')} />
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="min-w-0 truncate font-mono text-xs font-medium text-foreground hover:text-primary"
          title={url}
        >
          {host(url)}
        </a>
      ) : deploy ? (
        <DeployStatusBadge deploy={deploy} />
      ) : null}
      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        {url && <CopyButton value={url} label="Copy link" />}
        {repoUrl && (
          <a
            href={repoUrl}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Open the GitHub repository"
            title={github?.repo ?? 'GitHub repository'}
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <Github className="size-3.5" />
          </a>
        )}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Open the live website"
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </span>
    </div>
  );
}

/** Live website column of the copies table: the Worker host, its deploy state, or the older shared link. */
export function LiveWebsiteCell({ snapshot }: { snapshot: SiteSnapshotSummary }) {
  const { deploy } = snapshot;
  if (deploy?.status === 'deployed' && deploy.url) {
    return (
      <span className="inline-flex max-w-56 items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <span className="size-1.5 shrink-0 rounded-full bg-success" />
        <a
          href={deploy.url}
          target="_blank"
          rel="noreferrer noopener"
          title={deploy.url}
          className="min-w-0 truncate font-mono text-xs font-medium text-primary hover:underline"
        >
          {host(deploy.url)}
        </a>
        <CopyButton value={deploy.url} label="Copy link" />
        <a
          href={deploy.url}
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
  if (deploy && snapshot.status === 'done') return <DeployStatusBadge deploy={deploy} />;
  return <LiveSiteLink url={snapshot.publicUrl} />;
}
