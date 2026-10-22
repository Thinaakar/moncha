'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Search, Trash2, X, Sparkles, Filter } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/app/field';
import { api, errorMessage } from '@/lib/api';
import { useApiMutation, useDiscoveryIndustries, useDiscoveryOptions } from '@/lib/queries';
import type { IndustryItem, Schedule } from '@/lib/types';
import { cn } from '@/lib/utils';

const ZONES = [
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Tokyo',
  'Asia/Kolkata',
  'Asia/Jakarta',
  'Asia/Bangkok',
  'Asia/Hong_Kong',
  'Australia/Sydney',
  'Europe/London',
  'America/New_York',
  'UTC',
];

const COUNTRY_ZONE: Record<string, string> = { SG: 'Asia/Singapore', MY: 'Asia/Kuala_Lumpur', JP: 'Asia/Tokyo' };

export function AddScheduleDialog({
  open,
  onOpenChange,
  defaultCountry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCountry?: string;
}) {
  const options = useDiscoveryOptions();
  const industriesQuery = useDiscoveryIndustries();

  const [country, setCountry] = useState('');
  const [time, setTime] = useState('09:00');
  const [timezone, setTimezone] = useState('');
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [searchFilter, setSearchFilter] = useState('');
  const [newIndustryName, setNewIndustryName] = useState('');
  const [newIndustryCategory, setNewIndustryCategory] = useState('Custom');
  const [error, setError] = useState<string | null>(null);

  const allIndustries: IndustryItem[] = useMemo(() => industriesQuery.data?.industries ?? [], [industriesQuery.data?.industries]);

  // When dialog opens or industries load, select ALL industries by default
  useEffect(() => {
    if (!open) return;
    if (options.data) {
      const code = defaultCountry || options.data.countries[0]?.code || '';
      setCountry(code);
      setTimezone(COUNTRY_ZONE[code] ?? options.data.defaults.timezone);
      setTime('09:00');
      setError(null);
    }
  }, [open, defaultCountry, options.data]);

  useEffect(() => {
    if (!open || allIndustries.length === 0) return;
    // Default select all available industries
    setSelectedSlugs(new Set(allIndustries.map((i) => i.slug)));
  }, [open, allIndustries]);

  const createSchedule = useApiMutation(
    (input: { country: string; time: string; timezone: string; industries?: string[] }) =>
      api<Schedule>('schedules', { method: 'POST', body: input }),
    [['schedules']],
  );

  const addIndustry = useApiMutation(
    (input: { name: string; category?: string }) =>
      api<IndustryItem>('discovery/industries', { method: 'POST', body: input }),
    [['discovery', 'industries'], ['discovery', 'options']],
  );

  const deleteIndustry = useApiMutation(
    (id: string) => api(`discovery/industries/${id}`, { method: 'DELETE' }),
    [['discovery', 'industries'], ['discovery', 'options']],
  );

  // Filtered industries list
  const filteredIndustries = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    if (!q) return allIndustries;
    return allIndustries.filter(
      (ind) => ind.name.toLowerCase().includes(q) || ind.category.toLowerCase().includes(q) || ind.slug.includes(q),
    );
  }, [allIndustries, searchFilter]);

  // Grouped by Category
  const groupedIndustries = useMemo(() => {
    const groups = new Map<string, IndustryItem[]>();
    for (const ind of filteredIndustries) {
      const cat = ind.category || 'General';
      const list = groups.get(cat) ?? [];
      list.push(ind);
      groups.set(cat, list);
    }
    return Array.from(groups.entries());
  }, [filteredIndustries]);

  function toggleSlug(slug: string) {
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedSlugs(new Set(allIndustries.map((i) => i.slug)));
  }

  function deselectAll() {
    setSelectedSlugs(new Set());
  }

  function toggleCategory(items: IndustryItem[]) {
    const allSelected = items.every((i) => selectedSlugs.has(i.slug));
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      for (const i of items) {
        if (allSelected) {
          next.delete(i.slug);
        } else {
          next.add(i.slug);
        }
      }
      return next;
    });
  }

  async function handleAddCustomIndustry(e: React.FormEvent) {
    e.preventDefault();
    const name = newIndustryName.trim();
    if (!name || name.length < 2) {
      toast.error('Please enter an industry name (at least 2 characters)');
      return;
    }
    try {
      const created = await addIndustry.mutateAsync({
        name,
        category: newIndustryCategory.trim() || 'Custom',
      });
      toast.success(`Added "${created.name}" to industries catalog`);
      setNewIndustryName('');
      // Immediately select the newly created custom industry
      setSelectedSlugs((prev) => new Set([...prev, created.slug]));
    } catch (err) {
      toast.error('Could not add industry', { description: errorMessage(err) });
    }
  }

  async function handleDeleteCustomIndustry(e: React.MouseEvent, ind: IndustryItem) {
    e.stopPropagation();
    try {
      await deleteIndustry.mutateAsync(ind.id);
      setSelectedSlugs((prev) => {
        const next = new Set(prev);
        next.delete(ind.slug);
        return next;
      });
      toast.success(`Removed "${ind.name}"`);
    } catch (err) {
      toast.error('Could not remove custom industry', { description: errorMessage(err) });
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setError('Use a 24-hour time like 09:30');
      return;
    }
    if (selectedSlugs.size === 0) {
      setError('Please select at least one industry to crawl');
      return;
    }
    try {
      const created = await createSchedule.mutateAsync({
        country,
        time,
        timezone,
        industries: Array.from(selectedSlugs),
      });
      toast.success(`${created.country} scheduled daily at ${created.time}`, {
        description: `Next run ${created.nextRunDay} (${created.timezone}) · ${selectedSlugs.size} industries`,
      });
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const zones = ZONES.includes(timezone) || !timezone ? ZONES : [timezone, ...ZONES];
  const selectedCount = selectedSlugs.size;
  const totalCount = allIndustries.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Add daily schedule</DialogTitle>
            <DialogDescription>
              Every day at this local time, the worker crawls the selected industries in this country within the per-run budget.
            </DialogDescription>
          </DialogHeader>

          {/* Country Selection */}
          <Field label="Country">
            <Select
              value={country}
              onValueChange={(v) => {
                setCountry(v);
                if (COUNTRY_ZONE[v]) setTimezone(COUNTRY_ZONE[v]);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a country" />
              </SelectTrigger>
              <SelectContent>
                {options.data?.countries.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* Time & Timezone */}
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Time (24h)" htmlFor="time" error={error ?? undefined}>
              <Input
                id="time"
                type="time"
                step={60}
                value={time}
                onChange={(e) => {
                  setTime(e.target.value.slice(0, 5));
                  setError(null);
                }}
                required
              />
            </Field>
            <Field label="Time zone">
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger>
                  <SelectValue placeholder="Time zone" />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((z) => (
                    <SelectItem key={z} value={z}>
                      {z.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/* Target Industries Selection Section */}
          <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">Target Industries</span>
                  <Badge variant={selectedCount > 0 ? 'default' : 'secondary'} className="text-xs">
                    {selectedCount} of {totalCount} selected
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Default selected all. Click any item to untick or re-tick for this schedule.
                </p>
              </div>

              {/* Select All / Deselect All Controls */}
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={selectAll}
                  className="h-7 text-xs"
                  disabled={selectedCount === totalCount}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={deselectAll}
                  className="h-7 text-xs"
                  disabled={selectedCount === 0}
                >
                  Deselect all
                </Button>
              </div>
            </div>

            {/* Search Filter Box */}
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Search industries or categories..."
                className="h-8 pr-8 pl-8 text-xs"
              />
              {searchFilter && (
                <button
                  type="button"
                  onClick={() => setSearchFilter('')}
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>

            {/* Quick Add Custom Industry */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed bg-background/60 p-2.5">
              <div className="flex flex-1 items-center gap-1.5 min-w-[200px]">
                <Plus className="size-3.5 text-muted-foreground shrink-0" />
                <Input
                  value={newIndustryName}
                  onChange={(e) => setNewIndustryName(e.target.value)}
                  placeholder="Add custom industry (e.g. Pet Grooming, Solar)..."
                  className="h-7 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCustomIndustry(e);
                    }
                  }}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleAddCustomIndustry}
                loading={addIndustry.isPending}
                disabled={!newIndustryName.trim()}
                className="h-7 px-3 text-xs"
              >
                + Add Industry
              </Button>
            </div>

            {/* Categorized Industry Group Grid */}
            {industriesQuery.isLoading ? (
              <div className="space-y-3 py-4">
                <Skeleton className="h-6 w-32" />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-9 w-full rounded-md" />
                  ))}
                </div>
              </div>
            ) : filteredIndustries.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                No industries matching &quot;{searchFilter}&quot;
              </div>
            ) : (
              <div className="max-h-72 space-y-4 overflow-y-auto pr-1 scrollbar-thin">
                {groupedIndustries.map(([category, items]) => {
                  const categorySelectedCount = items.filter((i) => selectedSlugs.has(i.slug)).length;
                  const allCategorySelected = categorySelectedCount === items.length;

                  return (
                    <div key={category} className="space-y-1.5">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                          {category} ({categorySelectedCount}/{items.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleCategory(items)}
                          className="text-[11px] text-primary hover:underline"
                        >
                          {allCategorySelected ? 'Untick all' : 'Tick all'}
                        </button>
                      </div>

                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        {items.map((ind) => {
                          const isSelected = selectedSlugs.has(ind.slug);

                          return (
                            <button
                              key={ind.id}
                              type="button"
                              onClick={() => toggleSlug(ind.slug)}
                              className={cn(
                                'group flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-all select-none',
                                isSelected
                                  ? 'border-primary/40 bg-primary/[0.06] text-foreground font-medium shadow-2xs'
                                  : 'border-border/60 bg-card text-muted-foreground opacity-75 hover:opacity-100 hover:border-border',
                              )}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                {/* Rounded Radio / Checkbox Indicator Button */}
                                <div
                                  className={cn(
                                    'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                                    isSelected
                                      ? 'border-primary bg-primary text-primary-foreground shadow-xs'
                                      : 'border-muted-foreground/40 bg-background',
                                  )}
                                >
                                  {isSelected && <Check className="size-2.5 stroke-[3]" />}
                                </div>
                                <span className="truncate">{ind.name}</span>
                              </div>

                              {ind.isCustom && (
                                <div className="flex items-center gap-1 shrink-0 ml-1">
                                  <span className="rounded bg-primary/10 px-1 py-0.5 text-[9px] font-semibold text-primary uppercase">
                                    Custom
                                  </span>
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={(e) => handleDeleteCustomIndustry(e, ind)}
                                    className="rounded p-0.5 text-muted-foreground opacity-60 hover:text-destructive hover:opacity-100"
                                    aria-label={`Delete ${ind.name}`}
                                  >
                                    <Trash2 className="size-3" />
                                  </span>
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={createSchedule.isPending}
              disabled={!country || !timezone || selectedCount === 0}
            >
              Add schedule ({selectedCount} industries)
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
