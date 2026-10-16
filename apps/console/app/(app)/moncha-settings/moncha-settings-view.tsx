'use client';

import {
  Bot,
  CheckCircle2,
  CircleDashed,
  KeyRound,
  ListTodo,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState, InlineAlert } from '@/components/app/states';
import { PageHeader } from '@/components/app/page-header';
import { DetailRow } from '@/components/app/widgets';
import { useMonchaStatus } from '@/lib/queries';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import type { MonchaInternalCheckResult, MonchaSlotTier } from '@/lib/types';
import { cn } from '@/lib/utils';

const TIERS: Array<{ id: MonchaSlotTier; label: string; hint: string }> = [
  { id: 'starter', label: 'Starter', hint: 'Default demo tier' },
  { id: 'growth', label: 'Growth', hint: 'Mid capacity' },
  { id: 'scale', label: 'Scale', hint: 'Highest capacity' },
];

const ENV_LABEL: Record<NonNullable<MonchaInternalCheckResult['environment']>, string> = {
  uat: 'UAT',
  production: 'Production',
  custom: 'Custom',
};

/** Same rule as the worker: most available slots; ties go to the cheaper tier. */
function preferredTier(slots: NonNullable<MonchaInternalCheckResult['slots']>): MonchaSlotTier | null {
  let best: MonchaSlotTier | null = null;
  for (const tier of TIERS.map((t) => t.id)) {
    const available = slots[tier]?.available ?? 0;
    if (available > 0 && (best === null || available > slots[best].available)) best = tier;
  }
  return best;
}

function SlotBar({ used, allocated }: { used: number; allocated: number }) {
  const pct = allocated > 0 ? Math.min(100, Math.round((used / allocated) * 100)) : 0;
  const tight = allocated > 0 && used / allocated >= 0.9;
  return (
    <div className="space-y-1.5">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-[width]', tight ? 'bg-warning' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-muted-foreground tabular-nums">
        {formatNumber(used)} used of {formatNumber(allocated)} · {pct}%
      </p>
    </div>
  );
}

function ConnectionCard({
  data,
  refreshing,
  onRefresh,
}: {
  data: MonchaInternalCheckResult;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const ok = data.configured && data.canAuthenticate;
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-4 space-y-0">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <KeyRound className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            Connection
            {ok ? (
              <Badge variant="success" dot>
                Connected
              </Badge>
            ) : data.configured ? (
              <Badge variant="warning" dot>
                Key set, not reachable
              </Badge>
            ) : (
              <Badge variant="muted" dot>
                Not configured
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            The worker uses this MonCha internal key to create and train demo bots before each website copy.
          </CardDescription>
        </div>
        <Button type="button" size="sm" variant="outline" loading={refreshing} onClick={onRefresh}>
          <RefreshCw /> Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        {data.error && (
          <InlineAlert variant="warning" title="Could not reach MonCha">
            {data.error}
          </InlineAlert>
        )}
        <dl className="divide-y rounded-lg border">
          <DetailRow label="Environment">
            {data.environment ? (
              <Badge variant={data.environment === 'production' ? 'warning' : 'muted'}>{ENV_LABEL[data.environment]}</Badge>
            ) : (
              '—'
            )}
          </DetailRow>
          <DetailRow label="Base URL">
            <span className="font-mono text-xs break-all">{data.baseUrl ?? '—'}</span>
          </DetailRow>
          <DetailRow label="MONCHA_INTERNAL_KEY">{data.keys.MONCHA_INTERNAL_KEY ? 'Set' : 'Missing'}</DetailRow>
          <DetailRow label="MONCHA_INTERNAL_BASE_URL">{data.keys.MONCHA_INTERNAL_BASE_URL ? 'Set' : 'Default UAT'}</DetailRow>
          <DetailRow label="Last checked">
            <span title={formatDateTime(data.checkedAt)}>{formatRelative(data.checkedAt)}</span>
          </DetailRow>
        </dl>
      </CardContent>
    </Card>
  );
}

function SlotsCard({ data }: { data: MonchaInternalCheckResult }) {
  const slots = data.slots;
  const preferred = slots ? preferredTier(slots) : null;
  const totalAvailable = slots ? TIERS.reduce((sum, t) => sum + (slots[t.id]?.available ?? 0), 0) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" /> Demo bot slots
        </CardTitle>
        <CardDescription>
          Capacity from MonCha <span className="font-mono text-[11px]">GET /slots</span>. New bots use the tier with the most
          free slots
          {preferred ? (
            <>
              {' '}
              (currently <span className="font-medium text-foreground">{TIERS.find((t) => t.id === preferred)?.label}</span>).
            </>
          ) : (
            '.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!slots ? (
          <EmptyState
            icon={CircleDashed}
            title="Slots unavailable"
            description={
              data.configured
                ? 'Authenticate successfully to load starter, growth and scale capacity.'
                : 'Set MONCHA_INTERNAL_KEY on the worker to load slot capacity.'
            }
            className="py-10"
          />
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3">
              <div>
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Available across tiers</p>
                <p className="font-display text-3xl font-semibold tabular-nums">{formatNumber(totalAvailable)}</p>
              </div>
              {totalAvailable === 0 ? (
                <Badge variant="warning" dot>
                  All full
                </Badge>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-sm text-success">
                  <CheckCircle2 className="size-4" /> Ready for new bots
                </span>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {TIERS.map((tier) => {
                const row = slots[tier.id];
                const isPreferred = preferred === tier.id;
                return (
                  <div
                    key={tier.id}
                    className={cn(
                      'flex flex-col gap-3 rounded-lg border p-4',
                      isPreferred && 'border-primary/40 bg-primary/5 ring-1 ring-primary/20',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{tier.label}</p>
                        <p className="text-xs text-muted-foreground">{tier.hint}</p>
                      </div>
                      {isPreferred && (
                        <Badge variant="success" dot>
                          Next
                        </Badge>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Available</p>
                      <p className="font-display text-2xl font-semibold tabular-nums">{formatNumber(row.available)}</p>
                    </div>
                    <SlotBar used={row.used} allocated={row.allocated} />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BotsPlaceholderCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListTodo className="size-4 text-primary" /> Bots
        </CardTitle>
        <CardDescription>A full list of MonCha demo bots for this account will appear here.</CardDescription>
      </CardHeader>
      <CardContent>
        <EmptyState
          icon={Bot}
          title="Bot list coming soon"
          description="When MonCha exposes a bot list API, this section will show every demo bot, its tier and training status."
          className="py-12"
        />
      </CardContent>
    </Card>
  );
}

export function MonchaSettingsView() {
  const status = useMonchaStatus();

  async function refresh() {
    try {
      await status.refetch();
      toast.success('MonCha status refreshed');
    } catch (e) {
      toast.error('Could not refresh', { description: errorMessage(e) });
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="MonCha settings"
        description="Connection and slot capacity for the internal lead API used to create and train demo bots."
        actions={
          <Button type="button" variant="outline" size="sm" loading={status.isFetching} onClick={() => void refresh()}>
            <RefreshCw /> Refresh
          </Button>
        }
      />

      {status.isLoading && !status.data ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : status.error && !status.data ? (
        <Card>
          <ErrorState error={status.error} onRetry={() => void status.refetch()} title="Could not load MonCha settings" />
        </Card>
      ) : status.data ? (
        <>
          {!status.data.canAuthenticate && (
            <InlineAlert variant="warning" title="MonCha is not ready">
              Demo bots will not be created until the internal key authenticates. Website copies may wait or skip the
              chatbot step depending on worker configuration.
            </InlineAlert>
          )}
          <ConnectionCard data={status.data} refreshing={status.isFetching} onRefresh={() => void refresh()} />
          <SlotsCard data={status.data} />
          <BotsPlaceholderCard />
        </>
      ) : null}
    </div>
  );
}
