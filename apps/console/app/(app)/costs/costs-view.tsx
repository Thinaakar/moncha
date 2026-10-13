'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Bot,
  Coins,
  Cpu,
  Database,
  Github,
  Globe,
  HardDrive,
  ScanEye,
  SearchX,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/app/page-header';
import { Pagination } from '@/components/app/pagination';
import { EmptyState, ErrorState, InlineAlert, TableSkeleton } from '@/components/app/states';
import { SearchInput, StatCard } from '@/components/app/widgets';
import {
  CostFootnote,
  CostValue,
  DailySpendChart,
  RangePicker,
  ReceiptLine,
  SplitBar,
  TokenPair,
  useCostRange,
} from '@/components/costs/cost-widgets';
import { useCostSummary, useCostWebsites } from '@/lib/queries';
import { useUrlState } from '@/lib/use-url-state';
import { formatBytes, formatCompact, formatDateTime, formatNumber, formatRelative, formatUsd } from '@/lib/format';
import type { SiteCostSort, SiteCostSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

const SORTS: Array<{ value: SiteCostSort; label: string }> = [
  { value: 'cost', label: 'Highest AI cost' },
  { value: 'tokens', label: 'Most tokens' },
  { value: 'size', label: 'Largest copy' },
  { value: 'newest', label: 'Newest' },
];

export function CostsView() {
  const { days, label } = useCostRange();
  const summary = useCostSummary(days);
  const s = summary.data;
  const tokens = s ? s.copyTokens.input + s.copyTokens.output + s.auditTokens.input + s.auditTokens.output : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Costs"
        description="What it costs to create each website: AI tokens for the brand extraction and the website audit, plus storage for the copy. GitHub repos and Cloudflare Workers are free on the current plans."
        actions={<RangePicker />}
        className="pb-0"
      />

      {summary.error && !s ? (
        <Card>
          <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="AI spend"
              icon={Coins}
              loading={!s}
              value={s && <CostValue usd={s.aiCostUsd} estimated={s.estimatedCostUsd > 0} unpriced={s.pricing.unpricedModels.length > 0} />}
              hint={s && `${formatNumber(s.websites)} websites · ${label.toLowerCase()}`}
            />
            <StatCard
              label="Average per website"
              icon={Sparkles}
              tone="success"
              loading={!s}
              value={s ? formatUsd(s.averagePerWebsiteUsd) : null}
              hint={s?.averageTokensPerWebsite ? `${formatCompact(s.averageTokensPerWebsite)} tokens each` : 'No websites yet'}
            />
            <StatCard
              label="Tokens used"
              icon={Cpu}
              tone="info"
              loading={!s}
              value={s ? formatCompact(tokens) : null}
              hint={
                s && `${formatCompact(s.copyTokens.input + s.auditTokens.input)} in · ${formatCompact(s.copyTokens.output + s.auditTokens.output)} out`
              }
            />
            <StatCard
              label="Storage"
              icon={HardDrive}
              tone="warning"
              loading={!s}
              value={s ? `${formatUsd(s.storageUsdPerMonth)}/mo` : null}
              hint={s && `${formatBytes(s.storageBytes)} of copies in R2`}
            />
          </div>

          {s && s.pricing.unpricedModels.length > 0 && (
            <InlineAlert variant="warning" icon={AlertTriangle} title="Some models have no known price">
              Tokens from {s.pricing.unpricedModels.join(', ')} are not in the totals. Add a price with{' '}
              <span className="font-mono text-xs">LLM_PRICE_OVERRIDES</span> on the worker.
            </InlineAlert>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Daily AI spend</CardTitle>
                <CardDescription>By the day each website was copied (UTC)</CardDescription>
              </CardHeader>
              <CardContent>{s ? <DailySpendChart byDay={s.byDay} since={s.since} /> : <div className="h-52 animate-pulse rounded-lg bg-muted" />}</CardContent>
            </Card>
            <SpendBreakdown summary={s} />
          </div>

          <ModelsCard summary={s} />
        </>
      )}

      <WebsitesCard />

      {s && <PricingNote summary={s} />}
    </div>
  );
}

function SpendBreakdown({ summary: s }: { summary: SiteCostSummary | undefined }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Where the money goes</CardTitle>
        <CardDescription>One-time AI cost per step, then hosting</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {s ? (
          <>
            <SplitBar
              parts={[
                { label: 'Brand extraction', hint: `${formatNumber(s.copies)} copies`, value: s.copyCostUsd, className: 'bg-primary' },
                { label: 'Website audit', hint: `${formatNumber(s.aiAudits)} AI checks`, value: s.auditCostUsd, className: 'bg-info' },
              ]}
            />
            <ul className="divide-y border-t">
              <ReceiptLine icon={Database} label="R2 storage" detail={formatBytes(s.storageBytes)} amount={`${formatUsd(s.storageUsdPerMonth)}/mo`} />
              <ReceiptLine icon={Github} label="GitHub repositories" detail="One private repo per website" amount="Free" free />
              <ReceiptLine icon={Globe} label="Cloudflare Workers" detail="One Worker per website" amount="Free" free />
            </ul>
            {s.aiCostUsd > 0 && (
              <CostFootnote>
                {formatUsd(s.exactCostUsd)} reported by OpenRouter, {formatUsd(s.estimatedCostUsd)} estimated from tokens.
              </CostFootnote>
            )}
          </>
        ) : (
          <div className="h-52 animate-pulse rounded-lg bg-muted" />
        )}
      </CardContent>
    </Card>
  );
}

function ModelsCard({ summary: s }: { summary: SiteCostSummary | undefined }) {
  const total = s?.aiCostUsd ?? 0;
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle>By model</CardTitle>
        <CardDescription>Each AI model, what it is used for and its listed price per million tokens</CardDescription>
      </CardHeader>
      {!s ? (
        <TableSkeleton rows={2} columns={6} />
      ) : s.byModel.length === 0 ? (
        <EmptyState icon={Bot} title="No AI calls in this period" className="py-10" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Model</TableHead>
              <TableHead>Used for</TableHead>
              <TableHead className="text-right">Calls</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="text-right">Price / 1M (in · out)</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="w-40">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {s.byModel.map((m) => (
              <TableRow key={`${m.kind}-${m.model}`}>
                <TableCell className="font-mono text-xs">{m.model ?? 'Unknown'}</TableCell>
                <TableCell>
                  <Badge variant={m.kind === 'copy' ? 'default' : 'info'}>
                    {m.kind === 'copy' ? <ScanEye /> : <Bot />}
                    {m.kind === 'copy' ? 'Brand extraction' : 'Website audit'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(m.calls)}</TableCell>
                <TableCell className="text-right">
                  <TokenPair tokens={m.tokens} />
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {m.price ? `${formatUsd(m.price.inputPerMillionUsd)} · ${formatUsd(m.price.outputPerMillionUsd)}` : 'Unknown'}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatUsd(m.costUsd)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn('h-full rounded-full', m.kind === 'copy' ? 'bg-primary' : 'bg-info')}
                        style={{ width: `${total > 0 ? (m.costUsd / total) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">
                      {total > 0 ? `${Math.round((m.costUsd / total) * 100)}%` : '—'}
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function WebsitesCard() {
  const router = useRouter();
  const url = useUrlState();
  const { days, range } = useCostRange();
  const page = url.getNumber('page', 1);
  const pageSize = url.getNumber('pageSize', 25);
  const search = url.get('search');
  const sort = (SORTS.some((s) => s.value === url.get('sort')) ? url.get('sort') : 'cost') as SiteCostSort;
  const websites = useCostWebsites({ days, page, pageSize, search: search || undefined, sort });
  const data = websites.data;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle>Cost per website</CardTitle>
        <CardDescription>Every website copied in this period with its tokens, AI cost and storage. Open one for every AI call behind it.</CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-3 border-y p-4 sm:flex-row sm:items-center">
        <SearchInput
          value={search}
          onChange={(v) => url.set({ search: v }, { resetPage: true })}
          placeholder="Search company or domain…"
          className="sm:max-w-sm sm:flex-1"
        />
        <Select value={sort} onValueChange={(v) => url.set({ sort: v === 'cost' ? null : v }, { resetPage: true })}>
          <SelectTrigger className="sm:w-48">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {websites.error && !data ? (
        <ErrorState error={websites.error} onRetry={() => websites.refetch()} />
      ) : !data ? (
        <TableSkeleton rows={8} columns={7} />
      ) : data.items.length === 0 ? (
        search ? (
          <EmptyState
            icon={SearchX}
            title="No websites match this search"
            action={
              <Button variant="outline" size="sm" onClick={() => url.set({ search: null }, { resetPage: true })}>
                Clear search
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Coins}
            title="No websites copied in this period"
            description={range === 'all' ? 'Costs appear once the first website copy runs.' : 'Try a longer time range.'}
          />
        )
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Website</TableHead>
                <TableHead className="text-right">Copies</TableHead>
                <TableHead className="text-right">AI audits</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">AI cost</TableHead>
                <TableHead className="text-right">Storage</TableHead>
                <TableHead>Live</TableHead>
                <TableHead className="text-right">Copied</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={cn(websites.isPlaceholderData && 'opacity-60 transition-opacity')}>
              {data.items.map((w) => {
                const tokens = {
                  input: w.copyTokens.input + w.auditTokens.input,
                  output: w.copyTokens.output + w.auditTokens.output,
                };
                return (
                  <TableRow key={w.leadId} className="cursor-pointer" onClick={() => router.push(`/costs/${w.leadId}`)}>
                    <TableCell className="max-w-[300px]">
                      <Link
                        href={`/costs/${w.leadId}`}
                        className="block truncate font-medium text-foreground hover:text-primary"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {w.company.name}
                      </Link>
                      <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <Globe className="size-3 shrink-0" />
                        <span className="truncate">{w.company.domain ?? '—'}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(w.copies)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(w.aiAudits)}</TableCell>
                    <TableCell className="text-right">
                      <TokenPair tokens={tokens} />
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      <CostValue usd={w.aiCostUsd} estimated={w.estimated} unpriced={w.unpriced} className="justify-end" />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums" title={formatBytes(w.storageBytes)}>
                      {formatUsd(w.storageUsdPerMonth)}/mo
                    </TableCell>
                    <TableCell>
                      {w.latest.workerStatus === 'deployed' && w.latest.workerUrl ? (
                        <a
                          href={w.latest.workerUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex max-w-40 items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          <Globe className="size-3.5 shrink-0" />
                          <span className="truncate">{w.latest.workerUrl.replace(/^https?:\/\//, '').split('.')[0]}</span>
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      <span title={formatDateTime(w.lastCopyAt)}>{formatRelative(w.lastCopyAt)}</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            totalPages={data.totalPages}
            isFetching={websites.isFetching && !websites.isPlaceholderData}
            onPageChange={(p) => url.set({ page: p === 1 ? null : p })}
            onPageSizeChange={(size) => url.set({ pageSize: size === 25 ? null : size }, { resetPage: true })}
          />
        </>
      )}
    </Card>
  );
}

function PricingNote({ summary: s }: { summary: SiteCostSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>How costs are calculated</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 text-sm md:grid-cols-2">
        <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
          <li>
            <span className="text-foreground">AI cost</span> is one-time: the brand extraction of each copy (retries included) plus
            the lead&apos;s AI website audit.
          </li>
          <li>New AI calls store the exact amount OpenRouter charged. Older calls are estimated from their tokens × the price below.</li>
          <li>
            <span className="text-foreground">Storage</span> is the copy&apos;s files in R2 at{' '}
            {formatUsd(s.pricing.r2StorageUsdPerGbMonth)} per GB-month (the first 10 GB are free on the account).
          </li>
          <li>GitHub repos and Cloudflare Workers are free on the current plans. Railway compute is shared and not split per website.</li>
        </ul>
        <div>
          <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase">Model prices per 1M tokens</p>
          {s.pricing.models.length ? (
            <ul className="divide-y rounded-lg border">
              {s.pricing.models.map((m) => (
                <li key={m.model} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <span className="truncate font-mono">{m.model}</span>
                  <span className="shrink-0 tabular-nums">
                    {formatUsd(m.inputPerMillionUsd)} in · {formatUsd(m.outputPerMillionUsd)} out
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No prices available.</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {s.pricing.source === 'openrouter'
              ? `From OpenRouter's model list, updated ${formatRelative(s.pricing.fetchedAt)}.`
              : s.pricing.source === 'overrides'
                ? 'From LLM_PRICE_OVERRIDES (OpenRouter could not be reached).'
                : 'OpenRouter could not be reached, so older calls cannot be estimated yet.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
