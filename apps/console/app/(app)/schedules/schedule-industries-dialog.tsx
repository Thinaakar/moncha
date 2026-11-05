'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, errorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { useApiMutation, useDiscoveryIndustries } from '@/lib/queries';
import type { Schedule } from '@/lib/types';
import { cn } from '@/lib/utils';

type Mode = 'crawl_settings' | 'custom';

const NONE: string[] = [];

/**
 * Switches one schedule between the Crawl & Pipeline Settings industries and its own list. Industries are the only
 * crawl option a schedule keeps; everything else always comes from the settings. Mount with `key={schedule.id}`.
 */
export function ScheduleIndustriesDialog({
  schedule,
  targetIndustries,
  onClose,
}: {
  schedule: Schedule | null;
  /** The Crawl settings industries, the starting picks when a schedule gets its own list. */
  targetIndustries: string[];
  onClose: () => void;
}) {
  const industries = useDiscoveryIndustries();
  const own = schedule?.industries ?? NONE;
  const [mode, setMode] = useState<Mode>(own.length ? 'custom' : 'crawl_settings');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(own.length ? own : targetIndustries));
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => {
    const catalog = (industries.data?.industries ?? []).map((i) => ({ slug: i.slug, name: i.name }));
    const known = new Set(catalog.map((i) => i.slug));
    const extra = own.filter((slug) => !known.has(slug)).map((slug) => ({ slug, name: slug }));
    return [...catalog, ...extra];
  }, [industries.data?.industries, own]);
  const q = filter.trim().toLowerCase();
  const shown = q ? items.filter((i) => i.name.toLowerCase().includes(q) || i.slug.includes(q)) : items;

  const save = useApiMutation(
    (body: { industries: string[] }) => api<Schedule>(`schedules/${schedule!.id}`, { method: 'PATCH', body }),
    [['schedules']],
  );

  function toggle(slug: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const custom = mode === 'custom';
    if (custom && picked.size === 0) {
      setError('Pick at least one industry, or use the Crawl settings industries.');
      return;
    }
    try {
      await save.mutateAsync({ industries: custom ? [...picked] : [] });
      toast.success(
        custom
          ? `${schedule!.country} ${schedule!.time} now crawls ${formatNumber(picked.size)} custom industries`
          : `${schedule!.country} ${schedule!.time} now follows the Crawl settings industries`,
      );
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const settingsLabel = targetIndustries.length
    ? `${formatNumber(targetIndustries.length)} target industries`
    : 'every standard industry';

  return (
    <Dialog open={Boolean(schedule)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>
              Industries for {schedule?.country} at {schedule?.time}
            </DialogTitle>
            <DialogDescription>
              Batch size, pages per search, cities, the daily run limit and the engine always come from Crawl & Pipeline
              Settings. Only the industries can differ per schedule.
            </DialogDescription>
          </DialogHeader>

          <fieldset className="grid gap-2">
            <legend className="sr-only">Industries</legend>
            {(
              [
                {
                  value: 'crawl_settings',
                  label: 'Use the industries from Crawl & Pipeline Settings',
                  hint: `Currently ${settingsLabel}. Changes there apply to the next run.`,
                },
                {
                  value: 'custom',
                  label: 'Custom industries for this schedule',
                  hint: 'This schedule keeps the industries picked below.',
                },
              ] as const
            ).map((o) => (
              <label
                key={o.value}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                  mode === o.value ? 'border-primary/50 bg-primary/[0.04]' : 'hover:bg-muted/40',
                )}
              >
                <input
                  type="radio"
                  name="scheduleIndustryMode"
                  value={o.value}
                  checked={mode === o.value}
                  onChange={() => {
                    setMode(o.value);
                    setError(null);
                  }}
                  className="mt-0.5 accent-[var(--primary)]"
                />
                <span>
                  <span className="block font-medium">{o.label}</span>
                  <span className="block text-xs text-muted-foreground">{o.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {mode === 'custom' && (
            <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
              <div className="flex items-center justify-between gap-2">
                <Badge variant={picked.size ? 'default' : 'secondary'}>
                  {formatNumber(picked.size)} of {formatNumber(items.length)} selected
                </Badge>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setPicked(new Set(items.map((i) => i.slug)))}
                  >
                    Select all
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPicked(new Set())}>
                    Deselect all
                  </Button>
                </div>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search industries..."
                  aria-label="Search industries"
                  className="h-8 pl-8 text-xs"
                />
              </div>
              {industries.isLoading ? (
                <div className="grid grid-cols-2 gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-8" />
                  ))}
                </div>
              ) : (
                <div className="grid max-h-64 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                  {shown.map((i) => (
                    <label
                      key={i.slug}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs',
                        picked.has(i.slug) ? 'border-primary/40 bg-primary/[0.06] font-medium' : 'text-muted-foreground',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={picked.has(i.slug)}
                        onChange={() => toggle(i.slug)}
                        className="accent-[var(--primary)]"
                      />
                      <span className="truncate">{i.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
