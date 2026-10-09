'use client';

import { Clock, Hand, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/misc';
import { formatNumber } from '@/lib/format';
import type { SiteAutomationCrawl, SiteCopyOrigin } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Who started a copy. Copies made before automation existed have no origin and count as manual. */
export function OriginBadge({ origin, className }: { origin: SiteCopyOrigin | null | undefined; className?: string }) {
  return origin === 'auto' ? (
    <Badge variant="info" className={className}>
      <Sparkles /> Auto
    </Badge>
  ) : (
    <Badge variant="muted" className={className}>
      <Hand /> Manual
    </Badge>
  );
}

/** "in ~4 min", "in ~1 h 20 min", or "any moment" for times that have passed. */
export function formatEta(at: string | Date, now = Date.now()) {
  const ms = new Date(at).getTime() - now;
  if (ms < 30_000) return 'any moment';
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'in under a minute';
  if (min < 60) return `in ~${min} min`;
  const h = Math.floor(min / 60);
  return `in ~${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

export function formatAverage(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 90 ? `${s}s` : `${Math.round(s / 60)} min`;
}

export const CRAWL_COPY_STATUS: Record<SiteAutomationCrawl['status'], { label: string; tone: string }> = {
  waiting_audits: { label: 'Waiting for audits', tone: 'text-warning' },
  queuing: { label: 'Queued', tone: 'text-info' },
  complete: { label: 'Complete', tone: 'text-success' },
};

/** Compact copy progress for one crawl, for run tables. `crawl` undefined = automation did not follow it. */
export function CrawlCopiesCell({ crawl, finished }: { crawl: SiteAutomationCrawl | undefined; finished: boolean }) {
  if (!crawl) {
    return (
      <Tooltip content={finished ? 'Copy automation was off when this crawl finished.' : 'Copies are queued after the crawl finishes.'}>
        <span className="text-xs text-muted-foreground">—</span>
      </Tooltip>
    );
  }
  if (crawl.status === 'waiting_audits') {
    return (
      <Tooltip content={`${formatNumber(crawl.auditsPending)} of ${formatNumber(crawl.auditsTotal)} website audits still running`}>
        <span className="inline-flex items-center gap-1 text-xs text-warning">
          <Clock className="size-3.5" /> Waiting for audits
        </span>
      </Tooltip>
    );
  }
  const { done, failed, pending, running } = crawl.copies;
  const detail = [
    done ? `${done} done` : null,
    running ? `${running} running` : null,
    pending ? `${pending} waiting` : null,
    failed ? `${failed} failed` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Tooltip
      content={
        crawl.qualified === 0
          ? 'No new qualified leads without a copy.'
          : `${formatNumber(crawl.qualified)} qualified · ${detail || 'none started yet'}${crawl.carriedOver ? ` · ${crawl.carriedOver} wait for tomorrow's allowance` : ''}`
      }
    >
      <span className="text-xs whitespace-nowrap">
        <span className={cn('font-medium tabular-nums', crawl.queued ? 'text-foreground' : 'text-muted-foreground')}>
          {crawl.queued ? `${formatNumber(crawl.queued)} queued` : 'None'}
        </span>
        {crawl.carriedOver > 0 && <span className="ml-1 text-warning tabular-nums">+{formatNumber(crawl.carriedOver)} later</span>}
      </span>
    </Tooltip>
  );
}
