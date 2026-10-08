'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  ClipboardCheck,
  Database,
  ExternalLink,
  Globe,
  Loader2,
  MapPin,
  Phone,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState, ErrorState, InlineAlert } from '@/components/app/states';
import { JobStatusBadge, QueueBadge, VerdictBadge, WebsiteStatusBadge } from '@/components/app/status';
import { CopyButton, DetailRow, JsonView } from '@/components/app/widgets';
import { useCanEdit } from '@/components/app/user-context';
import { WebsiteCopyCard } from '@/components/sites/website-copy-card';
import { api, ApiError, errorMessage } from '@/lib/api';
import { qk, useJob, useLead } from '@/lib/queries';
import { formatDateTime, formatRelative, humanize } from '@/lib/format';
import type { QueuedJob } from '@/lib/types';

function AuditTracker({ jobId, leadId, onDone }: { jobId: string; leadId: string; onDone: () => void }) {
  const client = useQueryClient();
  const { data: job } = useJob(jobId);
  useEffect(() => {
    if (job?.status === 'done' || job?.status === 'failed') {
      void client.invalidateQueries({ queryKey: qk.lead(leadId) });
      void client.invalidateQueries({ queryKey: ['leads'] });
      if (job.status === 'done') toast.success('Website audit finished');
      else toast.error('Website audit failed', { description: job.lastError ?? undefined });
      onDone();
    }
  }, [job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <InlineAlert
      variant="info"
      icon={Loader2}
      title={job?.status === 'running' ? 'Auditing website…' : 'Audit queued'}
      className="[&_svg]:animate-spin"
    >
      <span className="flex flex-wrap items-center gap-2">
        HTML scan, rendered page check and AI review run in the background worker.
        {job && <JobStatusBadge status={job.status} />}
      </span>
    </InlineAlert>
  );
}

export function LeadDetailView({ id }: { id: string }) {
  const canEdit = useCanEdit();
  const { data: lead, isLoading, error, refetch } = useLead(id);
  const [auditJob, setAuditJob] = useState<string | null>(null);
  const [queueing, setQueueing] = useState(false);

  async function reaudit() {
    setQueueing(true);
    try {
      const job = await api<QueuedJob>(`leads/${id}/audit`, { method: 'POST' });
      setAuditJob(job.id);
      toast.success(job.deduped ? 'An audit is already queued for this lead' : 'Website audit queued');
    } catch (e) {
      toast.error('Could not queue the audit', { description: errorMessage(e) });
    } finally {
      setQueueing(false);
    }
  }

  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <Card>
        {notFound ? (
          <EmptyState
            icon={Building2}
            title="Lead not found"
            description="It may have been removed, or it belongs to another workspace."
            action={
              <Button variant="outline" asChild>
                <Link href="/leads">
                  <ArrowLeft /> Back to leads
                </Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={error} onRetry={() => refetch()} />
        )}
      </Card>
    );
  }

  if (isLoading || !lead) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-8 w-72" />
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  const { company } = lead;
  const website = company.website;
  const siteUrl = website?.finalUrl || website?.url || (company.domain ? `https://${company.domain}` : null);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Leads', href: '/leads' }, { label: company.name }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {company.name}
            <QueueBadge queue={lead.queue} />
          </span>
        }
        description={
          company.domain ? (
            <span className="inline-flex items-center gap-1.5">
              <Globe className="size-3.5" /> {company.domain}
            </span>
          ) : (
            'No website on record'
          )
        }
        actions={
          <>
            {siteUrl && (
              <Button variant="outline" asChild>
                <a href={siteUrl} target="_blank" rel="noreferrer noopener">
                  <ExternalLink /> Visit site
                </a>
              </Button>
            )}
            {canEdit && (
              <Button onClick={reaudit} loading={queueing} disabled={!company.domain || Boolean(auditJob)}>
                {!queueing && <RefreshCw />} Re-audit website
              </Button>
            )}
          </>
        }
        className="pb-0"
      />

      {auditJob && <AuditTracker jobId={auditJob} leadId={id} onDone={() => setAuditJob(null)} />}

      {lead.queue === 'NEEDS_REVIEW' && (
        <InlineAlert variant="warning" icon={ClipboardCheck} title="This lead is waiting for a human decision">
          The last audit was not confident enough to qualify it automatically.{' '}
          <Link
            href={`/reviews?search=${encodeURIComponent(company.domain || company.name)}`}
            className="font-medium text-foreground underline underline-offset-2"
          >
            Open in review queue
          </Link>
        </InlineAlert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" /> Qualification
              </CardTitle>
              <CardDescription>Result of the latest website audit</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Assistant verdict</p>
                  <div className="mt-1.5">
                    <VerdictBadge verdict={lead.assistantVerdict} />
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Detected vendor</p>
                  <p className="mt-1 text-sm font-medium">{lead.assistantVendor || 'None'}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Website status</p>
                  <div className="mt-1.5">
                    <WebsiteStatusBadge status={website?.status ?? (company.domain ? 'UNCHECKED' : null)} />
                  </div>
                </div>
              </div>
              <dl className="divide-y">
                <DetailRow label="Reason">{humanize(lead.qualificationReason)}</DetailRow>
                <DetailRow label="Latest audit">
                  {lead.latestAuditId ? (
                    <span className="inline-flex items-center gap-1 font-mono text-xs">
                      {lead.latestAuditId} <CopyButton value={lead.latestAuditId} />
                    </span>
                  ) : (
                    'Not audited yet'
                  )}
                </DetailRow>
                <DetailRow label="Last updated">
                  {formatDateTime(lead.updatedAt)}{' '}
                  <span className="text-muted-foreground">({formatRelative(lead.updatedAt)})</span>
                </DetailRow>
                <DetailRow label="Revision">v{lead.version}</DetailRow>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="size-4 text-primary" /> Website
              </CardTitle>
              <CardDescription>What the crawler saw on the last check</CardDescription>
            </CardHeader>
            <CardContent>
              {website ? (
                <dl className="divide-y">
                  <DetailRow label="URL">
                    <a href={website.url} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                      {website.url}
                    </a>
                  </DetailRow>
                  <DetailRow label="Final URL">{website.finalUrl || '—'}</DetailRow>
                  <DetailRow label="Page title">{website.title || '—'}</DetailRow>
                  <DetailRow label="HTTP status">
                    {website.httpStatus ? (
                      <span
                        className={
                          website.httpStatus < 400 ? 'font-medium text-success' : 'font-medium text-destructive'
                        }
                      >
                        {website.httpStatus}
                      </span>
                    ) : (
                      '—'
                    )}
                  </DetailRow>
                  <DetailRow label="Language">{website.language?.toUpperCase() || '—'}</DetailRow>
                  <DetailRow label="Last checked">
                    {website.lastCheckedAt ? `${formatDateTime(website.lastCheckedAt)} (${formatRelative(website.lastCheckedAt)})` : 'Never'}
                  </DetailRow>
                </dl>
              ) : (
                <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  {company.domain ? 'The website has not been checked yet.' : 'This company has no website to audit.'}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="size-4 text-primary" /> Sources
              </CardTitle>
              <CardDescription>Where this company was discovered</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {company.sourceRecords.length === 0 ? (
                <p className="text-sm text-muted-foreground">Added manually.</p>
              ) : (
                company.sourceRecords.map((src) => (
                  <details key={src.id} className="group rounded-lg border">
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm">
                      <span className="font-medium">{humanize(src.source)}</span>
                      {src.externalId && (
                        <span className="truncate font-mono text-xs text-muted-foreground">{src.externalId}</span>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(src.createdAt)}</span>
                    </summary>
                    {src.rawJson != null && (
                      <div className="border-t p-3">
                        <JsonView value={src.rawJson} />
                      </div>
                    )}
                  </details>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <WebsiteCopyCard leadId={lead.id} hasWebsite={Boolean(siteUrl)} />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="size-4 text-primary" /> Company
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p>{company.address || 'No address'}</p>
                  <p className="text-muted-foreground">{[company.city, company.country].filter(Boolean).join(', ') || '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="size-4 shrink-0 text-muted-foreground" />
                {company.phone ? (
                  <a href={`tel:${company.phone.replace(/\s+/g, '')}`} className="text-primary hover:underline">
                    {company.phone}
                  </a>
                ) : (
                  <span className="text-muted-foreground">No phone</span>
                )}
              </div>
              <Separator />
              <dl className="divide-y">
                <DetailRow label="Added">{formatDateTime(lead.createdAt)}</DetailRow>
                <DetailRow label="Lead ID">
                  <span className="inline-flex items-center gap-1 font-mono text-xs">
                    {lead.id.slice(0, 12)}… <CopyButton value={lead.id} />
                  </span>
                </DetailRow>
              </dl>
            </CardContent>
          </Card>

          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-sm">Next step</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {lead.queue === 'QUALIFIED'
                ? 'This business has no conversational assistant on its website — it is ready for outreach.'
                : lead.queue === 'HAS_ASSISTANT'
                  ? 'A chatbot or live chat is already installed. Usually not a fit unless replacing the vendor.'
                  : lead.queue === 'PENDING_AUDIT'
                    ? 'The website audit has not finished yet. It runs automatically in the background.'
                    : lead.queue === 'NEEDS_REVIEW'
                      ? 'Resolve the review task to move this lead to the right queue.'
                      : lead.queue === 'NO_WEBSITE'
                        ? 'No website to audit. Reach out by phone, or add a domain and re-audit.'
                        : 'The site looks parked or unreachable. Re-audit later to check again.'}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
