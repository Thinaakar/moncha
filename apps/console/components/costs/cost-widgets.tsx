'use client';

import { Info } from 'lucide-react';
import { Tooltip } from '@/components/ui/misc';
import { Segmented } from '@/components/sites/tabs';
import { useUrlState } from '@/lib/use-url-state';
import { formatCompact, formatDate, formatNumber, formatUsd } from '@/lib/format';
import type { CostTokens, SiteCostSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'all', label: 'All time' },
] as const;
type Range = (typeof RANGES)[number]['value'];

/** Costs window from `?range=` (default 30 days); `days` is null for all time. */
export function useCostRange() {
  const url = useUrlState();
  const raw = url.get('range');
  const range: Range = RANGES.some((r) => r.value === raw) ? (raw as Range) : '30';
  return {
    range,
    days: range === 'all' ? null : Number(range),
    label: RANGES.find((r) => r.value === range)!.label,
    setRange: (next: Range) => url.set({ range: next === '30' ? null : next }, { resetPage: true }),
  };
}

export function RangePicker() {
  const { range, setRange } = useCostRange();
  return <Segmented<Range> label="Time range" value={range} onChange={setRange} options={[...RANGES]} />;
}

/** A dollar amount with a hint when part of it is estimated from tokens or has no known price. */
export function CostValue({
  usd,
  estimated,
  unpriced,
  className,
}: {
  usd: number | null | undefined;
  estimated?: boolean;
  unpriced?: boolean;
  className?: string;
}) {
  const note = unpriced
    ? 'Some tokens used a model without a known price, so this is a lower bound.'
    : estimated
      ? 'Estimated from tokens × the model’s current OpenRouter price. New AI calls store the exact charge.'
      : null;
  return (
    <span className={cn('inline-flex items-center gap-1 tabular-nums', className)}>
      {usd === null || usd === undefined ? '—' : formatUsd(usd)}
      {note && (
        <Tooltip content={note}>
          <span
            className={cn(
              'cursor-help rounded px-1 text-[10px] font-medium leading-4',
              unpriced ? 'bg-warning/12 text-warning' : 'bg-muted text-muted-foreground',
            )}
          >
            {unpriced ? 'min' : 'est.'}
          </span>
        </Tooltip>
      )}
    </span>
  );
}

export function TokenPair({ tokens, className }: { tokens: CostTokens; className?: string }) {
  return (
    <span className={cn('tabular-nums', className)} title={`${formatNumber(tokens.input)} input · ${formatNumber(tokens.output)} output tokens`}>
      {formatCompact(tokens.input)} <span className="text-muted-foreground">in</span> · {formatCompact(tokens.output)}{' '}
      <span className="text-muted-foreground">out</span>
    </span>
  );
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Every UTC day of the window (or since the first day with data) with zero-filled gaps, at most 90 bars. */
function fillDays(byDay: SiteCostSummary['byDay'], since: string | null) {
  const found = new Map(byDay.map((d) => [d.day, d]));
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const first = since ? new Date(since) : byDay[0] ? new Date(`${byDay[0].day}T00:00:00Z`) : end;
  const start = new Date(Math.max(first.getTime(), end.getTime() - 89 * 86_400_000));
  const days: SiteCostSummary['byDay'] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const key = dayKey(new Date(t));
    days.push(found.get(key) ?? { day: key, websites: 0, costUsd: 0, tokens: 0 });
  }
  return days;
}

export function DailySpendChart({ byDay, since }: { byDay: SiteCostSummary['byDay']; since: string | null }) {
  const days = fillDays(byDay, since);
  const max = Math.max(...days.map((d) => d.costUsd), 0);
  if (max === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        No AI spend in this period
      </div>
    );
  }
  const labelEvery = Math.max(1, Math.ceil(days.length / 7));
  return (
    <div>
      <div className="relative flex h-48 items-end gap-[3px] border-b border-l pl-1">
        <span className="absolute -top-1 left-2 text-[11px] text-muted-foreground tabular-nums">{formatUsd(max)}</span>
        {days.map((d) => (
          <Tooltip
            key={d.day}
            content={
              <span className="block space-y-0.5">
                <span className="block font-medium">{formatDate(`${d.day}T00:00:00Z`)}</span>
                <span className="block">{formatUsd(d.costUsd)} AI spend</span>
                <span className="block">
                  {formatNumber(d.websites)} website{d.websites === 1 ? '' : 's'} · {formatCompact(d.tokens)} tokens
                </span>
              </span>
            }
          >
            <div className="group flex h-full min-w-0 flex-1 items-end">
              <div
                className={cn(
                  'w-full rounded-t-[3px] transition-colors',
                  d.costUsd > 0 ? 'bg-primary/70 group-hover:bg-primary' : 'bg-muted',
                )}
                style={{ height: d.costUsd > 0 ? `${Math.max(3, (d.costUsd / max) * 100)}%` : '2px' }}
              />
            </div>
          </Tooltip>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[3px] pl-1 text-[10px] text-muted-foreground">
        {days.map((d, i) => (
          <span key={d.day} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
            {i % labelEvery === 0 ? new Date(`${d.day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

export type SplitPart = { label: string; value: number; className: string; hint?: string };

/** Stacked bar with a legend; parts with no value still show in the legend. */
export function SplitBar({ parts, format = formatUsd }: { parts: SplitPart[]; format?: (n: number) => string }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  return (
    <div className="space-y-3">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {total > 0 &&
          parts
            .filter((p) => p.value > 0)
            .map((p) => <div key={p.label} className={p.className} style={{ width: `${(p.value / total) * 100}%` }} />)}
      </div>
      <ul className="space-y-1.5 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className={cn('size-2.5 shrink-0 rounded-sm', p.className)} />
            <span className="min-w-0 flex-1 truncate">
              {p.label}
              {p.hint && <span className="text-muted-foreground"> · {p.hint}</span>}
            </span>
            <span className="tabular-nums">{format(p.value)}</span>
            <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
              {total > 0 ? `${Math.round((p.value / total) * 100)}%` : '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One line of a cost receipt. */
export function ReceiptLine({
  icon: Icon,
  label,
  detail,
  amount,
  free,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail?: React.ReactNode;
  amount: React.ReactNode;
  free?: boolean;
}) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      </div>
      <span className={cn('text-sm font-medium tabular-nums', free && 'text-success')}>{amount}</span>
    </li>
  );
}

export function CostFootnote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 text-xs text-muted-foreground">
      <Info className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
