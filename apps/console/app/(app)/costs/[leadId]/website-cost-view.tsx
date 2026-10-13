'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  Bot,
  Coins,
  Cpu,
  Database,
  ExternalLink,
  Github,
  Globe,
  HardDrive,
  Layers,
  ScanEye,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState, ErrorState } from '@/components/app/states';
import { JobStatusBadge } from '@/components/app/status';
import { StatCard } from '@/components/app/widgets';
import { CostFootnote, CostValue, ReceiptLine, SplitBar, TokenPair } from '@/components/costs/cost-widgets';
import { ApiError } from '@/lib/api';
import { useCostWebsite } from '@/lib/queries';
import { formatBytes, formatCompact, formatDateTime, formatNumber, formatUsd, humanize } from '@/lib/format';
import type { CostTokens, JobStatus, SiteCostWebsiteDetail } from '@/lib/types';

type CallRow = {
  key: string;
  at: string;
  kind: 'copy' | 'audit';
  model: string | null;
  tokens: CostTokens;
  costUsd: number | null;
  estimated: boolean;
  status?: JobStatus;
  verdict?: string;
  href?: string;
  attempts?: number;
};

function callRows(detail: SiteCostWebsiteDetail): CallRow[] {
  const copies: CallRow[] = detail.copyRuns.map((c) => ({
    key: c.snapshotId,
    at: c.createdAt,
    kind: 'copy',
    model: c.model,
    tokens: c.tokens,
    costUsd: c.costUsd,
    estimated: c.estimated,
    status: c.status,
    href: `/sites/${c.snapshotId}`,
    attempts: c.attempts,
  }));
  const audits: CallRow[] = detail.auditRuns.map((a) => ({
    key: a.auditId,
    at: a.auditedAt,
    kind: 'audit',
    model: a.model,
    tokens: a.tokens,
    costUsd: a.costUsd,
    estimated: a.estimated,
    verdict: a.verdict,
  }));
  return [...copies, ...audits].sort((a, b) => b.at.localeCompare(a.at));
}

export function WebsiteCostView({ leadId }: { leadId: string }) {
  const { data: d, error, isLoading, refetch } = useCostWebsite(leadId);

  if (error && !d) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <Card>
        {notFound ? (
          <EmptyState
            icon={Coins}
            title="No costs for this lead yet"
            description="Costs appear once a website copy has been made for this lead."
            action={
              <div className="flex gap-2">
                <Button variant="outline" asChild>
                  <Link href="/costs">
                    <ArrowLeft /> All costs
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`/leads/${leadId}`}>Open lead</Link>
                </Button>
              </div>
            }
          />
        ) : (
          <ErrorState error={error} onRetry={() => refetch()} />
        )}
      </Card>
    );
  }

  if (isLoading || !d) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-8 w-72" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const tokens = {
    input: d.copyTokens.input + d.auditTokens.input,
    output: d.copyTokens.output + d.auditTokens.output,
  };
  const calls = callRows(d);
  const live = d.latest.workerStatus === 'deployed' ? d.latest.workerUrl : null;
  const repoUrl = d.latest.githubRepo ? `https://github.com/${d.latest.githubRepo}` : null;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Costs', href: '/costs' }, { label: d.company.name }]}
        title={d.company.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {d.company.domain && (
              <span className="inline-flex items-center gap-1">
                <Globe className="size-3.5" /> {d.company.domain}
              </span>
            )}
            <span>First copied {formatDateTime(d.firstCopyAt)}</span>
          </span>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/leads/${d.leadId}`}>
                <Users /> Lead
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/sites/${d.latest.snapshotId}`}>
                <ScanEye /> Latest copy
              </Link>
            </Button>
            {live && (
              <Button asChild>
                <a href={live} target="_blank" rel="noreferrer noopener">
                  <ExternalLink /> Live website
                </a>
              </Button>
            )}
          </>
        }
        className="pb-0"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="AI cost to create"
          icon={Coins}
          value={<CostValue usd={d.aiCostUsd} estimated={d.estimated} unpriced={d.unpriced} />}
          hint="One-time, all steps and retries"
        />
        <StatCard label="Tokens" icon={Cpu} tone="info" value={formatCompact(tokens.input + tokens.output)} hint={<TokenPair tokens={tokens} />} />
        <StatCard
          label="Storage"
          icon={HardDrive}
          tone="warning"
          value={`${formatUsd(d.storageUsdPerMonth)}/mo`}
          hint={`${formatBytes(d.storageBytes)} in R2`}
        />
        <StatCard
          label="AI calls"
          icon={Layers}
          tone="muted"
          value={formatNumber(calls.filter((c) => c.tokens.input + c.tokens.output > 0).length)}
          hint={`${formatNumber(d.copies)} cop${d.copies === 1 ? 'y' : 'ies'} · ${formatNumber(d.aiAudits)} AI audit${d.aiAudits === 1 ? '' : 's'}`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Cost receipt</CardTitle>
            <CardDescription>Everything this website costs, step by step</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <SplitBar
              parts={[
                { label: 'Brand extraction', value: d.copyCostUsd, className: 'bg-primary' },
                { label: 'Website audit', value: d.auditCostUsd, className: 'bg-info' },
              ]}
            />
            <ul className="divide-y border-t">
              <ReceiptLine
                icon={ScanEye}
                label="Brand extraction"
                detail={<TokenPair tokens={d.copyTokens} />}
                amount={<CostValue usd={d.copyCostUsd} estimated={d.copyRuns.some((r) => r.estimated)} />}
              />
              <ReceiptLine
                icon={Bot}
                label="Website audit (AI check)"
                detail={d.aiAudits ? <TokenPair tokens={d.auditTokens} /> : 'Decided without AI'}
                amount={<CostValue usd={d.auditCostUsd} estimated={d.auditRuns.some((r) => r.estimated)} />}
              />
              <ReceiptLine
                icon={Github}
                label="GitHub repository"
                detail={
                  repoUrl ? (
                    <a href={repoUrl} target="_blank" rel="noreferrer noopener" className="font-mono text-primary hover:underline">
                      {d.latest.githubRepo}
                    </a>
                  ) : (
                    'Not pushed yet'
                  )
                }
                amount="Free"
                free
              />
              <ReceiptLine
                icon={Globe}
                label="Cloudflare Worker"
                detail={
                  live ? (
                    <a href={live} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                      {live.replace(/^https?:\/\//, '')}
                    </a>
                  ) : (
                    'Not deployed yet'
                  )
                }
                amount="Free"
                free
              />
              <ReceiptLine
                icon={Database}
                label="R2 storage"
                detail={`${formatBytes(d.storageBytes)} across ${d.copies} cop${d.copies === 1 ? 'y' : 'ies'}`}
                amount={`${formatUsd(d.storageUsdPerMonth)}/mo`}
              />
            </ul>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
              <span className="text-sm font-medium">Total to create</span>
              <CostValue usd={d.aiCostUsd} estimated={d.estimated} unpriced={d.unpriced} className="font-display text-lg font-semibold" />
            </div>
            {d.estimated && (
              <CostFootnote>
                Calls made before cost tracking are estimated from their tokens × the model&apos;s current OpenRouter price.
              </CostFootnote>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden lg:col-span-3">
          <CardHeader className="pb-4">
            <CardTitle>AI calls</CardTitle>
            <CardDescription>Every AI step behind this website, newest first</CardDescription>
          </CardHeader>
          {calls.length === 0 ? (
            <EmptyState icon={Bot} title="No AI calls" className="py-10" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>When</TableHead>
                  <TableHead>Step</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((c) => (
                  <TableRow key={`${c.kind}-${c.key}`}>
                    <TableCell className="text-muted-foreground whitespace-nowrap">{formatDateTime(c.at)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={c.kind === 'copy' ? 'default' : 'info'}>
                          {c.kind === 'copy' ? <ScanEye /> : <Bot />}
                          {c.kind === 'copy' ? 'Website copy' : 'Website audit'}
                        </Badge>
                        {c.status && <JobStatusBadge status={c.status} />}
                        {c.verdict && <span className="text-xs text-muted-foreground">{humanize(c.verdict)}</span>}
                        {c.attempts !== undefined && c.attempts > 1 && (
                          <span className="text-xs text-muted-foreground">{c.attempts} attempts</span>
                        )}
                        {c.href && (
                          <Link href={c.href} className="text-xs text-primary hover:underline">
                            Open
                          </Link>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-48 truncate font-mono text-xs">{c.model ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      {c.tokens.input + c.tokens.output > 0 ? <TokenPair tokens={c.tokens} /> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      <CostValue usd={c.costUsd} estimated={c.estimated} unpriced={c.costUsd === null} className="justify-end" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
