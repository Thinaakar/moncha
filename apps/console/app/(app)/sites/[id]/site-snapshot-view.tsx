'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Code2,
  ExternalLink,
  Info,
  Loader2,
  MonitorPlay,
  Package,
  Palette,
  RefreshCw,
  ScanEye,
  Smartphone,
  Monitor,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState, ErrorState, InlineAlert } from '@/components/app/states';
import { JobStatusBadge } from '@/components/app/status';
import { useCanEdit } from '@/components/app/user-context';
import { AssetsTable } from '@/components/sites/assets-table';
import { BrandPanel } from '@/components/sites/brand-panel';
import { failureText } from '@/components/sites/labels';
import { PreviewFrame } from '@/components/sites/preview-frame';
import { SnapshotDetails } from '@/components/sites/snapshot-details';
import { SourceViewer } from '@/components/sites/source-viewer';
import { TabBar } from '@/components/sites/tabs';
import { ApiError, errorMessage } from '@/lib/api';
import { siteFileUrl, useCreateSiteSnapshot, useSiteSnapshot } from '@/lib/queries';
import { useUrlState } from '@/lib/use-url-state';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { SiteSnapshotDetail } from '@/lib/types';

type Tab = 'preview' | 'source' | 'brand' | 'assets' | 'details';
const TABS: Tab[] = ['preview', 'source', 'brand', 'assets', 'details'];

function Screenshots({ snapshot }: { snapshot: SiteSnapshotDetail }) {
  if (!snapshot.files) return null;
  const shots = [
    { label: 'Desktop', icon: Monitor, path: snapshot.files.desktop, className: 'sm:col-span-3' },
    { label: 'Mobile', icon: Smartphone, path: snapshot.files.mobile, className: 'sm:col-span-1' },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Screenshots</CardTitle>
        <CardDescription>Taken in a real browser while copying; they show the page as it looked online</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-4">
        {shots.map((shot) => (
          <a
            key={shot.label}
            href={siteFileUrl(shot.path)}
            target="_blank"
            rel="noreferrer noopener"
            className={`group block overflow-hidden rounded-lg border bg-muted/30 ${shot.className}`}
          >
            <div className="flex items-center gap-1.5 border-b bg-card px-3 py-2 text-xs font-medium">
              <shot.icon className="size-3.5 text-muted-foreground" /> {shot.label}
              <ExternalLink className="ml-auto size-3 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
            </div>
            <div className="max-h-[420px] overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={siteFileUrl(shot.path)} alt={`${shot.label} screenshot`} loading="lazy" className="w-full" />
            </div>
          </a>
        ))}
      </CardContent>
    </Card>
  );
}

export function SiteSnapshotView({ id }: { id: string }) {
  const router = useRouter();
  const url = useUrlState();
  const canEdit = useCanEdit();
  const { data: snapshot, error, isLoading, refetch } = useSiteSnapshot(id);
  const rerun = useCreateSiteSnapshot(snapshot?.leadId ?? '');

  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <Card>
        {notFound ? (
          <EmptyState
            icon={ScanEye}
            title="Website copy not found"
            description="It may belong to another workspace."
            action={
              <Button variant="outline" asChild>
                <Link href="/sites">
                  <ArrowLeft /> All website copies
                </Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={error} onRetry={() => refetch()} />
        )}
      </Card>
    );
  }

  if (isLoading || !snapshot) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-8 w-72" />
        </div>
        <Skeleton className="h-10 w-full max-w-xl" />
        <Skeleton className="h-[520px] w-full" />
      </div>
    );
  }

  const done = snapshot.status === 'done' && Boolean(snapshot.files && snapshot.previewBase);
  const open = snapshot.status === 'pending' || snapshot.status === 'running';
  const requested = url.get('tab') as Tab;
  const tab: Tab = TABS.includes(requested) && (done || requested === 'details') ? requested : done ? 'preview' : 'details';
  const company = snapshot.company;
  const liveUrl = snapshot.finalUrl ?? snapshot.sourceUrl;

  async function startRerun() {
    try {
      const queued = await rerun.mutateAsync();
      toast.success(queued.deduped ? 'A copy of this website is already in progress' : 'New website copy started');
      router.push(`/sites/${queued.snapshotId}`);
    } catch (e) {
      toast.error('Could not start the website copy', { description: errorMessage(e) });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: 'Leads', href: '/leads' },
          { label: company?.name ?? 'Lead', href: `/leads/${snapshot.leadId}` },
          { label: 'Website copy' },
        ]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {company?.name ?? 'Website copy'}
            <JobStatusBadge status={snapshot.status} />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="truncate">{liveUrl.replace(/^https?:\/\//, '')}</span>
            <span title={formatDateTime(snapshot.finishedAt ?? snapshot.createdAt)}>
              {snapshot.finishedAt ? `Captured ${formatRelative(snapshot.finishedAt)}` : `Requested ${formatRelative(snapshot.createdAt)}`}
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={liveUrl} target="_blank" rel="noreferrer noopener">
                <ExternalLink /> Open original site
              </a>
            </Button>
            {canEdit && (
              <Button onClick={startRerun} loading={rerun.isPending} disabled={open}>
                {!rerun.isPending && <RefreshCw />} Re-run
              </Button>
            )}
          </>
        }
        className="pb-0"
      />

      {open && (
        <InlineAlert variant="info" icon={Loader2} title={snapshot.status === 'running' ? 'Copying the homepage…' : 'Waiting for the worker…'} className="[&_svg]:animate-spin">
          The worker downloads the HTML, opens the page on desktop and mobile, copies the assets, extracts the brand and
          uploads everything. This usually takes one to three minutes; this page updates by itself.
        </InlineAlert>
      )}
      {snapshot.status === 'failed' && (
        <InlineAlert variant="destructive" icon={AlertTriangle} title="The website could not be copied">
          {failureText(snapshot.failureReason) ?? 'Unknown error.'} {canEdit && 'You can re-run the copy later.'}
        </InlineAlert>
      )}
      {snapshot.status === 'done' && !done && (
        <InlineAlert variant="warning" icon={Info} title="Files are not available">
          The copy finished, but the file links could not be created. Check the site agent settings on the backend.
        </InlineAlert>
      )}

      <TabBar<Tab>
        label="Website copy sections"
        value={tab}
        onChange={(value) => url.set({ tab: value === 'preview' ? null : value })}
        tabs={[
          { value: 'preview', label: 'Preview', icon: MonitorPlay, disabled: !done },
          { value: 'source', label: 'View source', icon: Code2, disabled: !done },
          { value: 'brand', label: 'Brand', icon: Palette, disabled: !done },
          { value: 'assets', label: 'Assets', icon: Package, disabled: !done, count: done ? snapshot.assetCount : undefined },
          { value: 'details', label: 'Details', icon: Info },
        ]}
      />

      {tab === 'preview' && snapshot.files && (
        <div className="space-y-6">
          <PreviewFrame files={snapshot.files} warnings={snapshot.warnings} />
          <Screenshots snapshot={snapshot} />
        </div>
      )}
      {tab === 'source' && snapshot.files && <SourceViewer snapshotId={snapshot.id} sourcePath={snapshot.files.source} />}
      {tab === 'brand' && <BrandPanel brand={snapshot.brand} manifest={snapshot.manifest} previewBase={snapshot.previewBase} />}
      {tab === 'assets' && <AssetsTable manifest={snapshot.manifest} previewBase={snapshot.previewBase} />}
      {tab === 'details' && <SnapshotDetails snapshot={snapshot} />}
    </div>
  );
}
