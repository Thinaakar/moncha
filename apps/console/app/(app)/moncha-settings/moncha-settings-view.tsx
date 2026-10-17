'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  ExternalLink,
  KeyRound,
  ListTodo,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, InlineAlert, TableSkeleton } from '@/components/app/states';
import { PageHeader } from '@/components/app/page-header';
import { useMonchaBots, useMonchaStatus } from '@/lib/queries';

/** Label + value without the shared DetailRow 140px cap (env key names overflow there). */
function ConnectionRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 py-3 text-sm sm:grid-cols-[minmax(10rem,11.5rem)_minmax(0,1fr)] sm:items-start sm:gap-4">
      <dt className="min-w-0">
        <p className="font-medium text-muted-foreground">{label}</p>
        {hint && <p className="mt-0.5 font-mono text-[11px] break-all text-muted-foreground/80">{hint}</p>}
      </dt>
      <dd className="min-w-0 break-words text-foreground">{children ?? '—'}</dd>
    </div>
  );
}
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import type { MonchaBotView, MonchaInternalCheckResult, MonchaSlotTier } from '@/lib/types';
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
        <dl className="divide-y rounded-lg border px-4">
          <ConnectionRow label="Environment">
            {data.environment ? (
              <Badge variant={data.environment === 'production' ? 'warning' : 'muted'}>{ENV_LABEL[data.environment]}</Badge>
            ) : (
              '—'
            )}
          </ConnectionRow>
          <ConnectionRow label="API base URL">
            <span className="font-mono text-xs break-all">{data.baseUrl ?? '—'}</span>
          </ConnectionRow>
          <ConnectionRow label="Internal key" hint="MONCHA_INTERNAL_KEY">
            {data.keys.MONCHA_INTERNAL_KEY ? 'Set' : 'Missing'}
          </ConnectionRow>
          <ConnectionRow label="Base URL override" hint="MONCHA_INTERNAL_BASE_URL">
            {data.keys.MONCHA_INTERNAL_BASE_URL ? 'Set' : 'Default UAT'}
          </ConnectionRow>
          <ConnectionRow label="Last checked">
            <span title={formatDateTime(data.checkedAt)}>{formatRelative(data.checkedAt)}</span>
          </ConnectionRow>
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

const BOTS_PAGE_SIZE = 25;

const KNOWLEDGE_LABEL: Record<NonNullable<MonchaBotView['lead']>['knowledgeStatus'], { label: string; variant: BadgeVariant }> = {
  pending: { label: 'Not trained', variant: 'muted' },
  discovering: { label: 'Discovering', variant: 'info' },
  training: { label: 'Training', variant: 'info' },
  trained: { label: 'Trained', variant: 'success' },
  failed: { label: 'Training failed', variant: 'destructive' },
};

function botStatus(bot: MonchaBotView): { label: string; variant: BadgeVariant } {
  if (bot.live) return { label: 'Live', variant: 'success' };
  if (bot.deactivatedAt) return { label: 'Paused', variant: 'muted' };
  if (!bot.isActive) return { label: 'Inactive', variant: 'muted' };
  return { label: 'No slot', variant: 'warning' };
}

function limitText(value: number | null) {
  return value === null ? '—' : value < 0 ? 'unlimited' : formatNumber(value);
}

function BotsCard({ enabled }: { enabled: boolean }) {
  // Cursor of each page visited so far; the first page has none.
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const cursor = cursors[cursors.length - 1] ?? null;
  const bots = useMonchaBots(cursor, { limit: BOTS_PAGE_SIZE, enabled });
  const page = bots.data;
  const pageNumber = cursors.length;
  const from = (pageNumber - 1) * BOTS_PAGE_SIZE + 1;
  const unlinked = page?.items.filter((b) => !b.lead).length ?? 0;

  return (
    <Card>
      <CardHeader className="flex-row items-start gap-4 space-y-0">
        <div className="min-w-0 flex-1 space-y-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <ListTodo className="size-4 text-primary" /> Bots
            {page?.total != null && <Badge variant="muted">{formatNumber(page.total)} total</Badge>}
          </CardTitle>
          <CardDescription>
            Demo bots this key manages, from MonCha <span className="font-mono text-[11px]">GET /bots</span>, each linked to the
            lead it was made for.
          </CardDescription>
        </div>
        {enabled && (
          <Button type="button" size="sm" variant="outline" loading={bots.isFetching} onClick={() => void bots.refetch()}>
            <RefreshCw /> Refresh
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!enabled ? (
          <EmptyState
            icon={Bot}
            title="Bots unavailable"
            description="The bot list loads once the MonCha internal key authenticates."
            className="py-10"
          />
        ) : bots.isLoading && !page ? (
          <TableSkeleton rows={6} columns={6} />
        ) : bots.error && !page ? (
          <ErrorState error={bots.error} onRetry={() => void bots.refetch()} title="Could not load MonCha bots" />
        ) : !page?.items.length ? (
          <EmptyState icon={Bot} title="No demo bots yet" description="Bots appear here as leads get their demo bot." className="py-10" />
        ) : (
          <>
            {unlinked > 0 && (
              <InlineAlert variant="info" title={`${formatNumber(unlinked)} bot${unlinked === 1 ? '' : 's'} on this page not linked to a lead`}>
                MonCha has them, but no lead in this console has that bot id. They still use a slot.
              </InlineAlert>
            )}
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bot</TableHead>
                    <TableHead>Lead</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Training</TableHead>
                    <TableHead className="text-right">Usage</TableHead>
                    <TableHead>Demo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.items.map((bot) => {
                    const status = botStatus(bot);
                    const knowledge = bot.lead ? KNOWLEDGE_LABEL[bot.lead.knowledgeStatus] : null;
                    return (
                      <TableRow key={bot.botId}>
                        <TableCell className="max-w-[16rem]">
                          <p className="truncate font-medium" title={bot.name}>
                            {bot.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            <span className="capitalize">{bot.planTier ?? '—'}</span>
                            {bot.createdAt && (
                              <span title={formatDateTime(bot.createdAt)}> · {formatRelative(bot.createdAt)}</span>
                            )}
                          </p>
                        </TableCell>
                        <TableCell className="max-w-[16rem]">
                          {bot.lead ? (
                            <Link href={`/leads/${bot.lead.leadId}`} className="block truncate text-sm hover:underline">
                              {bot.lead.company.name}
                            </Link>
                          ) : (
                            <Badge variant="muted">Not linked</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={status.variant} dot>
                            {status.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            {knowledge && <Badge variant={knowledge.variant}>{knowledge.label}</Badge>}
                            {bot.training.pending > 0 && <Badge variant="info">{formatNumber(bot.training.pending)} processing</Badge>}
                            {bot.training.failed > 0 && <Badge variant="destructive">{formatNumber(bot.training.failed)} failed</Badge>}
                            {!knowledge && !bot.training.pending && !bot.training.failed && '—'}
                          </div>
                        </TableCell>
                        <TableCell
                          className="text-right text-xs whitespace-nowrap tabular-nums"
                          title={`Messages this month ${formatNumber(bot.usage.messages)} of ${limitText(bot.limits.messages)} · pages trained ${formatNumber(bot.usage.pages)} of ${limitText(bot.limits.pages)}`}
                        >
                          <p>{formatNumber(bot.usage.messages)} msgs</p>
                          <p className="text-muted-foreground">{formatNumber(bot.usage.pages)} pages</p>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {bot.lead?.liveUrl ? (
                            <div className="flex items-center gap-2">
                              <a
                                href={bot.lead.liveUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                              >
                                Open <ExternalLink className="size-3" />
                              </a>
                              {!bot.lead.chatbotInstalled && <Badge variant="warning">No chatbot</Badge>}
                            </div>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-col items-center justify-between gap-3 text-sm sm:flex-row">
              <p className="text-muted-foreground">
                Showing <span className="font-medium text-foreground">{formatNumber(from)}</span>–
                <span className="font-medium text-foreground">{formatNumber(from + page.items.length - 1)}</span>
                {page.total != null && (
                  <>
                    {' '}
                    of <span className="font-medium text-foreground">{formatNumber(page.total)}</span>
                  </>
                )}
                {bots.isFetching && <span className="ml-2 text-xs text-muted-foreground/70">Updating…</span>}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pageNumber === 1 || bots.isFetching}
                  onClick={() => setCursors((c) => c.slice(0, -1))}
                >
                  <ChevronLeft /> Previous
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">Page {pageNumber}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!page.nextCursor || bots.isFetching}
                  onClick={() => page.nextCursor && setCursors((c) => [...c, page.nextCursor])}
                >
                  Next <ChevronRight />
                </Button>
              </div>
            </div>
          </>
        )}
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
        description="Connection, slot capacity and demo bots of the internal lead API used to create and train demo bots."
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
          <BotsCard enabled={status.data.canAuthenticate} />
        </>
      ) : null}
    </div>
  );
}
