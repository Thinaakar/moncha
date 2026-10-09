'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight, Download, FileText, Info, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InlineAlert } from '@/components/app/states';
import { JobStatusBadge } from '@/components/app/status';
import { CopyButton, DetailRow, JsonView } from '@/components/app/widgets';
import { failureText, warningText } from '@/components/sites/labels';
import { OriginBadge } from '@/components/sites/automation';
import { GithubDetailsCard } from '@/components/sites/github-push';
import { siteFileUrl, useJob } from '@/lib/queries';
import { formatBytes, formatDateTime, formatDuration, formatNumber, humanize } from '@/lib/format';
import type { SiteSnapshotDetail } from '@/lib/types';

const FILES = [
  { name: 'source.html', description: 'HTML exactly as served (view-source)' },
  { name: 'rendered.html', description: 'DOM after the page scripts ran' },
  { name: 'index.html', description: 'Source with asset URLs pointed at the local copies' },
  { name: 'demo.html', description: 'index.html plus the MonCha widget' },
  { name: 'brand.json', description: 'Brand details' },
  { name: 'manifest.json', description: 'Assets, skipped files, redirects and exceptions' },
  { name: 'screenshot-desktop.png', description: '1440 px wide, full page' },
  { name: 'screenshot-mobile.png', description: '390 px wide, full page' },
];

export function SnapshotDetails({ snapshot }: { snapshot: SiteSnapshotDetail }) {
  const { data: job } = useJob(snapshot.jobId);
  const manifest = snapshot.manifest;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        {snapshot.failureReason && (
          <InlineAlert
            variant={snapshot.status === 'failed' ? 'destructive' : 'warning'}
            icon={AlertTriangle}
            title={snapshot.status === 'failed' ? 'Copy failed' : 'Last attempt failed'}
          >
            {failureText(snapshot.failureReason)} <span className="font-mono text-xs">({snapshot.failureReason})</span>
          </InlineAlert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="size-4 text-primary" /> Job
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <DetailRow label="Status">
                <JobStatusBadge status={snapshot.status} />
              </DetailRow>
              <DetailRow label="Started by">
                <span className="flex flex-wrap items-center gap-2">
                  <OriginBadge origin={snapshot.origin} />
                  {snapshot.origin === 'auto' && snapshot.crawlJobId && (
                    <Link href={`/jobs?job=${snapshot.crawlJobId}`} className="text-xs text-primary hover:underline">
                      Country crawl
                    </Link>
                  )}
                </span>
              </DetailRow>
              <DetailRow label="Requested">{formatDateTime(snapshot.createdAt)}</DetailRow>
              <DetailRow label="Started">{formatDateTime(job?.startedAt)}</DetailRow>
              <DetailRow label="Finished">{formatDateTime(snapshot.finishedAt)}</DetailRow>
              <DetailRow label="Duration">{formatDuration(job?.startedAt, snapshot.finishedAt ?? job?.finishedAt)}</DetailRow>
              <DetailRow label="Attempts">{job ? `${job.attempts} of ${job.maxAttempts}` : '—'}</DetailRow>
              <DetailRow label="Job ID">
                {snapshot.jobId ? (
                  <span className="inline-flex items-center gap-1 font-mono text-xs">
                    {snapshot.jobId} <CopyButton value={snapshot.jobId} />
                  </span>
                ) : (
                  '—'
                )}
              </DetailRow>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Page</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <DetailRow label="Requested URL">{snapshot.sourceUrl}</DetailRow>
              <DetailRow label="Final URL">{snapshot.finalUrl ?? '—'}</DetailRow>
              <DetailRow label="HTTP status">{snapshot.httpStatus ?? '—'}</DetailRow>
              <DetailRow label="Redirects">
                {manifest?.redirects.length ? (
                  <ol className="space-y-1">
                    {manifest.redirects.map((r, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs break-all">
                        <ArrowRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" /> {r}
                      </li>
                    ))}
                  </ol>
                ) : (
                  'None'
                )}
              </DetailRow>
              <DetailRow label="Source size">
                {snapshot.sourceBytes === null ? '—' : `${formatBytes(snapshot.sourceBytes)} (${formatNumber(snapshot.sourceBytes)} bytes)`}
              </DetailRow>
              <DetailRow label="Charset">
                {snapshot.sourceCharset ? (
                  <>
                    <span className="uppercase">{snapshot.sourceCharset}</span>
                    {manifest && <span className="text-muted-foreground"> (from {manifest.source.charsetSource})</span>}
                  </>
                ) : (
                  '—'
                )}
              </DetailRow>
              <DetailRow label="SHA-256">
                {snapshot.sourceHash ? (
                  <span className="inline-flex items-start gap-1 font-mono text-xs break-all">
                    {snapshot.sourceHash} <CopyButton value={snapshot.sourceHash} />
                  </span>
                ) : (
                  '—'
                )}
              </DetailRow>
              <DetailRow label="AI model">
                {snapshot.llmModel ? (
                  <>
                    {snapshot.llmModel}
                    {snapshot.llmPromptTokens !== null && (
                      <span className="text-muted-foreground">
                        {' '}
                        · {formatNumber(snapshot.llmPromptTokens)} in / {formatNumber(snapshot.llmCompletionTokens)} out tokens
                      </span>
                    )}
                  </>
                ) : (
                  'Not used'
                )}
              </DetailRow>
            </dl>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Counts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: 'Assets copied', value: formatNumber(snapshot.assetCount) },
                { label: 'Assets skipped', value: formatNumber(snapshot.skippedAssetCount) },
                { label: 'Total size', value: formatBytes(snapshot.totalBytes) },
                { label: 'URLs rewritten in HTML', value: manifest ? formatNumber(manifest.rewrites.index) : '—' },
                { label: 'URLs rewritten in CSS', value: manifest ? formatNumber(manifest.rewrites.css) : '—' },
                { label: 'Left unchanged', value: manifest ? formatNumber(manifest.rewrites.unresolved) : '—' },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="mt-1 font-display text-lg font-semibold tabular-nums">{item.value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Warnings and exceptions</CardTitle>
            <CardDescription>Anything that differs from a byte-for-byte copy is listed here</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {snapshot.warnings.length === 0 && !manifest?.exceptions.length ? (
              <p className="text-sm text-muted-foreground">No warnings.</p>
            ) : (
              <>
                {snapshot.warnings.length > 0 && (
                  <ul className="space-y-2">
                    {snapshot.warnings.map((w) => (
                      <li key={w} className="flex gap-2 text-sm">
                        <Info className="mt-0.5 size-4 shrink-0 text-warning" />
                        <span>
                          {warningText(w)} <span className="font-mono text-xs text-muted-foreground">{w}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {manifest?.exceptions.length ? (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">Exceptions</p>
                    <ul className="divide-y rounded-lg border">
                      {manifest.exceptions.map((e, i) => (
                        <li key={i} className="grid grid-cols-[110px_1fr] gap-3 px-3 py-2 text-xs">
                          <span className="font-mono">{e.file}</span>
                          <span>
                            {humanize(e.kind)}
                            {e.detail && <span className="block truncate font-mono text-muted-foreground">{e.detail}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <GithubDetailsCard snapshot={snapshot} />

        {snapshot.previewBase && (
          <Card>
            <CardHeader>
              <CardTitle>Files</CardTitle>
              <CardDescription>Stored in R2 under this copy; downloads are the exact stored bytes</CardDescription>
            </CardHeader>
            <CardContent className="px-0 py-0">
              <ul className="divide-y border-t">
                {FILES.map((f) => (
                  <li key={f.name} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs">{f.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{f.description}</p>
                    </div>
                    <Button variant="ghost" size="icon-sm" asChild>
                      <a href={siteFileUrl(`${snapshot.previewBase}${f.name}`, true)} aria-label={`Download ${f.name}`}>
                        <Download />
                      </a>
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {manifest && (
          <Card>
            <CardHeader>
              <CardTitle>Limits</CardTitle>
            </CardHeader>
            <CardContent>
              <JsonView value={manifest.limits} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
