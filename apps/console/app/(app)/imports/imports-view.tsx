'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileUp, History, Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState, ErrorState, InlineAlert, TableSkeleton } from '@/components/app/states';
import { JobStatusBadge } from '@/components/app/status';
import { useCanEdit } from '@/components/app/user-context';
import { api, errorMessage } from '@/lib/api';
import { useApiMutation, useJobs, useSourceImport } from '@/lib/queries';
import { useUrlState } from '@/lib/use-url-state';
import { analyzeCsv, CSV_COLUMNS, CSV_INLINE_MAX_ROWS, CSV_MAX_BYTES, CSV_MAX_ROWS, CSV_TEMPLATE, type CsvAnalysis } from '@/lib/csv';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import type { CsvImportResult, StartedImport } from '@/lib/types';
import { cn } from '@/lib/utils';

const RESULT_STATS: Array<{ key: keyof CsvImportResult; label: string; tone?: string }> = [
  { key: 'found', label: 'Rows read' },
  { key: 'created', label: 'New leads', tone: 'text-success' },
  { key: 'duplicates', label: 'Already known' },
  { key: 'auditsEnqueued', label: 'Audits queued', tone: 'text-info' },
  { key: 'skipped', label: 'Skipped' },
  { key: 'noWebsite', label: 'No website' },
];

function ResultGrid({ result }: { result: Partial<CsvImportResult> }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {RESULT_STATS.map((s) => (
        <div key={s.key} className="rounded-lg border bg-muted/30 px-3 py-2.5">
          <p className="text-xs text-muted-foreground">{s.label}</p>
          <p className={cn('font-display text-xl font-semibold tabular-nums', s.tone)}>{formatNumber(result[s.key] ?? 0)}</p>
        </div>
      ))}
    </div>
  );
}

function ImportStatus({ id, onDismiss }: { id: string; onDismiss: () => void }) {
  const client = useQueryClient();
  const { data, error } = useSourceImport(id);
  const done = data?.status === 'done' || data?.status === 'failed';
  useEffect(() => {
    if (done) {
      void client.invalidateQueries({ queryKey: ['leads'] });
      void client.invalidateQueries({ queryKey: ['jobs'] });
    }
  }, [done, client]);

  return (
    <Card className="mb-6">
      <CardHeader className="flex-row items-start justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            {data?.status === 'done' ? (
              <CheckCircle2 className="size-4 text-success" />
            ) : data?.status === 'failed' ? (
              <AlertTriangle className="size-4 text-destructive" />
            ) : (
              <Loader2 className="size-4 animate-spin text-primary" />
            )}
            {data?.status === 'done' ? 'Import complete' : data?.status === 'failed' ? 'Import failed' : 'Importing…'}
          </CardTitle>
          <CardDescription>
            {data?.rows ? `${formatNumber(data.rows)} rows · ` : ''}
            {data?.mode === 'queued' ? 'Large file — processed by the background worker' : 'Processed immediately'}
          </CardDescription>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onDismiss} aria-label="Dismiss">
          <X />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{errorMessage(error)}</p>}
        {data?.error && data.status === 'failed' && (
          <InlineAlert variant="destructive" icon={AlertTriangle}>
            {data.error}
          </InlineAlert>
        )}
        {data?.result ? (
          <ResultGrid result={data.result} />
        ) : (
          !done && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
            </div>
          )
        )}
        {data?.status === 'done' && (
          <div className="flex gap-2">
            <Button size="sm" asChild>
              <Link href="/leads?queue=PENDING_AUDIT">View new leads</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Preview({ analysis }: { analysis: CsvAnalysis }) {
  const cols = CSV_COLUMNS.filter((c) => analysis.mapping[c.key] >= 0);
  const rows = analysis.rows.slice(0, 5);
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {cols.map((c) => (
              <TableHead key={c.key}>
                {c.label}
                <span className="ml-1.5 font-mono text-[10px] font-normal tracking-normal text-muted-foreground/70 normal-case">
                  {analysis.header[analysis.mapping[c.key]]}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {cols.map((c) => (
                <TableCell key={c.key} className="max-w-[220px] truncate">
                  {row[analysis.mapping[c.key]] || <span className="text-muted-foreground/60">—</span>}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {analysis.rows.length > rows.length && (
        <p className="border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          + {formatNumber(analysis.rows.length - rows.length)} more rows
        </p>
      )}
    </div>
  );
}

function RecentImports() {
  const jobs = useJobs({ page: 1, pageSize: 10, type: 'csv_import' });
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <History className="size-4 text-primary" /> Recent imports
        </CardTitle>
      </CardHeader>
      {jobs.error ? (
        <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} />
      ) : jobs.isLoading ? (
        <TableSkeleton rows={3} columns={5} />
      ) : !jobs.data?.items.length ? (
        <EmptyState icon={FileSpreadsheet} title="No imports yet" description="Uploaded files will be listed here." className="py-10" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Started</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead className="text-right">Rows</TableHead>
              <TableHead className="text-right">New leads</TableHead>
              <TableHead className="text-right">Duplicates</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.data.items.map((job) => {
              const result = (job.result ?? {}) as Partial<CsvImportResult>;
              const payload = (job.payload ?? {}) as { rows?: number; mode?: string };
              return (
                <TableRow key={job.id}>
                  <TableCell>
                    <div className="font-medium">{formatRelative(job.createdAt)}</div>
                    <div className="text-xs text-muted-foreground">{formatDateTime(job.createdAt)}</div>
                  </TableCell>
                  <TableCell>
                    <JobStatusBadge status={job.status} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="muted">{payload.mode === 'queued' ? 'Background' : 'Instant'}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(payload.rows ?? result.found)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatNumber(result.created)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(result.duplicates)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

export function ImportsView() {
  const url = useUrlState();
  const canEdit = useCanEdit();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; size: number; text: string } | null>(null);
  const [analysis, setAnalysis] = useState<CsvAnalysis | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const importId = url.get('import') || null;

  const upload = useApiMutation(
    (csv: string) => api<StartedImport>('source-imports', { method: 'POST', body: { source: 'csv', csv } }),
    [['jobs'], ['leads']],
  );

  const readFile = useCallback(async (f: File) => {
    setFileError(null);
    if (!/\.csv$/i.test(f.name) && f.type !== 'text/csv') {
      setFileError('Choose a .csv file');
      return;
    }
    if (f.size > CSV_MAX_BYTES) {
      setFileError('File is larger than 9.5 MB. Split it into smaller files.');
      return;
    }
    const text = await f.text();
    const result = analyzeCsv(text);
    if (result.rows.length > CSV_MAX_ROWS) {
      setFileError(`File has ${formatNumber(result.rows.length)} rows; the limit is ${formatNumber(CSV_MAX_ROWS)}.`);
      return;
    }
    setFile({ name: f.name, size: f.size, text });
    setAnalysis(result);
  }, []);

  function clear() {
    setFile(null);
    setAnalysis(null);
    setFileError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function submit() {
    if (!file) return;
    try {
      const started = await upload.mutateAsync(file.text);
      url.set({ import: started.id });
      toast.success(started.mode === 'queued' ? 'Import queued for the worker' : 'Import complete', {
        description: `${formatNumber(started.rows)} rows from ${file.name}`,
      });
      clear();
    } catch (err) {
      toast.error('Import failed', { description: errorMessage(err) });
    }
  }

  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = 'moncha-leads-template.csv';
    a.click();
    URL.revokeObjectURL(href);
  }

  const blocked = Boolean(analysis && (analysis.missingRequired.length > 0 || analysis.importable === 0));

  return (
    <div>
      <PageHeader
        title="CSV import"
        description="Bring your own list of businesses. Rows are matched on their website domain, so re-importing the same file never creates duplicates."
        actions={
          <Button variant="outline" onClick={downloadTemplate}>
            <Download /> Template
          </Button>
        }
      />

      {importId && <ImportStatus id={importId} onDismiss={() => url.set({ import: null })} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Upload a file</CardTitle>
            <CardDescription>
              Up to {formatNumber(CSV_MAX_ROWS)} rows. Files over {formatNumber(CSV_INLINE_MAX_ROWS)} rows are processed in the background.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!file ? (
              <div
                role="button"
                tabIndex={0}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const f = e.dataTransfer.files[0];
                  if (f) void readFile(f);
                }}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  dragging ? 'border-primary bg-primary/[0.04]' : 'hover:border-primary/40 hover:bg-muted/30',
                )}
              >
                <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Upload className="size-5" />
                </div>
                <p className="font-medium">Drop your CSV here, or click to browse</p>
                <p className="mt-1 text-sm text-muted-foreground">Needs a header row with a name column and a website column</p>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void readFile(f);
                  }}
                />
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                <span className="flex size-10 items-center justify-center rounded-lg bg-success/12 text-success">
                  <FileSpreadsheet className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB · {formatNumber(analysis?.rows.length ?? 0)} rows
                  </p>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={clear} aria-label="Remove file">
                  <X />
                </Button>
              </div>
            )}

            {fileError && (
              <InlineAlert variant="destructive" icon={AlertTriangle}>
                {fileError}
              </InlineAlert>
            )}

            {analysis && (
              <>
                {analysis.missingRequired.length > 0 ? (
                  <InlineAlert variant="destructive" icon={AlertTriangle} title="Missing required columns">
                    Add a {analysis.missingRequired.join(' and ')} column. Accepted headers: <code>name</code> / <code>company</code> and{' '}
                    <code>website</code> / <code>domain</code> / <code>url</code>.
                  </InlineAlert>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border px-3 py-2.5">
                      <p className="text-xs text-muted-foreground">Ready to import</p>
                      <p className="font-display text-xl font-semibold text-success tabular-nums">{formatNumber(analysis.importable)}</p>
                    </div>
                    <div className="rounded-lg border px-3 py-2.5">
                      <p className="text-xs text-muted-foreground">Missing website</p>
                      <p className="font-display text-xl font-semibold tabular-nums">{formatNumber(analysis.missingWebsite)}</p>
                    </div>
                    <div className="rounded-lg border px-3 py-2.5">
                      <p className="text-xs text-muted-foreground">Processing</p>
                      <p className="font-display text-xl font-semibold">
                        {analysis.rows.length > CSV_INLINE_MAX_ROWS ? 'Background' : 'Instant'}
                      </p>
                    </div>
                  </div>
                )}
                {analysis.rows.length > 0 && analysis.missingRequired.length === 0 && <Preview analysis={analysis} />}
              </>
            )}
          </CardContent>
          <CardFooter className="justify-end gap-2 bg-muted/30">
            {file && (
              <Button variant="ghost" onClick={clear}>
                Cancel
              </Button>
            )}
            <Button onClick={submit} disabled={!file || blocked || !canEdit} loading={upload.isPending}>
              {!upload.isPending && <FileUp />} Import {analysis && !blocked ? formatNumber(analysis.importable) : ''} rows
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>File format</CardTitle>
            <CardDescription>Headers are case-insensitive</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {CSV_COLUMNS.map((c) => (
              <div key={c.key} className="flex items-start justify-between gap-3 rounded-lg px-1 py-1.5 text-sm">
                <div>
                  <p className="font-medium">
                    {c.label} {c.required && <span className="text-destructive">*</span>}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">{c.aliases.join(' · ')}</p>
                </div>
                {c.required ? <Badge variant="warning">Required</Badge> : <Badge variant="muted">Optional</Badge>}
              </div>
            ))}
            <p className="pt-2 text-xs text-muted-foreground">Rows without a name or website are skipped.</p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <RecentImports />
      </div>
    </div>
  );
}
