'use client';

import Link from 'next/link';
import { ArrowRight, Coins } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CostValue, TokenPair } from '@/components/costs/cost-widgets';
import { useCostWebsite } from '@/lib/queries';
import { formatBytes, formatUsd } from '@/lib/format';
import type { SiteSnapshotDetail } from '@/lib/types';

/** This copy's AI and storage cost, with the whole website's total next to it. */
export function CopyCostCard({ snapshot }: { snapshot: SiteSnapshotDetail }) {
  const { data, isLoading } = useCostWebsite(snapshot.leadId);
  const run = data?.copyRuns.find((r) => r.snapshotId === snapshot.id);
  const storageRate = data?.pricing.r2StorageUsdPerGbMonth;
  const tokens = run?.tokens ?? { input: snapshot.llmPromptTokens ?? 0, output: snapshot.llmCompletionTokens ?? 0 };
  const cost = run ? run.costUsd : (snapshot.llmCostUsd ?? null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="size-4 text-primary" /> Cost
        </CardTitle>
        <CardDescription>AI tokens and storage for this copy</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">AI cost</p>
              <p className="mt-1 font-display text-lg font-semibold">
                <CostValue usd={tokens.input + tokens.output > 0 ? cost : 0} estimated={run?.estimated} unpriced={run ? run.costUsd === null : false} />
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Tokens</p>
              <p className="mt-1 text-sm font-semibold">
                {tokens.input + tokens.output > 0 ? <TokenPair tokens={tokens} /> : 'None'}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Storage</p>
              <p className="mt-1 font-display text-lg font-semibold tabular-nums">
                {storageRate !== undefined ? `${formatUsd((snapshot.totalBytes / 1024 ** 3) * storageRate)}/mo` : formatBytes(snapshot.totalBytes)}
              </p>
            </div>
          </div>
        )}
        {data && (
          <Link
            href={`/costs/${snapshot.leadId}`}
            className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm transition hover:border-primary/40 hover:bg-muted/40"
          >
            <span>
              Whole website:{' '}
              <CostValue usd={data.aiCostUsd} estimated={data.estimated} unpriced={data.unpriced} className="font-semibold" />
              <span className="text-muted-foreground">
                {' '}
                · {data.copies} cop{data.copies === 1 ? 'y' : 'ies'}, {data.aiAudits} AI audit{data.aiAudits === 1 ? '' : 's'}
              </span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
