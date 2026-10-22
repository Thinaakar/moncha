'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bot,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Compass,
  Database,
  Filter,
  Gauge,
  Info,
  Layers,
  Mail,
  Play,
  Radar,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Sliders,
  SlidersHorizontal,
  Sparkles,
  Workflow,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch, Tooltip } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/app/page-header';
import { Field } from '@/components/app/field';
import { ErrorState, InlineAlert } from '@/components/app/states';
import { JobTracker } from '@/components/app/job-tracker';
import { MultiSelect } from '@/components/app/widgets';
import { useCanEdit } from '@/components/app/user-context';
import {
  useCrawlPipeline,
  useDiscoveryOptions,
  useTriggerCrawlBatch,
  useUpdateCrawlPipeline,
} from '@/lib/queries';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import type { CrawlPipelineSettingsUpdate } from '@/lib/types';
import { cn } from '@/lib/utils';

export function CrawlSettingsView() {
  const canEdit = useCanEdit();
  const pipeline = useCrawlPipeline();
  const options = useDiscoveryOptions();
  const updateSettings = useUpdateCrawlPipeline();
  const triggerCrawl = useTriggerCrawlBatch();

  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // Form states
  const [active, setActive] = useState(false);
  const [crawlBatchSize, setCrawlBatchSize] = useState(20);
  const [dailyWebsiteCreationLimit, setDailyWebsiteCreationLimit] = useState(5);
  const [dailyCustomerReachLimit, setDailyCustomerReachLimit] = useState(5);
  const [autoRecrawlEnabled, setAutoRecrawlEnabled] = useState(true);
  const [minQueueBuffer, setMinQueueBuffer] = useState(5);
  const [maxDailyCrawlRuns, setMaxDailyCrawlRuns] = useState(10);
  const [targetCountry, setTargetCountry] = useState('SG');
  const [targetCities, setTargetCities] = useState<string[]>([]);
  const [targetIndustries, setTargetIndustries] = useState<string[]>([]);

  // Follow-up scheduling states
  const [followUpEnabled, setFollowUpEnabled] = useState(true);
  const [followUpDelayDays, setFollowUpDelayDays] = useState(3);
  const [followUpMode, setFollowUpMode] = useState<'business_days' | 'calendar_days'>('business_days');
  const [followUpPreferredHour, setFollowUpPreferredHour] = useState(10);
  const [followUpSubject, setFollowUpSubject] = useState('');
  const [followUpBodyTemplate, setFollowUpBodyTemplate] = useState('');

  // Sync state when pipeline data loads
  useEffect(() => {
    if (pipeline.data?.settings) {
      const s = pipeline.data.settings;
      setActive(s.active);
      setCrawlBatchSize(s.crawlBatchSize);
      setDailyWebsiteCreationLimit(s.dailyWebsiteCreationLimit);
      setDailyCustomerReachLimit(s.dailyCustomerReachLimit);
      setAutoRecrawlEnabled(s.autoRecrawlEnabled);
      setMinQueueBuffer(s.minQueueBuffer);
      setMaxDailyCrawlRuns(s.maxDailyCrawlRuns);
      setTargetCountry(s.targetCountry || 'SG');
      setTargetCities(s.targetCities || []);
      setTargetIndustries(s.targetIndustries || []);
      setFollowUpEnabled(s.followUpEnabled);
      setFollowUpDelayDays(s.followUpDelayDays);
      setFollowUpMode(s.followUpMode || 'business_days');
      setFollowUpPreferredHour(s.followUpPreferredHour ?? 10);
      setFollowUpSubject(s.followUpSubject || '');
      setFollowUpBodyTemplate(s.followUpBodyTemplate || '');
    }
  }, [pipeline.data?.settings]);

  const countryProfile = useMemo(
    () => options.data?.countries.find((c) => c.code === targetCountry) ?? options.data?.countries[0],
    [options.data?.countries, targetCountry],
  );

  // Dynamic preview for next follow-up date calculation
  const followUpExamplePreview = useMemo(() => {
    const now = new Date();
    const target = new Date(now.getTime());
    let added = 0;
    while (added < followUpDelayDays) {
      target.setDate(target.getDate() + 1);
      if (followUpMode === 'calendar_days' || (target.getDay() !== 0 && target.getDay() !== 6)) {
        added += 1;
      }
    }
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return `${days[target.getDay()]}, ${target.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${followUpPreferredHour}:00`;
  }, [followUpDelayDays, followUpMode, followUpPreferredHour]);

  // Save handler
  async function handleSave() {
    try {
      const payload: CrawlPipelineSettingsUpdate = {
        active,
        crawlBatchSize,
        dailyWebsiteCreationLimit,
        dailyCustomerReachLimit,
        autoRecrawlEnabled,
        minQueueBuffer,
        maxDailyCrawlRuns,
        targetCountry,
        targetCities,
        targetIndustries,
        followUpEnabled,
        followUpDelayDays,
        followUpMode,
        followUpPreferredHour,
        followUpSubject: followUpSubject.trim() || null,
        followUpBodyTemplate: followUpBodyTemplate.trim() || null,
      };
      await updateSettings.mutateAsync(payload);
      toast.success('Crawl & Pipeline settings saved');
    } catch (err) {
      toast.error('Failed to save settings', { description: errorMessage(err) });
    }
  }

  // Quick manual crawl batch trigger
  async function handleTriggerCrawl() {
    try {
      const result = await triggerCrawl.mutateAsync({
        batchSize: crawlBatchSize,
        country: targetCountry,
      });
      setActiveJobId(result.id);
      toast.success(`Crawl batch started for ${crawlBatchSize} websites`);
    } catch (err) {
      toast.error('Could not start crawl batch', { description: errorMessage(err) });
    }
  }

  const p = pipeline.data?.progress;

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="Crawl & Pipeline Settings"
        description="Configure dynamic crawl batch size, daily demo site creation quotas, customer outreach targets, and follow-up scheduling."
        actions={
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTriggerCrawl}
              disabled={!canEdit || triggerCrawl.isPending}
              loading={triggerCrawl.isPending}
            >
              <Play className="size-4" /> Trigger Crawl ({crawlBatchSize} sites)
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!canEdit || updateSettings.isPending}
              loading={updateSettings.isPending}
            >
              <Save className="size-4" /> Save Settings
            </Button>
          </div>
        }
      />

      {activeJobId && (
        <div className="mb-4">
          <JobTracker jobId={activeJobId} onDismiss={() => setActiveJobId(null)} />
        </div>
      )}

      {/* Development Mode Security Callout */}
      <InlineAlert variant="info" title="Development Safety Gate Active">
        The application is running in developer test mode. Automated customer email delivery is protected: emails are
        held safely as drafts or delivered only to verified developer inboxes.
      </InlineAlert>

      {/* Master Engine Status Card */}
      <Card className="border-primary/20 bg-card/60 backdrop-blur-xs">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-xl font-bold transition-all',
                active ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground',
              )}
            >
              <Workflow className="size-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">Autonomous Pipeline Engine</CardTitle>
                <Badge variant={active ? 'success' : 'muted'} dot>
                  {active ? 'Active & Running' : 'Engine Paused'}
                </Badge>
                {pipeline.data && (
                  <Badge variant={pipeline.data.workerOnline ? 'outline' : 'warning'}>
                    {pipeline.data.workerOnline ? 'Worker Online' : 'Worker Standby'}
                  </Badge>
                )}
              </div>
              <CardDescription>
                When active, the worker manages discovery crawling, website audits, website creations, and outreach
                autonomously based on your daily quotas.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">{active ? 'Engine Enabled' : 'Engine Disabled'}</span>
            <Switch
              checked={active}
              disabled={!canEdit || updateSettings.isPending}
              onCheckedChange={(val) => {
                setActive(val);
                void updateSettings.mutateAsync({ active: val });
              }}
              aria-label="Toggle autonomous pipeline"
            />
          </div>
        </CardHeader>
      </Card>

      {/* Interactive Step-by-Step Pipeline Ribbon */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
            Live Pipeline Flow & Today&apos;s Quota Progress
          </h2>
          {p?.recrawlNeeded && (
            <Badge variant="warning" className="animate-pulse">
              <RefreshCw className="mr-1 size-3 animate-spin" /> Auto-Recrawl Active
            </Badge>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {/* Stage 1: Crawl Batch */}
          <div className="rounded-xl border bg-card p-3.5 shadow-2xs transition-all hover:border-primary/40">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">1. Crawl Batch</span>
              <Radar className="size-3.5 text-primary" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {formatNumber(p?.websitesCrawledToday ?? 0)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">sites today</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Batch size: {crawlBatchSize} sites</p>
          </div>

          {/* Stage 2: DB Dedup */}
          <div className="rounded-xl border bg-card p-3.5 shadow-2xs transition-all hover:border-primary/40">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">2. DB Filter</span>
              <Database className="size-3.5 text-muted-foreground" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {formatNumber(p?.duplicatesFilteredToday ?? 0)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">skipped</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Prevents duplicate leads</p>
          </div>

          {/* Stage 3: Chatbot Audit */}
          <div className="rounded-xl border bg-card p-3.5 shadow-2xs transition-all hover:border-primary/40">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">3. Chatbot Audit</span>
              <Bot className="size-3.5 text-indigo-500" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {formatNumber(p?.auditsQualifiedToday ?? 0)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">qualified</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">No assistant found</p>
          </div>

          {/* Stage 4: Queue Buffer */}
          <div className="rounded-xl border bg-card p-3.5 shadow-2xs transition-all hover:border-primary/40">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">4. Queue Buffer</span>
              <Layers className="size-3.5 text-amber-500" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
              {formatNumber(p?.qualifiedWaitingInQueue ?? 0)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">waiting</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Buffer min: {minQueueBuffer} leads</p>
          </div>

          {/* Stage 5: Website Creation */}
          <div className="rounded-xl border bg-card p-3.5 shadow-2xs transition-all hover:border-primary/40">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">5. Site Creation</span>
              <Sparkles className="size-3.5 text-success" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {p?.websitesCreatedToday ?? 0}
              <span className="text-sm font-normal text-muted-foreground"> / {dailyWebsiteCreationLimit}</span>
            </p>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-success transition-all"
                style={{
                  width: `${Math.min(100, Math.round(((p?.websitesCreatedToday ?? 0) / Math.max(1, dailyWebsiteCreationLimit)) * 100))}%`,
                }}
              />
            </div>
          </div>

          {/* Stage 6: Customer Reach */}
          <div className="rounded-xl border bg-card p-3.5 shadow-2xs transition-all hover:border-primary/40">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">6. Outreach Reach</span>
              <Send className="size-3.5 text-blue-500" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {p?.customersReachedToday ?? 0}
              <span className="text-sm font-normal text-muted-foreground"> / {dailyCustomerReachLimit}</span>
            </p>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{
                  width: `${Math.min(100, Math.round(((p?.customersReachedToday ?? 0) / Math.max(1, dailyCustomerReachLimit)) * 100))}%`,
                }}
              />
            </div>
          </div>

          {/* Stage 7: Follow-up Engine */}
          <div className="rounded-xl border bg-card p-3.5 shadow-2xs transition-all hover:border-primary/40">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">7. Follow-ups</span>
              <CalendarClock className="size-3.5 text-purple-500" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {p?.followUpsScheduled ?? 0}
              <span className="ml-1 text-xs font-normal text-muted-foreground">queued</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {p?.followUpsDueToday ?? 0} due today ({followUpDelayDays}d delay)
            </p>
          </div>
        </div>

        {/* Auto-Recrawl Decision Notice */}
        {p?.recrawlReason && (
          <div
            className={cn(
              'flex items-center gap-3 rounded-lg border px-4 py-3 text-sm',
              p.recrawlNeeded
                ? 'border-warning/40 bg-warning/10 text-warning-foreground'
                : 'border-muted bg-muted/30 text-muted-foreground',
            )}
          >
            {p.recrawlNeeded ? (
              <RefreshCw className="size-4 shrink-0 text-warning" />
            ) : (
              <CheckCircle2 className="size-4 shrink-0 text-success" />
            )}
            <div className="flex-1 text-xs sm:text-sm">
              <strong className="font-medium">
                {p.recrawlNeeded ? 'Auto-Recrawl Condition Triggered: ' : 'Queue Status: '}
              </strong>
              {p.recrawlReason}
            </div>
          </div>
        )}
      </div>

      {/* Settings Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Card 1: Batch Crawl & Daily Quotas */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sliders className="size-4 text-primary" /> Crawl & Quota Settings
            </CardTitle>
            <CardDescription>
              Set how many websites to extract in one crawl run and cap daily operations.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Setting: Crawl Batch Size */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label htmlFor="crawlBatchSize" className="text-sm font-semibold">
                    Websites Per Crawl Batch
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Number of raw websites to fetch during each discovery crawl execution.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    id="crawlBatchSize"
                    type="number"
                    min={5}
                    max={100}
                    value={crawlBatchSize}
                    onChange={(e) => setCrawlBatchSize(Math.max(5, Math.min(100, Number(e.target.value) || 5)))}
                    className="h-8 w-20 text-center font-bold tabular-nums"
                  />
                  <span className="text-xs text-muted-foreground">sites</span>
                </div>
              </div>
              <input
                type="range"
                min={5}
                max={100}
                step={5}
                value={crawlBatchSize}
                onChange={(e) => setCrawlBatchSize(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-primary"
              />
              <div className="flex gap-2">
                {[10, 20, 30, 50, 100].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setCrawlBatchSize(val)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs font-medium transition',
                      crawlBatchSize === val
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-muted/40 hover:bg-muted',
                    )}
                  >
                    {val} sites
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t pt-5" />

            {/* Setting: Daily Website Creation Limit */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label htmlFor="dailyCreation" className="text-sm font-semibold">
                    Daily Website Creation Limit
                  </label>
                  <p className="text-xs text-muted-foreground">
                    How many chatbot-enabled demo preview sites to create automatically today.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    id="dailyCreation"
                    type="number"
                    min={1}
                    max={50}
                    value={dailyWebsiteCreationLimit}
                    onChange={(e) =>
                      setDailyWebsiteCreationLimit(Math.max(1, Math.min(50, Number(e.target.value) || 1)))
                    }
                    className="h-8 w-20 text-center font-bold tabular-nums"
                  />
                  <span className="text-xs text-muted-foreground">/ day</span>
                </div>
              </div>
              <input
                type="range"
                min={1}
                max={50}
                value={dailyWebsiteCreationLimit}
                onChange={(e) => setDailyWebsiteCreationLimit(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-primary"
              />
              <div className="flex gap-2">
                {[3, 5, 10, 20, 50].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setDailyWebsiteCreationLimit(val)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs font-medium transition',
                      dailyWebsiteCreationLimit === val
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-muted/40 hover:bg-muted',
                    )}
                  >
                    {val} / day
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t pt-5" />

            {/* Setting: Daily Customer Reach Limit */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label htmlFor="dailyReach" className="text-sm font-semibold">
                    Daily Customer Reach Limit
                  </label>
                  <p className="text-xs text-muted-foreground">
                    How many qualified new customers to contact via outreach per day.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    id="dailyReach"
                    type="number"
                    min={1}
                    max={50}
                    value={dailyCustomerReachLimit}
                    onChange={(e) =>
                      setDailyCustomerReachLimit(Math.max(1, Math.min(50, Number(e.target.value) || 1)))
                    }
                    className="h-8 w-20 text-center font-bold tabular-nums"
                  />
                  <span className="text-xs text-muted-foreground">/ day</span>
                </div>
              </div>
              <input
                type="range"
                min={1}
                max={50}
                value={dailyCustomerReachLimit}
                onChange={(e) => setDailyCustomerReachLimit(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-primary"
              />
              <div className="flex gap-2">
                {[3, 5, 10, 20, 50].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setDailyCustomerReachLimit(val)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs font-medium transition',
                      dailyCustomerReachLimit === val
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-muted/40 hover:bg-muted',
                    )}
                  >
                    {val} / day
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Auto-Recrawl & Queue Replenishment */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="size-4 text-primary" /> Auto-Recrawl & Replenishment
            </CardTitle>
            <CardDescription>
              Continuous replenishment loop that re-crawls until your daily creation quota is satisfied.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3.5">
              <div className="space-y-0.5">
                <span className="text-sm font-medium">Automatic Replenishment Loop</span>
                <p className="text-xs text-muted-foreground">
                  Triggers next crawl batch when queue has fewer qualified leads than today&apos;s creation target.
                </p>
              </div>
              <Switch
                checked={autoRecrawlEnabled}
                onCheckedChange={setAutoRecrawlEnabled}
                disabled={!canEdit}
                aria-label="Toggle auto-recrawl"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="minBuffer" className="text-sm font-medium">
                  Minimum Queue Buffer
                </label>
                <Input
                  id="minBuffer"
                  type="number"
                  min={1}
                  max={25}
                  value={minQueueBuffer}
                  onChange={(e) => setMinQueueBuffer(Math.max(1, Number(e.target.value) || 1))}
                  className="font-bold tabular-nums"
                />
                <p className="text-xs text-muted-foreground">Keeps minimum qualified leads buffered.</p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="maxCrawlRuns" className="text-sm font-medium">
                  Max Daily Crawl Runs
                </label>
                <Input
                  id="maxCrawlRuns"
                  type="number"
                  min={1}
                  max={30}
                  value={maxDailyCrawlRuns}
                  onChange={(e) => setMaxDailyCrawlRuns(Math.max(1, Number(e.target.value) || 1))}
                  className="font-bold tabular-nums"
                />
                <p className="text-xs text-muted-foreground">Daily safety circuit-breaker.</p>
              </div>
            </div>

            <div className="border-t pt-4" />

            {/* Target Criteria for Auto-Crawl */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Target Discovery Region & Industries
              </h3>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="countrySelect" className="text-xs font-medium text-muted-foreground">
                    Target Country
                  </label>
                  <Select value={targetCountry} onValueChange={setTargetCountry} disabled={!canEdit}>
                    <SelectTrigger id="countrySelect">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {options.data?.countries.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.name} ({c.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Target Search Areas (Cities)</label>
                  <MultiSelect
                    options={countryProfile?.cities ?? []}
                    value={targetCities}
                    onChange={setTargetCities}
                    placeholder="All cities"
                    allLabel="All cities"
                    disabled={!canEdit}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Target Industries</label>
                <MultiSelect
                  options={options.data?.industries ?? []}
                  value={targetIndustries}
                  onChange={setTargetIndustries}
                  placeholder="All standard industries"
                  allLabel="All 30 standard industries"
                  disabled={!canEdit}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Dynamic Follow-Up Scheduling & Template Slot */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="size-4 text-primary" /> Automated Follow-Up Email Scheduling
              </CardTitle>
              <CardDescription>
                Dynamically schedule cold email follow-ups with weekend skipping, preferred delivery window, and custom
                copy format.
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">{followUpEnabled ? 'Follow-ups On' : 'Follow-ups Off'}</span>
              <Switch
                checked={followUpEnabled}
                onCheckedChange={setFollowUpEnabled}
                disabled={!canEdit}
                aria-label="Toggle follow-up automation"
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-6 md:grid-cols-3">
              {/* Follow-up Delay Days */}
              <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Follow-Up Delay</span>
                  <span className="font-display text-lg font-bold tabular-nums text-primary">
                    {followUpDelayDays} {followUpDelayDays === 1 ? 'day' : 'days'}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={14}
                  value={followUpDelayDays}
                  onChange={(e) => setFollowUpDelayDays(Number(e.target.value))}
                  disabled={!followUpEnabled || !canEdit}
                  className="h-2 w-full cursor-pointer accent-primary"
                />
                <p className="text-xs text-muted-foreground">Days to wait after the initial outreach is sent.</p>
              </div>

              {/* Follow-up Mode: Business vs Calendar */}
              <div className="space-y-2 rounded-lg border bg-muted/20 p-4">
                <span className="text-sm font-medium">Schedule Mode</span>
                <Select
                  value={followUpMode}
                  onValueChange={(val: 'business_days' | 'calendar_days') => setFollowUpMode(val)}
                  disabled={!followUpEnabled || !canEdit}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="business_days">Business days only (Skip weekends)</SelectItem>
                    <SelectItem value="calendar_days">Calendar days (Includes weekends)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Business mode skips Saturdays and Sundays so emails arrive on work days.
                </p>
              </div>

              {/* Preferred Send Hour */}
              <div className="space-y-2 rounded-lg border bg-muted/20 p-4">
                <span className="text-sm font-medium">Preferred Dispatch Window</span>
                <Select
                  value={String(followUpPreferredHour)}
                  onValueChange={(val) => setFollowUpPreferredHour(Number(val))}
                  disabled={!followUpEnabled || !canEdit}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="9">09:00 AM (Morning)</SelectItem>
                    <SelectItem value="10">10:00 AM (Recommended)</SelectItem>
                    <SelectItem value="11">11:00 AM</SelectItem>
                    <SelectItem value="14">02:00 PM (Afternoon)</SelectItem>
                    <SelectItem value="16">04:00 PM</SelectItem>
                  </SelectContent>
                </Select>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-primary">
                  <Calendar className="size-3.5" />
                  <span>Next sample: {followUpExamplePreview}</span>
                </div>
              </div>
            </div>

            {/* Follow-up Custom Email Format Slot */}
            <div className="space-y-3 rounded-xl border bg-muted/10 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Follow-Up Email Template & Format Slot</h3>
                  <p className="text-xs text-muted-foreground">
                    Customize your follow-up subject and body. When left blank, a clean default follow-up is dispatched.
                  </p>
                </div>
                <Badge variant={followUpBodyTemplate.trim() ? 'success' : 'outline'}>
                  {followUpBodyTemplate.trim() ? 'Custom Template Active' : 'Default Follow-up Placeholder Active'}
                </Badge>
              </div>

              <div className="space-y-3 pt-2">
                <Field
                  label="Follow-Up Subject Line (Optional)"
                  htmlFor="followUpSubject"
                  hint="Supports {companyName} and {demoUrl} variables"
                >
                  <Input
                    id="followUpSubject"
                    value={followUpSubject}
                    onChange={(e) => setFollowUpSubject(e.target.value)}
                    placeholder="Quick follow up regarding {companyName}'s MonCha chatbot demo"
                    disabled={!followUpEnabled || !canEdit}
                  />
                </Field>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="followUpBodyTemplate" className="text-sm font-medium">
                      Follow-Up Body Template (Optional)
                    </label>
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-muted-foreground">Insert:</span>
                      <button
                        type="button"
                        onClick={() => setFollowUpBodyTemplate((prev) => `${prev} {companyName}`)}
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-muted/80"
                      >
                        {'{companyName}'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setFollowUpBodyTemplate((prev) => `${prev} {demoUrl}`)}
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-muted/80"
                      >
                        {'{demoUrl}'}
                      </button>
                    </div>
                  </div>
                  <textarea
                    id="followUpBodyTemplate"
                    rows={4}
                    value={followUpBodyTemplate}
                    onChange={(e) => setFollowUpBodyTemplate(e.target.value)}
                    placeholder="Hi {companyName} team,\n\nI wanted to quickly follow up on the interactive AI support assistant demo we created for your business: {demoUrl}\n\nHave you had a chance to test it out? Feel free to let us know if you'd like any custom responses tailored.\n\nBest regards,\nMonCha Team"
                    disabled={!followUpEnabled || !canEdit}
                    className="w-full rounded-md border border-input bg-card p-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex items-center justify-between border-t bg-muted/20 px-6 py-4">
            <span className="text-xs text-muted-foreground">
              Last saved:{' '}
              {pipeline.data?.settings.updatedAt ? formatRelative(pipeline.data.settings.updatedAt) : 'Never'}
            </span>
            <Button onClick={handleSave} disabled={!canEdit || updateSettings.isPending} loading={updateSettings.isPending}>
              <Save className="size-4" /> Save All Settings
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
