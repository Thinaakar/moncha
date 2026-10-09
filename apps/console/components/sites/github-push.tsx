'use client';

import { AlertTriangle, ExternalLink, Github, Loader2, RefreshCw, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InlineAlert } from '@/components/app/states';
import { useCanEdit } from '@/components/app/user-context';
import { CopyButton, DetailRow } from '@/components/app/widgets';
import { formatEta } from '@/components/sites/automation';
import { useGithubPushSiteSnapshot } from '@/lib/queries';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { SiteGithubPush, SiteSnapshotDetail } from '@/lib/types';

const STATUS: Record<SiteGithubPush['status'], { label: string; variant: 'success' | 'warning' | 'info' | 'destructive' }> = {
  pending: { label: 'Waiting to push', variant: 'info' },
  pushing: { label: 'Pushing', variant: 'info' },
  pushed: { label: 'On GitHub', variant: 'success' },
  failed: { label: 'Push failed', variant: 'destructive' },
};

/** "Retrying" while a retry is scheduled after an error. */
function statusOf(github: SiteGithubPush) {
  if (github.status === 'pending' && github.error) return { label: 'Retrying', variant: 'warning' as const };
  return STATUS[github.status];
}

export function GithubStatusBadge({ github }: { github: SiteGithubPush }) {
  const status = statusOf(github);
  return (
    <Badge variant={status.variant} className="gap-1">
      {github.status === 'pushing' ? <Loader2 className="size-3 animate-spin" /> : <Github className="size-3" />}
      {status.label}
    </Badge>
  );
}

/** Opens the copy's folder in the sites repo once it is pushed. */
export function GithubLinkButton({
  github,
  size = 'default',
  variant = 'outline',
}: {
  github: SiteGithubPush | null | undefined;
  size?: 'default' | 'sm';
  variant?: 'outline' | 'ghost';
}) {
  const href = github?.status === 'pushed' ? (github.folderUrl ?? github.commitUrl) : null;
  if (!href) return null;
  return (
    <Button variant={variant} size={size} asChild>
      <a href={href} target="_blank" rel="noreferrer noopener">
        <Github /> View on GitHub
      </a>
    </Button>
  );
}

/** Queues a push now: first push of an older copy, or a retry. Hidden for viewers. */
export function GithubPushButton({
  snapshotId,
  label,
  size = 'sm',
  variant = 'outline',
}: {
  snapshotId: string;
  label: string;
  size?: 'default' | 'sm';
  variant?: 'outline' | 'default';
}) {
  const canEdit = useCanEdit();
  const push = useGithubPushSiteSnapshot();
  if (!canEdit) return null;
  async function run() {
    try {
      await push.mutateAsync(snapshotId);
      toast.success('Queued for GitHub', { description: 'The worker pushes it within a few seconds.' });
    } catch (e) {
      toast.error('Could not queue the GitHub push', { description: errorMessage(e) });
    }
  }
  return (
    <Button variant={variant} size={size} onClick={run} loading={push.isPending}>
      {!push.isPending && (label.startsWith('Retry') ? <RefreshCw /> : <Upload />)} {label}
    </Button>
  );
}

/** Warning on the copy page when GitHub failed; the copy itself stays usable. */
export function GithubPushAlert({ snapshot }: { snapshot: SiteSnapshotDetail }) {
  const github = snapshot.github;
  if (!github || snapshot.status !== 'done') return null;
  if (github.status === 'failed') {
    return (
      <InlineAlert variant="warning" icon={AlertTriangle} title="Not on GitHub: the push gave up">
        <p>
          The copy is complete and works here; only the GitHub push failed after {github.attempts} tries.
          {github.error && <span className="mt-1 block font-mono text-xs break-all">{github.error}</span>}
        </p>
        <div className="mt-2">
          <GithubPushButton snapshotId={snapshot.id} label="Retry push" />
        </div>
      </InlineAlert>
    );
  }
  if (github.status === 'pending' && github.error) {
    return (
      <InlineAlert
        variant="warning"
        icon={AlertTriangle}
        title={`GitHub push failed; retrying ${github.nextAt ? formatEta(github.nextAt) : 'soon'}`}
      >
        <p>
          The copy is complete and works here. Try {github.attempts + 1} of {github.maxAttempts} runs automatically.
          <span className="mt-1 block font-mono text-xs break-all">{github.error}</span>
        </p>
        <div className="mt-2">
          <GithubPushButton snapshotId={snapshot.id} label="Retry now" />
        </div>
      </InlineAlert>
    );
  }
  return null;
}

/** GitHub section of the Details tab. */
export function GithubDetailsCard({ snapshot }: { snapshot: SiteSnapshotDetail }) {
  const github = snapshot.github;
  if (!github && !snapshot.githubConfigured) return null;
  const shortSha = github?.commitSha?.slice(0, 7);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Github className="size-4 text-primary" /> GitHub
        </CardTitle>
        <CardDescription>
          HTML, CSS, JS, brand.json and manifest.json{snapshot.githubRepo ? ` in ${snapshot.githubRepo}` : ''}. Images, fonts and
          screenshots stay in R2, so the GitHub folder opens without them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!github ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {snapshot.status === 'done' ? 'This copy was made before GitHub push was set up.' : 'Pushed when the copy finishes.'}
            </p>
            {snapshot.status === 'done' && snapshot.githubConfigured && (
              <GithubPushButton snapshotId={snapshot.id} label="Push to GitHub" />
            )}
          </div>
        ) : (
          <dl className="divide-y">
            <DetailRow label="Status">
              <GithubStatusBadge github={github} />
            </DetailRow>
            <DetailRow label="Folder">
              {github.folderUrl ? (
                <a href={github.folderUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary hover:underline break-all">
                  {github.folderUrl.replace(/^https:\/\/github\.com\//, '')} <ExternalLink className="size-3 shrink-0" />
                </a>
              ) : (
                '—'
              )}
            </DetailRow>
            <DetailRow label="Commit">
              {github.commitUrl && shortSha ? (
                <span className="inline-flex items-center gap-1">
                  <a href={github.commitUrl} target="_blank" rel="noreferrer noopener" className="font-mono text-xs text-primary hover:underline">
                    {shortSha}
                  </a>
                  <CopyButton value={github.commitUrl} />
                </span>
              ) : (
                '—'
              )}
            </DetailRow>
            <DetailRow label="Pushed">
              {github.pushedAt ? <span title={formatDateTime(github.pushedAt)}>{formatRelative(github.pushedAt)}</span> : '—'}
            </DetailRow>
            <DetailRow label="Attempts">{`${github.attempts} of ${github.maxAttempts}`}</DetailRow>
            {github.status === 'pending' && github.nextAt && (
              <DetailRow label="Next try">{formatEta(github.nextAt)}</DetailRow>
            )}
            {github.error && github.status !== 'pushed' && (
              <DetailRow label="Last error">
                <span className="font-mono text-xs break-all">{github.error}</span>
              </DetailRow>
            )}
          </dl>
        )}
        {github && github.status !== 'pushing' && github.status !== 'pending' && snapshot.githubConfigured && (
          <GithubPushButton
            snapshotId={snapshot.id}
            label={github.status === 'failed' ? 'Retry push' : 'Push again'}
          />
        )}
      </CardContent>
    </Card>
  );
}
