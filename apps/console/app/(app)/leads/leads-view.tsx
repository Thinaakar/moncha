'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ExternalLink, Globe, MapPin, Plus, SearchX, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/app/page-header';
import { Pagination } from '@/components/app/pagination';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/app/states';
import { QUEUES, QueueBadge, VerdictBadge, WebsiteStatusBadge } from '@/components/app/status';
import { SearchInput } from '@/components/app/widgets';
import { useDiscoveryOptions, useLeads, useQueueCounts } from '@/lib/queries';
import { useUrlState } from '@/lib/use-url-state';
import { formatNumber, formatRelative, humanize } from '@/lib/format';
import type { LeadQueue } from '@/lib/types';
import { cn } from '@/lib/utils';

const ALL = 'ALL' as const;

export function LeadsView() {
  const router = useRouter();
  const url = useUrlState();
  const queue = (url.get('queue', 'QUALIFIED') as LeadQueue | typeof ALL) || 'QUALIFIED';
  const page = url.getNumber('page', 1);
  const pageSize = url.getNumber('pageSize', 25);
  const search = url.get('search');
  const country = url.get('country');

  const counts = useQueueCounts();
  const options = useDiscoveryOptions();
  const leads = useLeads({ queue, page, pageSize, search: search || undefined, country: country || undefined });
  const total = counts.data ? QUEUES.reduce((sum, q) => sum + counts.data[q.value], 0) : undefined;
  const tabs = [{ value: ALL, label: 'All', count: total }, ...QUEUES.map((q) => ({ ...q, count: counts.data?.[q.value] }))];
  const activeQueue = QUEUES.find((q) => q.value === queue);
  const filtered = Boolean(search || country);

  return (
    <div>
      <PageHeader
        title="Leads"
        description={activeQueue ? activeQueue.description : 'Every company discovered or imported, across all queues.'}
        actions={
          <Button asChild>
            <Link href="/leads/new">
              <Plus /> Add lead
            </Link>
          </Button>
        }
      />

      <div className="-mx-4 mb-4 overflow-x-auto px-4 scrollbar-thin sm:mx-0 sm:px-0">
        <div role="tablist" aria-label="Lead queues" className="inline-flex min-w-full gap-1 border-b sm:min-w-0">
          {tabs.map((tab) => {
            const active = tab.value === queue;
            return (
              <button
                key={tab.value}
                role="tab"
                aria-selected={active}
                onClick={() => url.set({ queue: tab.value === 'QUALIFIED' ? null : tab.value }, { resetPage: true })}
                className={cn(
                  '-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
                  active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    'rounded-full px-1.5 py-px text-[11px] tabular-nums',
                    active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {tab.count === undefined ? '·' : formatNumber(tab.count)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
          <SearchInput
            value={search}
            onChange={(v) => url.set({ search: v }, { resetPage: true })}
            placeholder="Search company or domain…"
            className="sm:max-w-sm sm:flex-1"
          />
          <Select value={country || 'any'} onValueChange={(v) => url.set({ country: v === 'any' ? null : v }, { resetPage: true })}>
            <SelectTrigger className="sm:w-48">
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
          {filtered && (
            <Button variant="ghost" size="sm" onClick={() => url.set({ search: null, country: null }, { resetPage: true })}>
              Clear filters
            </Button>
          )}
        </div>

        {leads.error ? (
          <ErrorState error={leads.error} onRetry={() => leads.refetch()} />
        ) : leads.isLoading || !leads.data ? (
          <TableSkeleton rows={8} columns={6} />
        ) : leads.data.items.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="No leads match these filters"
              description="Try a different search term or clear the filters."
              action={
                <Button variant="outline" size="sm" onClick={() => url.set({ search: null, country: null }, { resetPage: true })}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Users}
              title={activeQueue ? `No ${activeQueue.label.toLowerCase()} leads yet` : 'No leads yet'}
              description="Run a country crawl, import a CSV or add a lead by hand to fill your pipeline."
              action={
                <div className="flex gap-2">
                  <Button size="sm" asChild>
                    <Link href="/discovery">Start a crawl</Link>
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/imports">Import CSV</Link>
                  </Button>
                </div>
              }
            />
          )
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Company</TableHead>
                  <TableHead>Location</TableHead>
                  {queue === ALL && <TableHead>Queue</TableHead>}
                  <TableHead>Assistant</TableHead>
                  <TableHead>Website</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Added</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={cn(leads.isPlaceholderData && 'opacity-60 transition-opacity')}>
                {leads.data.items.map((lead) => {
                  const { company } = lead;
                  const site = company.website?.finalUrl || company.website?.url || (company.domain ? `https://${company.domain}` : null);
                  return (
                    <TableRow
                      key={lead.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/leads/${lead.id}`)}
                    >
                      <TableCell className="max-w-[280px]">
                        <Link
                          href={`/leads/${lead.id}`}
                          className="block truncate font-medium text-foreground hover:text-primary"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {company.name}
                        </Link>
                        {company.domain ? (
                          <a
                            href={site ?? '#'}
                            target="_blank"
                            rel="noreferrer noopener"
                            onClick={(e) => e.stopPropagation()}
                            className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-xs text-muted-foreground hover:text-primary"
                          >
                            <Globe className="size-3 shrink-0" />
                            <span className="truncate">{company.domain}</span>
                            <ExternalLink className="size-3 shrink-0 opacity-60" />
                          </a>
                        ) : (
                          <span className="mt-0.5 block text-xs text-muted-foreground">No domain</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {company.city || company.country ? (
                          <span className="inline-flex items-center gap-1.5">
                            <MapPin className="size-3.5 shrink-0" />
                            {[company.city, company.country].filter(Boolean).join(', ')}
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      {queue === ALL && (
                        <TableCell>
                          <QueueBadge queue={lead.queue} />
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <VerdictBadge verdict={lead.assistantVerdict} />
                          {lead.assistantVendor && (
                            <span className="text-xs text-muted-foreground">{lead.assistantVendor}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <WebsiteStatusBadge status={company.website?.status ?? (company.domain ? 'UNCHECKED' : null)} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {company.sourceRecords[0] ? humanize(company.sourceRecords[0].source) : 'Manual'}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{formatRelative(lead.createdAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination
              page={leads.data.page}
              pageSize={leads.data.pageSize}
              total={leads.data.total}
              totalPages={leads.data.totalPages}
              isFetching={leads.isFetching && !leads.isLoading}
              onPageChange={(p) => url.set({ page: p === 1 ? null : p })}
              onPageSizeChange={(s) => url.set({ pageSize: s === 25 ? null : s }, { resetPage: true })}
            />
          </>
        )}
      </Card>
    </div>
  );
}
