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
  Eye,
  Filter,
  Gauge,
  Globe,
  Info,
  Layers,
  Mail,
  Minus,
  Play,
  Plus,
  Radar,
  RefreshCw,
  Save,
  Send,
  Shield,
  ShieldCheck,
  Sliders,
  SlidersHorizontal,
  Sparkles,
  Target,
  Workflow,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  useFollowUpEmailPreview,
  useTriggerCrawlBatch,
  useUpdateCrawlPipeline,
} from '@/lib/queries';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import type { CrawlPipelineSettingsUpdate } from '@/lib/types';
import { cn } from '@/lib/utils';

function QuotaStepper({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  presets,
  unit,
  disabled,
}: {
  value: number;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
  step?: number;
  presets?: number[];
  unit?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center rounded-lg border bg-card p-0.5 shadow-2xs transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onChange(Math.max(min, (Number(value) || 0) - step))}
            disabled={disabled || (min !== undefined && value <= min)}
            aria-label="Decrease value"
          >
            <Minus className="size-3.5" />
          </Button>
          <input
            type="number"
            min={min}
            max={max}
            value={value}
            disabled={disabled}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') {
                onChange(min);
                return;
              }
              const num = parseInt(raw, 10);
              if (!isNaN(num)) {
                onChange(max !== undefined ? Math.min(max, Math.max(min, num)) : Math.max(min, num));
              }
            }}
            className="w-16 bg-transparent px-1 text-center font-display text-base font-bold tabular-nums text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onChange((Number(value) || 0) + step)}
            disabled={disabled || (max !== undefined && value >= max)}
            aria-label="Increase value"
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
        {unit && <span className="text-xs font-medium text-muted-foreground">{unit}</span>}
      </div>

      {presets && presets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={disabled}
              onClick={() => onChange(preset)}
              className={cn(
                'rounded-md px-2.5 py-0.5 text-xs font-medium transition-all',
                value === preset
                  ? 'bg-primary text-primary-foreground font-semibold shadow-2xs'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {preset}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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

  // Follow-up email template preview
  const followUpPreview = useFollowUpEmailPreview();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState<'html' | 'text'>('html');

  function handleOpenPreview() {
    setPreviewOpen(true);
    followUpPreview.mutate({
      companyName: 'Car Battery SG',
      demoUrl: 'https://carbattery-sg.vinothjv4-tech.workers.dev',
      customSubject: followUpSubject.trim() || null,
      customTemplate: followUpBodyTemplate.trim() || null,
    });
  }

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

      {/* Section 1: Top 3 Executive Quota Cards */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
          Pipeline Batch Sizing & Daily Operations Targets
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {/* Tile 1: Crawl Batch Size */}
          <Card className="flex flex-col justify-between transition-all hover:border-primary/40">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex size-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <Radar className="size-5" />
                </div>
                <Badge variant="outline" className="font-mono text-xs">
                  Stage 1 · Crawl
                </Badge>
              </div>
              <CardTitle className="pt-2 text-base">Crawl Batch Size</CardTitle>
              <CardDescription className="text-xs">
                Raw websites fetched during each discovery crawl execution.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <QuotaStepper
                value={crawlBatchSize}
                onChange={setCrawlBatchSize}
                min={1}
                step={5}
                presets={[10, 20, 30, 50, 100]}
                unit="websites / crawl"
                disabled={!canEdit}
              />
              <div className="rounded-lg bg-muted/30 p-2.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Extraction footprint:</span> ~
                {Math.ceil(crawlBatchSize / 20)} Google Places search batches per run.
              </div>
            </CardContent>
          </Card>

          {/* Tile 2: Daily Website Creation Limit */}
          <Card className="flex flex-col justify-between transition-all hover:border-primary/40">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Sparkles className="size-5" />
                </div>
                <Badge variant="outline" className="font-mono text-xs">
                  Stage 5 · Creation
                </Badge>
              </div>
              <CardTitle className="pt-2 text-base">Daily Website Creation</CardTitle>
              <CardDescription className="text-xs">
                How many chatbot-enabled demo preview sites to create automatically today.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <QuotaStepper
                value={dailyWebsiteCreationLimit}
                onChange={setDailyWebsiteCreationLimit}
                min={0}
                step={1}
                presets={[3, 5, 10, 20, 50]}
                unit="demo sites / day"
                disabled={!canEdit}
              />
              <div className="space-y-1.5 rounded-lg bg-muted/30 p-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Today&apos;s creation progress:</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {p?.websitesCreatedToday ?? 0} / {dailyWebsiteCreationLimit}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{
                      width: `${Math.min(100, Math.round(((p?.websitesCreatedToday ?? 0) / Math.max(1, dailyWebsiteCreationLimit)) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tile 3: Daily Customer Reach Limit */}
          <Card className="flex flex-col justify-between transition-all hover:border-primary/40">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex size-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
                  <Send className="size-5" />
                </div>
                <Badge variant="outline" className="font-mono text-xs">
                  Stage 6 · Outreach
                </Badge>
              </div>
              <CardTitle className="pt-2 text-base">Daily Customer Reach</CardTitle>
              <CardDescription className="text-xs">
                How many qualified new businesses to contact via cold email per day.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <QuotaStepper
                value={dailyCustomerReachLimit}
                onChange={setDailyCustomerReachLimit}
                min={0}
                step={1}
                presets={[3, 5, 10, 20, 50]}
                unit="customers / day"
                disabled={!canEdit}
              />
              <div className="space-y-1.5 rounded-lg bg-muted/30 p-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Today&apos;s outreach progress:</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {p?.customersReachedToday ?? 0} / {dailyCustomerReachLimit}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-purple-500 transition-all"
                    style={{
                      width: `${Math.min(100, Math.round(((p?.customersReachedToday ?? 0) / Math.max(1, dailyCustomerReachLimit)) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Settings Grid */}
      <div className="grid gap-6 lg:grid-cols-2">

        {/* Panel 1: Auto-Recrawl & Queue Replenishment */}
        <Card className="flex flex-col justify-between">
          <div>
            <CardHeader>
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <RefreshCw className="size-4" />
                </span>
                <div>
                  <CardTitle className="text-base">Auto-Recrawl & Queue Replenishment</CardTitle>
                  <CardDescription className="text-xs">
                    Autonomous loop that re-crawls until your daily creation quota is fulfilled.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Replenishment Master Toggle */}
              <div className="flex items-center justify-between rounded-xl border bg-muted/20 p-4 transition-all">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">Automatic Replenishment Loop</span>
                    <Badge variant={autoRecrawlEnabled ? 'success' : 'muted'} dot>
                      {autoRecrawlEnabled ? 'Active' : 'Off'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Triggers the next crawl batch whenever the queue buffer has fewer qualified leads than today&apos;s
                    remaining creation target.
                  </p>
                </div>
                <Switch
                  checked={autoRecrawlEnabled}
                  onCheckedChange={setAutoRecrawlEnabled}
                  disabled={!canEdit}
                  aria-label="Toggle auto-recrawl"
                />
              </div>

              {/* Replenishment Parameters with QuotaStepper */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 rounded-xl border bg-muted/10 p-3.5">
                  <div>
                    <label className="text-xs font-semibold text-foreground">Minimum Queue Buffer</label>
                    <p className="text-[11px] text-muted-foreground">Keeps minimum qualified leads buffered.</p>
                  </div>
                  <QuotaStepper
                    value={minQueueBuffer}
                    onChange={setMinQueueBuffer}
                    min={0}
                    step={1}
                    presets={[3, 5, 10, 15]}
                    unit="leads"
                    disabled={!canEdit || !autoRecrawlEnabled}
                  />
                </div>

                <div className="space-y-2 rounded-xl border bg-muted/10 p-3.5">
                  <div>
                    <label className="text-xs font-semibold text-foreground">Max Daily Crawl Runs</label>
                    <p className="text-[11px] text-muted-foreground">Daily safety circuit-breaker.</p>
                  </div>
                  <QuotaStepper
                    value={maxDailyCrawlRuns}
                    onChange={setMaxDailyCrawlRuns}
                    min={1}
                    step={1}
                    presets={[5, 10, 15, 20]}
                    unit="runs max"
                    disabled={!canEdit || !autoRecrawlEnabled}
                  />
                </div>
              </div>

              {/* Logic Circuit Visualizer */}
              <div className="rounded-xl border border-dashed bg-muted/15 p-3 text-xs">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <Workflow className="size-3.5 text-primary" />
                  <span>Continuous Replenishment Logic:</span>
                </div>
                <p className="mt-1 text-muted-foreground">
                  Fetch <span className="font-semibold text-foreground">{crawlBatchSize} sites</span> ➜ Filter DB
                  Duplicates ➜ Audit Chatbots ➜ If Qualified in Queue &lt;{' '}
                  <span className="font-semibold text-foreground">{minQueueBuffer}</span> and Today&apos;s Sites &lt;{' '}
                  <span className="font-semibold text-foreground">{dailyWebsiteCreationLimit}</span> ➜{' '}
                  <span className="font-semibold text-primary">Trigger Next Crawl Batch ↻</span>
                </p>
              </div>
            </CardContent>
          </div>
        </Card>

        {/* Panel 2: Target Discovery Region & Industry Filters */}
        <Card className="flex flex-col justify-between">
          <div>
            <CardHeader>
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                  <Compass className="size-4" />
                </span>
                <div>
                  <CardTitle className="text-base">Target Discovery Region & Industries</CardTitle>
                  <CardDescription className="text-xs">
                    Geographic and keyword focus for autonomous replenishment crawl executions.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="countrySelect" className="text-xs font-semibold text-foreground">
                    Target Country
                  </label>
                  <Select value={targetCountry} onValueChange={setTargetCountry} disabled={!canEdit}>
                    <SelectTrigger id="countrySelect" className="w-full">
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
                  <p className="text-[11px] text-muted-foreground">Region for Google Places search queries.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Target Search Areas (Cities)</label>
                  <MultiSelect
                    options={countryProfile?.cities ?? []}
                    value={targetCities}
                    onChange={setTargetCities}
                    placeholder="All major cities"
                    allLabel="All cities in region"
                    disabled={!canEdit}
                  />
                  <p className="text-[11px] text-muted-foreground">Leave empty to cycle through all cities.</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">Target Industries</label>
                  <span className="text-[11px] text-muted-foreground">
                    {targetIndustries.length > 0
                      ? `${targetIndustries.length} industries selected`
                      : 'All 30 standard industries'}
                  </span>
                </div>
                <MultiSelect
                  options={options.data?.industries ?? []}
                  value={targetIndustries}
                  onChange={setTargetIndustries}
                  placeholder="All 30 standard industries"
                  allLabel="All 30 standard industries"
                  disabled={!canEdit}
                />
                <p className="text-[11px] text-muted-foreground">
                  Narrows crawling to specific business verticals (e.g. clinics, salons, dental, gyms).
                </p>
              </div>

              {/* Scope pill preview */}
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/20 p-3 text-xs">
                <span className="font-medium text-foreground">Active Scope:</span>
                <Badge variant="outline">
                  <Globe className="mr-1 size-3" /> {countryProfile?.name ?? targetCountry}
                </Badge>
                <Badge variant="outline">
                  <Target className="mr-1 size-3" />{' '}
                  {targetCities.length > 0 ? `${targetCities.length} Cities` : 'All Major Cities'}
                </Badge>
                <Badge variant="outline">
                  <Filter className="mr-1 size-3" />{' '}
                  {targetIndustries.length > 0 ? `${targetIndustries.length} Industries` : '30 Standard Industries'}
                </Badge>
              </div>
            </CardContent>
          </div>
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleOpenPreview}
                disabled={followUpPreview.isPending}
                className="gap-1.5"
              >
                <Eye className="size-3.5 text-primary" /> Preview Email
              </Button>
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
              <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
                <div>
                  <label className="text-xs font-semibold text-foreground">Follow-Up Delay</label>
                  <p className="text-[11px] text-muted-foreground">Days to wait after the initial outreach is sent.</p>
                </div>
                <QuotaStepper
                  value={followUpDelayDays}
                  onChange={setFollowUpDelayDays}
                  min={0}
                  step={1}
                  presets={[1, 2, 3, 5, 7]}
                  unit="days wait"
                  disabled={!followUpEnabled || !canEdit}
                />
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
                    Customize your follow-up subject and body. When left blank, the official MonCha reminder email is dispatched.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={followUpBodyTemplate.trim() ? 'success' : 'outline'}>
                    {followUpBodyTemplate.trim() ? 'Custom Template Active' : 'Default MonCha Reminder Active'}
                  </Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleOpenPreview}
                    disabled={followUpPreview.isPending}
                    className="h-7 text-xs text-primary hover:text-primary gap-1"
                  >
                    <Eye className="size-3" /> Preview
                  </Button>
                </div>
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

        {/* Follow-Up Reminder Email Preview Dialog */}
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-3xl overflow-hidden p-0 max-h-[92vh] flex flex-col">
            <DialogHeader className="border-b p-5 bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <DialogTitle className="flex items-center gap-2">
                    <Eye className="size-4 text-primary" /> Follow-Up Reminder Email Preview
                  </DialogTitle>
                  <DialogDescription className="mt-1">
                    Matches the official MonCha layout sent to customer after initial outreach.
                  </DialogDescription>
                </div>
                <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setPreviewTab('html')}
                    className={cn(
                      'rounded-md px-2.5 py-1 font-medium transition-all',
                      previewTab === 'html'
                        ? 'bg-card text-foreground font-semibold shadow-2xs'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    Rendered Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewTab('text')}
                    className={cn(
                      'rounded-md px-2.5 py-1 font-medium transition-all',
                      previewTab === 'text'
                        ? 'bg-card text-foreground font-semibold shadow-2xs'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    Plaintext
                  </button>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-1.5 text-xs">
                <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
                  Subject:
                </span>
                <span className="font-medium text-foreground">
                  {followUpPreview.data?.subject ||
                    (followUpSubject.trim()
                      ? followUpSubject.replace(/\{companyName\}/gi, 'Car Battery SG')
                      : 'Have you had a chance to explore your AI assistant?')}
                </span>
              </div>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto bg-muted/10 p-5 flex justify-center">
              {followUpPreview.isPending ? (
                <div className="flex flex-col items-center justify-center p-12 space-y-3">
                  <RefreshCw className="size-6 animate-spin text-primary" />
                  <p className="text-xs text-muted-foreground">Rendering follow-up template...</p>
                </div>
              ) : previewTab === 'html' ? (
                <iframe
                  srcDoc={followUpPreview.data?.html}
                  className="w-full max-w-[580px] min-h-[580px] rounded-xl border bg-white shadow-xs"
                  title="Follow-Up Email Preview"
                  sandbox="allow-same-origin"
                />
              ) : (
                <pre className="w-full max-w-[580px] whitespace-pre-wrap rounded-xl border bg-card p-5 font-mono text-xs text-foreground leading-relaxed shadow-xs">
                  {followUpPreview.data?.text}
                </pre>
              )}
            </div>

            <DialogFooter className="border-t p-4 bg-card flex items-center justify-between sm:justify-between">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CheckCircle2 className="size-3.5 text-emerald-500" />
                <span>Verified MonCha design system with live demo link integration</span>
              </div>
              <Button variant="outline" size="sm" onClick={() => setPreviewOpen(false)}>
                Close Preview
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
