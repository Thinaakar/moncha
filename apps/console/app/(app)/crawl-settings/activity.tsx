'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatNumber } from '@/lib/format';
import type { CrawlPipelineProgressView, CrawlPipelineSettingsView } from '@/lib/types';
import { cn } from '@/lib/utils';

function Metric({
  label,
  value,
  limit,
  hint,
}: {
  label: string;
  value: number;
  limit?: number;
  hint?: string;
}) {
  const pct = limit ? Math.min(100, Math.round((value / Math.max(1, limit)) * 100)) : null;
  return (
    <div className="min-w-0 space-y-1.5 px-4 py-3">
      <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums text-foreground">
        {formatNumber(value)}
        {limit !== undefined && <span className="text-sm font-normal text-muted-foreground"> / {formatNumber(limit)}</span>}
      </p>
      {pct !== null ? (
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={`${label} used`}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-warning' : 'bg-primary')} style={{ width: `${pct}%` }} />
        </div>
      ) : (
        hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

export function TodayActivity({
  progress,
  settings,
}: {
  progress: CrawlPipelineProgressView;
  settings: CrawlPipelineSettingsView;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 pb-1">
        <div className="space-y-1">
          <CardTitle>Today</CardTitle>
          <CardDescription>Since 00:00 UTC, when the daily limits reset. Updates every 10 seconds.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="px-1 pt-3 pb-1">
        <div className="grid grid-cols-2 divide-y sm:grid-cols-4 sm:divide-y-0 xl:grid-cols-8 xl:divide-x">
          <Metric label="Crawl runs" value={progress.crawlsRunToday} limit={settings.maxDailyCrawlRuns} />
          <Metric label="Places found" value={progress.websitesCrawledToday} hint="By finished crawls" />
          <Metric label="Already known" value={progress.duplicatesFilteredToday} hint="Skipped as duplicates" />
          <Metric label="Qualified" value={progress.auditsQualifiedToday} hint="No assistant found" />
          <Metric label="Waiting for a copy" value={progress.qualifiedWaitingInQueue} hint="From the last 7 days" />
          <Metric label="Website copies" value={progress.websitesCreatedToday} limit={settings.dailyWebsiteCreationLimit} />
          <Metric label="Businesses emailed" value={progress.customersReachedToday} limit={settings.dailyCustomerReachLimit} />
          <Metric
            label="Follow-ups"
            value={progress.followUpsSentToday ?? 0}
            hint={`Sent · ${formatNumber(progress.followUpsDueToday)} due today${
              progress.followUpsOverdue ? ` (${formatNumber(progress.followUpsOverdue)} overdue)` : ''
            }`}
          />
        </div>
      </CardContent>
      {progress.recrawlReason && (
        <div className="border-t px-5 py-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{progress.recrawlNeeded ? 'Recrawl needed: ' : 'Auto-recrawl: '}</span>
          {progress.recrawlReason}
        </div>
      )}
    </Card>
  );
}
