'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, Gauge, Info, Radar, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/app/page-header';
import { Field } from '@/components/app/field';
import { ErrorState, InlineAlert } from '@/components/app/states';
import { JobTracker } from '@/components/app/job-tracker';
import { MultiSelect } from '@/components/app/widgets';
import { useCanEdit } from '@/components/app/user-context';
import { api, errorMessage } from '@/lib/api';
import { useApiMutation, useDiscoveryOptions, useWorkerHealth } from '@/lib/queries';
import { useUrlState } from '@/lib/use-url-state';
import { formatNumber } from '@/lib/format';
import type { QueuedJob } from '@/lib/types';
import { cn } from '@/lib/utils';

const FLAGS: Record<string, string> = { SG: '🇸🇬', MY: '🇲🇾', JP: '🇯🇵' };

type CrawlRequest = {
  country: string;
  cities?: string[];
  industries?: string[];
  maxPages: number;
  maxSearches?: number;
  maxCallsPerDay?: number;
  reset: boolean;
};

const positiveInt = (value: string) => {
  const n = Number(value);
  return value.trim() && Number.isInteger(n) && n > 0 ? n : undefined;
};

export function DiscoveryView() {
  const url = useUrlState();
  const canEdit = useCanEdit();
  const options = useDiscoveryOptions();
  const worker = useWorkerHealth();
  const jobId = url.get('job') || null;

  const [countryCode, setCountryCode] = useState<string>('');
  const [cities, setCities] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [maxPages, setMaxPages] = useState(3);
  const [maxSearches, setMaxSearches] = useState('10');
  const [maxCallsPerDay, setMaxCallsPerDay] = useState('');
  const [reset, setReset] = useState(false);

  const country = options.data?.countries.find((c) => c.code === countryCode) ?? options.data?.countries[0];
  const cityCount = cities.length || country?.cities.length || 0;
  const industryCount = industries.length || options.data?.industries.length || 0;
  const planned = cityCount * industryCount;
  const searchCap = positiveInt(maxSearches);
  const searches = searchCap ? Math.min(searchCap, planned) : planned;
  const maxCalls = searches * maxPages;

  const start = useApiMutation(
    (input: CrawlRequest) => api<QueuedJob>('discovery/country', { method: 'POST', body: input }),
    [['jobs'], ['schedules']],
  );

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (maxSearches.trim() && !searchCap) e.maxSearches = 'Use a whole number above 0';
    if (maxCallsPerDay.trim() && !positiveInt(maxCallsPerDay)) e.maxCallsPerDay = 'Use a whole number above 0';
    return e;
  }, [maxSearches, maxCallsPerDay, searchCap]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!country || Object.keys(errors).length) return;
    try {
      const job = await start.mutateAsync({
        country: country.name,
        ...(cities.length ? { cities } : {}),
        ...(industries.length ? { industries } : {}),
        maxPages,
        ...(searchCap ? { maxSearches: searchCap } : {}),
        ...(positiveInt(maxCallsPerDay) ? { maxCallsPerDay: positiveInt(maxCallsPerDay) } : {}),
        reset,
      });
      url.set({ job: job.id });
      toast.success(`Crawl queued for ${country.name}`);
    } catch (err) {
      toast.error('Could not start the crawl', { description: errorMessage(err) });
    }
  }

  return (
    <div>
      <PageHeader
        title="Country crawl"
        description="Search Google Places across every area of a country for each industry, save new businesses and queue their website audits."
        actions={
          <Button variant="outline" asChild>
            <Link href="/schedules">
              <CalendarClock /> Schedule daily
            </Link>
          </Button>
        }
      />

      {worker.data && !worker.data.running && (
        <InlineAlert variant="warning" title="The background worker is offline" className="mb-6">
          You can still queue a crawl — it will start as soon as the worker comes back online.
        </InlineAlert>
      )}

      {jobId && (
        <div className="mb-6">
          <JobTracker jobId={jobId} onDismiss={() => url.set({ job: null })} />
        </div>
      )}

      {options.error ? (
        <Card>
          <ErrorState error={options.error} onRetry={() => options.refetch()} />
        </Card>
      ) : !options.data || !country ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-[480px] lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Crawl settings</CardTitle>
              <CardDescription>Leave areas and industries empty to cover everything.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-2">
                <p className="text-sm font-medium">Country</p>
                <div role="radiogroup" className="grid gap-3 sm:grid-cols-3">
                  {options.data.countries.map((c) => {
                    const selected = c.code === country.code;
                    return (
                      <button
                        key={c.code}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => {
                          setCountryCode(c.code);
                          setCities([]);
                        }}
                        className={cn(
                          'flex items-center gap-3 rounded-lg border p-3 text-left transition',
                          selected ? 'border-primary bg-primary/[0.04] ring-2 ring-primary/20' : 'hover:bg-muted/50',
                        )}
                      >
                        <span className="text-2xl leading-none" aria-hidden>
                          {FLAGS[c.code] ?? '🌏'}
                        </span>
                        <span>
                          <span className="block text-sm font-medium">{c.name}</span>
                          <span className="block text-xs text-muted-foreground">{formatNumber(c.cities.length)} areas</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Areas / cities" hint={cities.length ? undefined : `All ${country.cities.length} areas, largest first`}>
                  <MultiSelect
                    key={country.code}
                    options={country.cities}
                    value={cities}
                    onChange={setCities}
                    placeholder="Areas"
                    allLabel={`All areas (${country.cities.length})`}
                    searchPlaceholder="Search areas…"
                  />
                </Field>
                <Field label="Industries" hint={industries.length ? undefined : `All ${options.data.industries.length} built-in industries`}>
                  <MultiSelect
                    options={options.data.industries}
                    value={industries}
                    onChange={setIndustries}
                    placeholder="Industries"
                    allLabel={`All industries (${options.data.industries.length})`}
                    searchPlaceholder="Search industries…"
                  />
                </Field>
              </div>

              <div className="grid gap-5 sm:grid-cols-3">
                <Field label="Result pages per search" hint="20 results per page">
                  <div className="inline-flex h-9 rounded-md border bg-muted p-[3px]">
                    {[1, 2, 3].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setMaxPages(n)}
                        className={cn(
                          'flex-1 rounded px-4 text-sm font-medium transition',
                          maxPages === n ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Max searches this run" htmlFor="maxSearches" error={errors.maxSearches} hint="Empty = no cap">
                  <Input
                    id="maxSearches"
                    inputMode="numeric"
                    value={maxSearches}
                    onChange={(e) => setMaxSearches(e.target.value)}
                    placeholder="Unlimited"
                    aria-invalid={Boolean(errors.maxSearches)}
                  />
                </Field>
                <Field label="Daily API call limit" htmlFor="maxCalls" error={errors.maxCallsPerDay} hint="Empty = server default">
                  <Input
                    id="maxCalls"
                    inputMode="numeric"
                    value={maxCallsPerDay}
                    onChange={(e) => setMaxCallsPerDay(e.target.value)}
                    placeholder="Default"
                    aria-invalid={Boolean(errors.maxCallsPerDay)}
                  />
                </Field>
              </div>

              <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-4">
                <span>
                  <span className="block text-sm font-medium">Start over</span>
                  <span className="block text-xs text-muted-foreground">
                    Crawls resume where the last one stopped. Turn this on to mark every search as pending again.
                  </span>
                </span>
                <Switch checked={reset} onCheckedChange={setReset} />
              </label>
            </CardContent>
            <CardFooter className="justify-end gap-2 bg-muted/30">
              <Button type="submit" size="lg" loading={start.isPending} disabled={!canEdit || Object.keys(errors).length > 0}>
                {!start.isPending && <Rocket />} Start crawl
              </Button>
            </CardFooter>
          </Card>

          <div className="space-y-6">
            <Card className="lg:sticky lg:top-24">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Gauge className="size-4 text-primary" /> Estimate
                </CardTitle>
                <CardDescription>Upper bound for this run</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Areas × industries</span>
                    <span className="tabular-nums">
                      {formatNumber(cityCount)} × {formatNumber(industryCount)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Planned searches</span>
                    <span className="tabular-nums">{formatNumber(planned)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Searches this run</span>
                    <span className="font-medium tabular-nums">{formatNumber(searches)}</span>
                  </div>
                </div>
                <div className="rounded-lg bg-primary/[0.06] p-4">
                  <p className="text-xs text-muted-foreground">Google Places requests (max)</p>
                  <p className="font-display text-3xl font-semibold tabular-nums">{formatNumber(maxCalls)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Up to {formatNumber(searches * maxPages * 20)} businesses
                  </p>
                </div>
                <p className="flex gap-2 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  The daily API budget is enforced on the server. A crawl that hits it stops and resumes on the next run.
                </p>
              </CardContent>
            </Card>
            {!jobId && (
              <Card className="border-dashed">
                <CardContent className="flex items-start gap-3 text-sm text-muted-foreground">
                  <Radar className="mt-0.5 size-4 shrink-0 text-primary" />
                  Only one crawl per country runs at a time. A second request waits until the first one finishes.
                </CardContent>
              </Card>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
