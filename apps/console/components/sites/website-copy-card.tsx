'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowRight, Copy, ImageOff, Loader2, ScanEye } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/app/states';
import { JobStatusBadge } from '@/components/app/status';
import { useCanEdit } from '@/components/app/user-context';
import { failureText } from '@/components/sites/labels';
import { siteFileUrl, useCreateSiteSnapshot, useLeadSiteSnapshots } from '@/lib/queries';
import { errorMessage } from '@/lib/api';
import { formatBytes, formatNumber, formatRelative } from '@/lib/format';
import type { JobStatus, SiteSnapshotSummary } from '@/lib/types';

const isOpen = (status: JobStatus) => status === 'pending' || status === 'running';

/** Toasts once when a copy that was in progress on this page finishes. */
function useFinishToasts(items: SiteSnapshotSummary[] | undefined) {
  const router = useRouter();
  const seen = useRef(new Map<string, JobStatus>());
  useEffect(() => {
    for (const s of items ?? []) {
      const before = seen.current.get(s.id);
      if (before && isOpen(before) && !isOpen(s.status)) {
        if (s.status === 'done') {
          toast.success('Website copy is ready', {
            action: { label: 'Open', onClick: () => router.push(`/sites/${s.id}`) },
          });
        } else {
          toast.error('Website copy failed', { description: failureText(s.failureReason) ?? undefined });
        }
      }
      seen.current.set(s.id, s.status);
    }
  }, [items, router]);
}

export function WebsiteCopyCard({ leadId, hasWebsite }: { leadId: string; hasWebsite: boolean }) {
  const canEdit = useCanEdit();
  const router = useRouter();
  const { data: items, error, isLoading, refetch } = useLeadSiteSnapshots(leadId);
  const create = useCreateSiteSnapshot(leadId);
  useFinishToasts(items);

  const latest = items?.[0];
  const older = items?.slice(1, 5) ?? [];
  const busy = Boolean(items?.some((s) => isOpen(s.status)));

  async function start() {
    try {
      const queued = await create.mutateAsync();
      toast.success(queued.deduped ? 'A copy of this website is already in progress' : 'Website copy started', {
        action: { label: 'View', onClick: () => router.push(`/sites/${queued.snapshotId}`) },
      });
    } catch (e) {
      toast.error('Could not start the website copy', { description: errorMessage(e) });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScanEye className="size-4 text-primary" /> Website copy
        </CardTitle>
        <CardDescription>Offline copy of the homepage, its brand, and a MonCha chatbot demo</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} className="py-6" />
        ) : isLoading ? (
          <Skeleton className="aspect-[16/10] w-full" />
        ) : !latest ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {hasWebsite ? 'No copy yet. Create one to preview the site offline and build the demo.' : 'This lead has no website to copy.'}
          </p>
        ) : (
          <>
            <Link
              href={`/sites/${latest.id}`}
              className="group block overflow-hidden rounded-lg border bg-muted/30 transition hover:border-primary/40"
            >
              <div className="relative aspect-[16/10] overflow-hidden">
                {latest.thumbnailPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={siteFileUrl(latest.thumbnailPath)}
                    alt="Desktop screenshot of the copied homepage"
                    className="size-full object-cover object-top transition group-hover:scale-[1.01]"
                  />
                ) : (
                  <div className="flex size-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                    {isOpen(latest.status) ? (
                      <>
                        <Loader2 className="size-5 animate-spin text-primary" />
                        {latest.status === 'running' ? 'Copying the homepage…' : 'Waiting for the worker…'}
                      </>
                    ) : latest.status === 'failed' ? (
                      <>
                        <AlertTriangle className="size-5 text-destructive" /> Copy failed
                      </>
                    ) : (
                      <>
                        <ImageOff className="size-5" /> No screenshot
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 border-t bg-card px-3 py-2 text-xs">
                <JobStatusBadge status={latest.status} />
                <span className="text-muted-foreground">
                  {latest.status === 'done'
                    ? `${formatNumber(latest.assetCount)} assets · ${formatBytes(latest.totalBytes)}`
                    : formatRelative(latest.createdAt)}
                </span>
              </div>
            </Link>
            {latest.status === 'failed' && latest.failureReason && (
              <p className="text-xs text-destructive">{failureText(latest.failureReason)}</p>
            )}
            {older.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Earlier copies</p>
                <ul className="divide-y rounded-lg border">
                  {older.map((s) => (
                    <li key={s.id}>
                      <Link href={`/sites/${s.id}`} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/50">
                        <JobStatusBadge status={s.status} />
                        <span className="text-muted-foreground">{formatRelative(s.createdAt)}</span>
                        <ArrowRight className="ml-auto size-3.5 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
      {(canEdit || latest) && (
        <CardFooter className="gap-2">
          {latest && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/sites/${latest.id}`}>Open</Link>
            </Button>
          )}
          {canEdit && (
            <Button size="sm" className="ml-auto" onClick={start} loading={create.isPending} disabled={!hasWebsite || busy}>
              {!create.isPending && <Copy />} {latest ? 'New copy' : 'Create website copy'}
            </Button>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
