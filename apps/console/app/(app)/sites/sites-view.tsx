'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Activity, Globe, ImageOff, Loader2, ScanEye, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/app/page-header';
import { Pagination } from '@/components/app/pagination';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/app/states';
import { JobStatusBadge } from '@/components/app/status';
import { SearchInput } from '@/components/app/widgets';
import { failureText } from '@/components/sites/labels';
import { siteFileUrl, useSiteSnapshots } from '@/lib/queries';
import { useUrlState } from '@/lib/use-url-state';
import { formatBytes, formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import type { JobStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

const STATUSES: Array<{ value: JobStatus; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'running', label: 'Running' },
  { value: 'done', label: 'Done' },
  { value: 'failed', label: 'Failed' },
];

export function SitesView() {
  const router = useRouter();
  const url = useUrlState();
  const page = url.getNumber('page', 1);
  const pageSize = url.getNumber('pageSize', 25);
  const search = url.get('search');
  const status = (url.get('status') || undefined) as JobStatus | undefined;
  const sites = useSiteSnapshots({ page, pageSize, status, search: search || undefined });
  const filtered = Boolean(search || status);
  const anyOpen = sites.data?.items.some((s) => s.status === 'pending' || s.status === 'running');

  return (
    <div>
      <PageHeader
        title="Website copies"
        description="Offline copies of lead homepages with their brand details and a MonCha chatbot demo. Create one from a lead's page."
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
          <SearchInput
            value={search}
            onChange={(v) => url.set({ search: v }, { resetPage: true })}
            placeholder="Search company, domain or URL…"
            className="sm:max-w-sm sm:flex-1"
          />
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
          {filtered && (
            <Button variant="ghost" size="sm" onClick={() => url.set({ search: null, status: null }, { resetPage: true })}>
              Clear filters
            </Button>
          )}
          {anyOpen && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground sm:ml-auto">
              <Activity className={cn('size-3.5', sites.isFetching && 'animate-pulse text-primary')} /> Auto-refreshing
            </span>
          )}
        </div>

        {sites.error ? (
          <ErrorState error={sites.error} onRetry={() => sites.refetch()} />
        ) : sites.isLoading || !sites.data ? (
          <TableSkeleton rows={8} columns={6} />
        ) : sites.data.items.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="No copies match these filters"
              description="Try a different search term or status."
              action={
                <Button variant="outline" size="sm" onClick={() => url.set({ search: null, status: null }, { resetPage: true })}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={ScanEye}
              title="No website copies yet"
              description="Open a lead and choose Create website copy to capture its homepage."
              action={
                <Button size="sm" asChild>
                  <Link href="/leads">Go to leads</Link>
                </Button>
              }
            />
          )
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-28">Preview</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Assets</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={cn(sites.isPlaceholderData && 'opacity-60 transition-opacity')}>
                {sites.data.items.map((s) => {
                  const open = s.status === 'pending' || s.status === 'running';
                  return (
                    <TableRow key={s.id} className="cursor-pointer" onClick={() => router.push(`/sites/${s.id}`)}>
                      <TableCell>
                        <div className="flex aspect-[16/10] w-24 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
                          {s.thumbnailPath ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={siteFileUrl(s.thumbnailPath)} alt="" loading="lazy" className="size-full object-cover object-top" />
                          ) : open ? (
                            <Loader2 className="size-4 animate-spin text-primary" />
                          ) : (
                            <ImageOff className="size-4 text-muted-foreground" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[320px]">
                        <Link
                          href={`/sites/${s.id}`}
                          className="block truncate font-medium text-foreground hover:text-primary"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {s.company?.name ?? 'Unknown company'}
                        </Link>
                        <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                          <Globe className="size-3 shrink-0" />
                          <span className="truncate">{(s.finalUrl ?? s.sourceUrl).replace(/^https?:\/\//, '')}</span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <JobStatusBadge status={s.status} />
                        {s.status === 'failed' && s.failureReason && (
                          <p className="mt-1 max-w-56 truncate text-xs text-muted-foreground" title={failureText(s.failureReason) ?? undefined}>
                            {failureText(s.failureReason)}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {s.status === 'done' ? formatNumber(s.assetCount) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {s.status === 'done' ? formatBytes(s.totalBytes) : '—'}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        <span title={formatDateTime(s.createdAt)}>{formatRelative(s.createdAt)}</span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination
              page={sites.data.page}
              pageSize={sites.data.pageSize}
              total={sites.data.total}
              totalPages={sites.data.totalPages}
              isFetching={sites.isFetching && !sites.isLoading}
              onPageChange={(p) => url.set({ page: p === 1 ? null : p })}
              onPageSizeChange={(s) => url.set({ pageSize: s === 25 ? null : s }, { resetPage: true })}
            />
          </>
        )}
      </Card>
    </div>
  );
}
