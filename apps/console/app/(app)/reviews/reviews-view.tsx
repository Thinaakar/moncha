'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ClipboardCheck, ExternalLink, Gavel, MapPin, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/misc';
import { PageHeader } from '@/components/app/page-header';
import { Pagination } from '@/components/app/pagination';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/app/states';
import { VerdictBadge } from '@/components/app/status';
import { SearchInput } from '@/components/app/widgets';
import { useCanEdit } from '@/components/app/user-context';
import { useDiscoveryOptions, useQueueCounts, useReviews } from '@/lib/queries';
import { useUrlState } from '@/lib/use-url-state';
import { formatDateTime, formatNumber, formatRelative, humanize } from '@/lib/format';
import type { ReviewTask } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ResolveDialog } from './resolve-dialog';

type Status = 'open' | 'resolved' | 'all';

function Confidence({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const tone = pct >= 75 ? 'bg-success' : pct >= 45 ? 'bg-warning' : 'bg-destructive';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
}

function ReviewCard({ task, onResolve, canEdit }: { task: ReviewTask; onResolve: () => void; canEdit: boolean }) {
  const { company } = task.lead;
  const site = company.website?.finalUrl || company.website?.url || (company.domain ? `https://${company.domain}` : null);
  return (
    <div className="grid gap-4 p-5 transition-colors hover:bg-muted/20 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] lg:items-center">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/leads/${task.leadId}`} className="truncate font-semibold hover:text-primary">
            {company.name}
          </Link>
          {task.status === 'open' ? (
            <Badge variant="warning" dot>
              Open
            </Badge>
          ) : (
            <Badge variant="success">
              <CheckCircle2 /> Resolved
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {site && (
            <a href={site} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-primary">
              {company.domain} <ExternalLink className="size-3" />
            </a>
          )}
          {(company.city || company.country) && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" /> {[company.city, company.country].filter(Boolean).join(', ')}
            </span>
          )}
          <span>Opened {formatRelative(task.createdAt)}</span>
        </div>
        <p className="text-sm">
          <span className="text-muted-foreground">Reason: </span>
          {humanize(task.reason)}
        </p>
        {task.status === 'resolved' && (
          <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{task.resolvedBy}</span> · {formatDateTime(task.resolvedAt)} —{' '}
            {task.resolutionNote}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border bg-muted/20 p-3 text-xs">
        <div>
          <p className="text-muted-foreground">Audit verdict</p>
          <div className="mt-1">
            <VerdictBadge verdict={task.audit.verdict} />
          </div>
        </div>
        <div>
          <p className="text-muted-foreground">Confidence</p>
          <div className="mt-1.5">
            <Confidence value={task.audit.confidence} />
          </div>
        </div>
        <div>
          <p className="text-muted-foreground">Method · kind</p>
          <p className="mt-0.5 font-medium">
            {task.audit.method.toUpperCase()} · {humanize(task.audit.kind)}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Vendor</p>
          <p className="mt-0.5 truncate font-medium">{task.audit.vendor || '—'}</p>
        </div>
        {task.audit.failureReason && (
          <div className="col-span-2">
            <p className="text-muted-foreground">Failure</p>
            <p className="mt-0.5 text-destructive">{humanize(task.audit.failureReason)}</p>
          </div>
        )}
      </div>

      <div className="flex gap-2 lg:flex-col">
        {task.status === 'open' && canEdit && (
          <Button onClick={onResolve}>
            <Gavel /> Resolve
          </Button>
        )}
        <Button variant="outline" asChild>
          <Link href={`/leads/${task.leadId}`}>View lead</Link>
        </Button>
      </div>
    </div>
  );
}

export function ReviewsView() {
  const url = useUrlState();
  const canEdit = useCanEdit();
  const status = (url.get('status', 'open') as Status) || 'open';
  const page = url.getNumber('page', 1);
  const pageSize = url.getNumber('pageSize', 25);
  const search = url.get('search');
  const country = url.get('country');
  const counts = useQueueCounts();
  const options = useDiscoveryOptions();
  const reviews = useReviews({ status, page, pageSize, search: search || undefined, country: country || undefined });
  const [active, setActive] = useState<ReviewTask | null>(null);
  const filtered = Boolean(search || country);

  return (
    <div>
      <PageHeader
        title="Review queue"
        description="Audits that were not confident enough to qualify a lead on their own. Oldest first — work through them in order."
        actions={
          counts.data && (
            <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
              <ClipboardCheck className="size-4 text-warning" />
              <span className="font-semibold tabular-nums">{formatNumber(counts.data.openReviewTasks)}</span>
              <span className="text-muted-foreground">open</span>
            </div>
          )
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
          <Tabs value={status} onValueChange={(v) => url.set({ status: v === 'open' ? null : v }, { resetPage: true })}>
            <TabsList>
              <TabsTrigger value="open">Open</TabsTrigger>
              <TabsTrigger value="resolved">Resolved</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-1 flex-col gap-3 sm:flex-row lg:justify-end">
            <SearchInput
              value={search}
              onChange={(v) => url.set({ search: v }, { resetPage: true })}
              placeholder="Search company or domain…"
              className="sm:w-72"
            />
            <Select value={country || 'any'} onValueChange={(v) => url.set({ country: v === 'any' ? null : v }, { resetPage: true })}>
              <SelectTrigger className="sm:w-44">
                <SelectValue placeholder="Country" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">All countries</SelectItem>
                {options.data?.countries.map((c) => (
                  <SelectItem key={c.code} value={c.name}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {reviews.error ? (
          <ErrorState error={reviews.error} onRetry={() => reviews.refetch()} />
        ) : reviews.isLoading || !reviews.data ? (
          <TableSkeleton rows={5} columns={3} />
        ) : reviews.data.items.length === 0 ? (
          filtered ? (
            <EmptyState icon={SearchX} title="No reviews match these filters" description="Try another search or country." />
          ) : status === 'open' ? (
            <EmptyState
              icon={CheckCircle2}
              title="Inbox zero"
              description="Every uncertain audit has been reviewed. New tasks appear here automatically."
            />
          ) : (
            <EmptyState icon={ClipboardCheck} title="No reviews yet" description="Resolved reviews will be listed here." />
          )
        ) : (
          <>
            <div className={cn('divide-y', reviews.isPlaceholderData && 'opacity-60')}>
              {reviews.data.items.map((task) => (
                <ReviewCard key={task.id} task={task} canEdit={canEdit} onResolve={() => setActive(task)} />
              ))}
            </div>
            <Pagination
              page={reviews.data.page}
              pageSize={reviews.data.pageSize}
              total={reviews.data.total}
              totalPages={reviews.data.totalPages}
              isFetching={reviews.isFetching && !reviews.isLoading}
              onPageChange={(p) => url.set({ page: p === 1 ? null : p })}
              onPageSizeChange={(s) => url.set({ pageSize: s === 25 ? null : s }, { resetPage: true })}
            />
          </>
        )}
      </Card>

      <ResolveDialog task={active} open={Boolean(active)} onOpenChange={(o) => !o && setActive(null)} />
    </div>
  );
}
