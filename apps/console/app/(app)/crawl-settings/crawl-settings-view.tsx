'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Eye, Play } from 'lucide-react';
import { toast } from 'sonner';
import { CRAWL_SETTINGS_LIMITS as LIMITS } from '@moncha/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/app/page-header';
import { ErrorState, InlineAlert } from '@/components/app/states';
import { JobTracker } from '@/components/app/job-tracker';
import { MultiSelect } from '@/components/app/widgets';
import { useCanEdit } from '@/components/app/user-context';
import {
  useColdEmailGate,
  useCrawlPipeline,
  useDiscoveryOptions,
  useFollowUpEmailPreview,
  useSchedules,
  useTriggerCrawlBatch,
  useUpdateCrawlPipeline,
} from '@/lib/queries';
import { ApiError, errorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { TodayActivity } from './activity';
import { CRAWL_MODE_OPTIONS, crawlCost, runsLeftToday, toPayload } from './form';
import { followUpPreview, hourLabel, zoneLabel } from './follow-up-time';
import { FollowUpPreviewDialog } from './follow-up-preview-dialog';
import { NumberField, SettingsSection, ToggleRow } from './sections';
import { EmailDeliveryNotice, StatusStrip, emailDelivery } from './status';
import { useCrawlSettingsForm } from './use-crawl-settings-form';

const SAMPLE_COMPANY = 'Car Battery SG';
const SAMPLE_DEMO_URL = 'https://carbattery-sg.vinothjv4-tech.workers.dev';
const HOURS = Array.from({ length: 24 }, (_, h) => h);

function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading crawl settings">
      <Skeleton className="h-20" />
      <Skeleton className="h-36" />
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-56" />
      ))}
    </div>
  );
}

export function CrawlSettingsView() {
  const canEdit = useCanEdit();
  const pipeline = useCrawlPipeline();
  const options = useDiscoveryOptions();
  const gate = useColdEmailGate();
  const updateSettings = useUpdateCrawlPipeline();
  const triggerCrawl = useTriggerCrawlBatch();
  const preview = useFollowUpEmailPreview();
  const schedules = useSchedules();

  const saved = pipeline.data?.settings;
  const form = useCrawlSettingsForm(saved);
  const [active, setActive] = useState(false);
  const [togglingEngine, setTogglingEngine] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (saved && !togglingEngine) setActive(saved.active);
  }, [saved, togglingEngine]);

  const header = (
    <PageHeader
      title="Crawl & Pipeline Settings"
      description="The one place automation is controlled: crawling, website copies, cold emails and follow-ups."
    />
  );

  if (!pipeline.data || !saved || !form.values) {
    return (
      <div className="space-y-6 pb-12">
        {header}
        {pipeline.isError ? (
          <Card>
            <ErrorState title="Could not load crawl settings" error={pipeline.error} onRetry={() => void pipeline.refetch()} />
          </Card>
        ) : (
          <PageSkeleton />
        )}
      </div>
    );
  }

  const v = form.values;
  const editable = canEdit && !updateSettings.isPending;
  const gateForbidden = gate.error instanceof ApiError && gate.error.status === 403;
  const delivery = emailDelivery(gate.data, gateForbidden);
  const countries = options.data?.countries ?? [];
  const country = countries.find((c) => c.code === v.targetCountry);
  const timezone = country?.timezone ?? 'UTC';
  const cost = crawlCost(Number(v.crawlBatchSize), Number(v.maxPagesPerSearch));
  const industryCount = options.data?.industries.length ?? 0;
  const canSave = editable && form.dirty && form.valid;
  const runsLeft = runsLeftToday(saved, {
    runs: pipeline.data.progress.crawlsRunToday,
    scheduledRuns: pipeline.data.progress.scheduledRunsToday ?? 0,
  });
  const scheduleCount = schedules.data ? schedules.data.reduce((n, g) => n + g.timesPerDay, 0) : null;

  async function handleSave() {
    if (!form.values || !form.valid) return;
    try {
      const res = await updateSettings.mutateAsync(toPayload(form.values));
      form.markSaved(res.settings);
      toast.success('Settings saved');
    } catch (err) {
      toast.error('Could not save settings', { description: errorMessage(err) });
    }
  }

  async function handleToggleEngine(next: boolean) {
    setActive(next);
    setTogglingEngine(true);
    try {
      await updateSettings.mutateAsync({ active: next });
      toast.success(next ? 'Engine is on' : 'Engine is paused', {
        description: next
          ? 'Crawls, website copies, emails and follow-ups now run within your daily limits.'
          : 'No new crawls, copies, emails or follow-ups start until you turn it back on.',
      });
    } catch (err) {
      setActive(!next);
      toast.error('Could not change the engine', { description: errorMessage(err) });
    } finally {
      setTogglingEngine(false);
    }
  }

  async function handleTriggerCrawl() {
    try {
      const result = await triggerCrawl.mutateAsync({});
      setActiveJobId(result.id);
      toast.success(`Crawl started for ${formatNumber(result.batchSize)} websites`);
    } catch (err) {
      toast.error('Could not start the crawl', { description: errorMessage(err) });
    }
  }

  function openPreview() {
    if (!form.values) return;
    setPreviewOpen(true);
    preview.mutate({
      companyName: SAMPLE_COMPANY,
      demoUrl: SAMPLE_DEMO_URL,
      customSubject: form.values.followUpSubject.trim() || null,
      customTemplate: form.values.followUpBodyTemplate.trim() || null,
    });
  }

  const followUpsOff = !v.followUpEnabled || !editable;

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="Crawl & Pipeline Settings"
        description="The one place automation is controlled: crawling, website copies, cold emails and follow-ups."
        actions={
          <>
            {form.dirty && (
              <Badge variant="warning" dot>
                Unsaved changes
              </Badge>
            )}
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatNumber(runsLeft.unreserved)} run{runsLeft.unreserved === 1 ? '' : 's'} left today
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTriggerCrawl}
              disabled={!canEdit || form.dirty || triggerCrawl.isPending || runsLeft.unreserved === 0}
              loading={triggerCrawl.isPending}
              title={
                form.dirty
                  ? 'Save your changes first: the crawl uses the saved settings'
                  : runsLeft.unreserved === 0
                    ? 'No unreserved crawl runs left today (UTC)'
                    : undefined
              }
            >
              <Play /> Run crawl now
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!canSave} loading={updateSettings.isPending && !togglingEngine}>
              Save changes
            </Button>
          </>
        }
        className="pb-0"
      />

      <StatusStrip
        active={active}
        canEdit={canEdit}
        toggling={togglingEngine}
        onToggle={(next) => void handleToggleEngine(next)}
        workerOnline={pipeline.data.workerOnline}
        delivery={delivery}
        updatedAt={saved.updatedAt}
        updatedBy={saved.updatedBy}
      />

      {!active && (
        <InlineAlert variant="warning" title="Engine paused">
          Nothing runs on its own: no auto-recrawls, scheduled crawls, website copies, emails or follow-ups. Turn the engine
          on to start.
        </InlineAlert>
      )}
      <EmailDeliveryNotice delivery={delivery} />

      {activeJobId && <JobTracker jobId={activeJobId} onDismiss={() => setActiveJobId(null)} />}

      <TodayActivity progress={pipeline.data.progress} settings={saved} />

      <SettingsSection
        id="limits"
        title="Daily limits"
        description="Caps for each UTC day. Automation stops for the day when a limit is reached and picks up again after midnight UTC."
      >
        <div className="grid gap-5 sm:grid-cols-3">
          <NumberField
            id="dailyWebsiteCreationLimit"
            label="Website copies"
            unit="per day"
            value={v.dailyWebsiteCreationLimit}
            onChange={(x) => form.set('dailyWebsiteCreationLimit', x)}
            error={form.errors.dailyWebsiteCreationLimit}
            {...LIMITS.dailyWebsiteCreationLimit}
            disabled={!editable}
          />
          <NumberField
            id="dailyCustomerReachLimit"
            label="Businesses emailed"
            unit="per day"
            hint="Follow-ups not counted"
            value={v.dailyCustomerReachLimit}
            onChange={(x) => form.set('dailyCustomerReachLimit', x)}
            error={form.errors.dailyCustomerReachLimit}
            {...LIMITS.dailyCustomerReachLimit}
            disabled={!editable}
          />
          <NumberField
            id="maxDailyCrawlRuns"
            label="Crawl runs"
            unit="per day"
            hint="Every trigger counts"
            value={v.maxDailyCrawlRuns}
            onChange={(x) => form.set('maxDailyCrawlRuns', x)}
            error={form.errors.maxDailyCrawlRuns}
            {...LIMITS.maxDailyCrawlRuns}
            disabled={!editable}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        id="crawl-mode"
        title="How crawls start"
        description="Which triggers may start crawls. Every crawl, whoever starts it, uses one of today's crawl runs."
        aside={
          <Link href="/schedules" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
            {scheduleCount === null
              ? 'Target region schedules'
              : `${formatNumber(scheduleCount)} schedule${scheduleCount === 1 ? '' : 's'} on the Target region page`}
          </Link>
        }
      >
        <div className="grid gap-1.5">
          <Label htmlFor="crawlMode">Crawl mode</Label>
          <Select
            value={v.crawlMode}
            onValueChange={(x) => form.set('crawlMode', x as (typeof CRAWL_MODE_OPTIONS)[number]['value'])}
            disabled={!editable}
          >
            <SelectTrigger id="crawlMode" className="w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CRAWL_MODE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {CRAWL_MODE_OPTIONS.find((o) => o.value === v.crawlMode)?.description} Run crawl now always works within
            the limits.
          </p>
        </div>
        <NumberField
          id="scheduleReservedRuns"
          label="Runs reserved for schedules"
          unit={`of ${v.maxDailyCrawlRuns || '…'} crawl runs per day`}
          hint="Auto-recrawl and Run crawl now cannot use these"
          value={v.scheduleReservedRuns}
          onChange={(x) => form.set('scheduleReservedRuns', x)}
          error={form.errors.scheduleReservedRuns}
          {...LIMITS.scheduleReservedRuns}
          disabled={!editable || v.crawlMode !== 'both'}
        />
        <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Today: {formatNumber(pipeline.data.progress.crawlsRunToday)} of {formatNumber(saved.maxDailyCrawlRuns)} crawl
          runs used ({formatNumber(pipeline.data.progress.scheduledRunsToday ?? 0)} by schedules).{' '}
          {formatNumber(runsLeft.schedules)} left for schedules, {formatNumber(runsLeft.unreserved)} for auto-recrawl and
          Run crawl now.
        </p>
      </SettingsSection>

      <SettingsSection
        id="crawl-size"
        title="Crawl size"
        description="How much one crawl run fetches. Applies to auto-recrawls, scheduled crawls and Run crawl now."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <NumberField
            id="crawlBatchSize"
            label="Batch size"
            unit="websites"
            hint="20 websites per search"
            value={v.crawlBatchSize}
            onChange={(x) => form.set('crawlBatchSize', x)}
            error={form.errors.crawlBatchSize}
            {...LIMITS.crawlBatchSize}
            disabled={!editable}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="maxPagesPerSearch">Result pages per search</Label>
            <Select value={v.maxPagesPerSearch} onValueChange={(x) => form.set('maxPagesPerSearch', x)} disabled={!editable}>
              <SelectTrigger id="maxPagesPerSearch" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} page{n === 1 ? '' : 's'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Up to 20 places per page</p>
          </div>
        </div>
        {!form.errors.crawlBatchSize && (
          <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Each run makes {formatNumber(cost.searches)} search{cost.searches === 1 ? '' : 'es'}, at most{' '}
            {formatNumber(cost.maxCalls)} Google Places call{cost.maxCalls === 1 ? '' : 's'}. The backend's daily call
            budget still applies.
          </p>
        )}
      </SettingsSection>

      <SettingsSection
        id="region"
        title="Target region"
        description="Where auto-recrawls and Run crawl now search. Scheduled crawls keep their own country and use these cities only for this country."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="targetCountry">Country</Label>
            <Select value={v.targetCountry} onValueChange={form.setCountry} disabled={!editable}>
              <SelectTrigger id="targetCountry" className="w-full">
                <SelectValue placeholder="Select a country" />
              </SelectTrigger>
              <SelectContent>
                {countries.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Changing the country clears the cities.</p>
          </div>
          <div className="grid gap-1.5">
            <Label>Cities</Label>
            <MultiSelect
              options={country?.cities ?? []}
              value={v.targetCities}
              onChange={(x) => form.set('targetCities', x)}
              placeholder="All cities"
              allLabel="All cities"
              disabled={!editable}
            />
            <p className="text-xs text-muted-foreground">Leave empty to cover every city in turn.</p>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label>Industries</Label>
          <MultiSelect
            options={options.data?.industries ?? []}
            value={v.targetIndustries}
            onChange={(x) => form.set('targetIndustries', x)}
            placeholder={`All ${formatNumber(industryCount)} industries`}
            allLabel={`All ${formatNumber(industryCount)} industries`}
            disabled={!editable}
          />
          <p className="text-xs text-muted-foreground">
            {v.targetIndustries.length
              ? `${formatNumber(v.targetIndustries.length)} of ${formatNumber(industryCount)} selected`
              : 'Leave empty to search every industry.'}{' '}
            Schedules with their own industries keep them.
          </p>
        </div>
      </SettingsSection>

      <SettingsSection
        id="recrawl"
        title="Auto-recrawl"
        description="Starts another crawl when too few qualified leads are waiting for a copy, until today's copy limit or crawl-run limit is reached."
      >
        {v.crawlMode === 'scheduled_only' && (
          <InlineAlert variant="info" title="Off in Scheduled only mode">
            Auto-recrawl does not start crawls while the crawl mode is Scheduled only.
          </InlineAlert>
        )}
        <ToggleRow
          id="autoRecrawlEnabled"
          label="Recrawl automatically"
          description="Waits for running website audits before deciding."
          checked={v.autoRecrawlEnabled}
          onCheckedChange={(x) => form.set('autoRecrawlEnabled', x)}
          disabled={!editable}
        />
        <NumberField
          id="minQueueBuffer"
          label="Minimum leads waiting"
          unit="qualified leads"
          hint="Recrawl below this, or below today's remaining copies"
          value={v.minQueueBuffer}
          onChange={(x) => form.set('minQueueBuffer', x)}
          error={form.errors.minQueueBuffer}
          {...LIMITS.minQueueBuffer}
          disabled={!editable || !v.autoRecrawlEnabled}
        />
      </SettingsSection>

      <SettingsSection
        id="follow-ups"
        title="Follow-up emails"
        description="One reminder to each business that received a first email, on the business's local clock."
        aside={
          <Button variant="outline" size="sm" className="mt-3" onClick={openPreview} disabled={preview.isPending}>
            <Eye /> Preview email
          </Button>
        }
      >
        <ToggleRow
          id="followUpEnabled"
          label="Send follow-ups"
          description="Runs only while the engine is on."
          checked={v.followUpEnabled}
          onCheckedChange={(x) => form.set('followUpEnabled', x)}
          disabled={!editable}
        />
        <div className="grid gap-5 sm:grid-cols-3">
          <NumberField
            id="followUpDelayDays"
            label="Wait"
            unit="days"
            value={v.followUpDelayDays}
            onChange={(x) => form.set('followUpDelayDays', x)}
            error={form.errors.followUpDelayDays}
            {...LIMITS.followUpDelayDays}
            disabled={followUpsOff}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="followUpMode">Count</Label>
            <Select
              value={v.followUpMode}
              onValueChange={(x) => form.set('followUpMode', x as 'business_days' | 'calendar_days')}
              disabled={followUpsOff}
            >
              <SelectTrigger id="followUpMode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="business_days">Business days</SelectItem>
                <SelectItem value="calendar_days">Calendar days</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Business days skip weekends.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="followUpPreferredHour">Send at</Label>
            <Select
              value={String(v.followUpPreferredHour)}
              onValueChange={(x) => form.set('followUpPreferredHour', Number(x))}
              disabled={followUpsOff}
            >
              <SelectTrigger id="followUpPreferredHour" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOURS.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {hourLabel(h)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Business's local time</p>
          </div>
        </div>
        {!form.errors.followUpDelayDays && (
          <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            A first email sent now to a business in {country?.name ?? 'the target country'} gets its follow-up on{' '}
            <span className="font-medium text-foreground">
              {followUpPreview(new Date(), Number(v.followUpDelayDays), v.followUpMode, v.followUpPreferredHour, timezone)}
            </span>
            . Businesses in other countries get it at the same hour on their own clock ({zoneLabel(timezone)} shown here).
          </p>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor="followUpSubject">Subject</Label>
          <Input
            id="followUpSubject"
            value={v.followUpSubject}
            onChange={(e) => form.set('followUpSubject', e.target.value)}
            placeholder="Have you had a chance to explore your AI assistant?"
            maxLength={200}
            disabled={followUpsOff}
          />
          <p className="text-xs text-muted-foreground">Optional. Supports {'{companyName}'} and {'{demoUrl}'}.</p>
        </div>
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="followUpBodyTemplate">Message</Label>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Insert
              {['{companyName}', '{demoUrl}'].map((token) => (
                <Button
                  key={token}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 font-mono text-xs"
                  disabled={followUpsOff}
                  onClick={() => form.set('followUpBodyTemplate', `${v.followUpBodyTemplate}${v.followUpBodyTemplate ? ' ' : ''}${token}`)}
                >
                  {token}
                </Button>
              ))}
            </div>
          </div>
          <Textarea
            id="followUpBodyTemplate"
            rows={5}
            value={v.followUpBodyTemplate}
            onChange={(e) => form.set('followUpBodyTemplate', e.target.value)}
            placeholder="Leave empty to send the standard MonCha reminder."
            maxLength={10000}
            disabled={followUpsOff}
          />
          <p className="text-xs text-muted-foreground">
            Replaces the opening paragraphs. The heading, benefits and sign-off are always added.
          </p>
        </div>
      </SettingsSection>

      {form.dirty && (
        <div className="sticky bottom-4 z-20">
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/95 px-4 py-3 shadow-lg backdrop-blur"
          >
            <p className="text-sm">
              {form.valid ? 'You have unsaved changes.' : 'Fix the highlighted fields before saving.'}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={form.discard} disabled={updateSettings.isPending}>
                Discard
              </Button>
              <Button size="sm" onClick={handleSave} disabled={!canSave} loading={updateSettings.isPending && !togglingEngine}>
                Save changes
              </Button>
            </div>
          </div>
        </div>
      )}

      <FollowUpPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        preview={preview.data}
        loading={preview.isPending}
        error={preview.error}
        onRetry={openPreview}
      />
    </div>
  );
}
