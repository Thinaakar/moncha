'use client';

import { useMemo, useState } from 'react';
import { Check, Copy, Download, TriangleAlert, WrapText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, InlineAlert } from '@/components/app/states';
import { CopyButton } from '@/components/app/widgets';
import { siteFileUrl, useSiteSource } from '@/lib/queries';
import { formatBytes, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Lines per block; blocks off screen are skipped by the browser (`content-visibility: auto`). */
const CHUNK = 400;
const LINE_HEIGHT_PX = 20;

/**
 * Read-only view of `source.html`, decoded with its own charset. The bytes in storage are never changed;
 * Download returns them exactly as the site served them.
 */
export function SourceViewer({ snapshotId, sourcePath }: { snapshotId: string; sourcePath: string }) {
  const { data, error, isLoading, refetch } = useSiteSource(snapshotId, true);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);

  const chunks = useMemo(() => {
    if (!data) return [];
    const lines = data.text.split(/\r\n|\r|\n/);
    const out: Array<{ start: number; lines: string[] }> = [];
    for (let i = 0; i < lines.length; i += CHUNK) out.push({ start: i, lines: lines.slice(i, i + CHUNK) });
    return out;
  }, [data]);
  const lineCount = chunks.reduce((n, c) => n + c.lines.length, 0);
  const gutter = `${String(lineCount).length + 1}ch`;

  async function copyAll() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-4" style={{ width: `${40 + ((i * 37) % 55)}%` }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-xs sm:flex-row sm:items-center">
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Size</dt>
            <dd className="font-medium tabular-nums">
              {formatBytes(data.bytes)} ({formatNumber(data.bytes)} bytes)
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Charset</dt>
            <dd className="font-medium uppercase">{data.charset}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Lines</dt>
            <dd className="font-medium tabular-nums">{formatNumber(lineCount)}</dd>
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <dt className="text-muted-foreground">SHA-256</dt>
            <dd className="flex min-w-0 items-center gap-0.5 font-mono">
              <span className="truncate" title={data.sha256}>
                {data.sha256.slice(0, 16)}…
              </span>
              <CopyButton value={data.sha256} label="Copy SHA-256" />
            </dd>
          </div>
        </dl>
        <div className="flex gap-2 sm:ml-auto">
          <Button variant={wrap ? 'secondary' : 'outline'} size="sm" onClick={() => setWrap((w) => !w)} aria-pressed={wrap}>
            <WrapText /> Wrap
          </Button>
          <Button variant="outline" size="sm" onClick={copyAll}>
            {copied ? <Check /> : <Copy />} Copy
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={siteFileUrl(sourcePath, true)} download="source.html">
              <Download /> Download
            </a>
          </Button>
        </div>
      </div>

      {data.truncated && (
        <InlineAlert variant="warning" icon={TriangleAlert} title="Showing the first 3 MB">
          The file is larger than the viewer limit. Download it to see every byte.
        </InlineAlert>
      )}

      <div
        className="max-h-[70vh] overflow-auto rounded-lg border bg-[#fbfcfe] font-mono text-[12.5px] text-foreground/90 scrollbar-thin dark:bg-muted/30"
        role="region"
        aria-label="Page source"
      >
        <div className={cn('min-w-fit py-2', wrap && 'min-w-0')}>
          {chunks.map((chunk) => (
            <div
              key={chunk.start}
              style={{
                counterReset: `line ${chunk.start}`,
                contentVisibility: 'auto',
                containIntrinsicSize: `auto ${chunk.lines.length * LINE_HEIGHT_PX}px`,
              }}
            >
              {chunk.lines.map((line, i) => (
                <div
                  key={i}
                  className={cn(
                    'relative pr-4 leading-5 hover:bg-primary/5',
                    'before:absolute before:left-0 before:w-(--gutter) before:pr-3 before:text-right before:text-muted-foreground/60 before:content-[counter(line)] before:select-none',
                    wrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre',
                  )}
                  style={{ counterIncrement: 'line', paddingLeft: `calc(${gutter} + 1.25rem)`, ['--gutter' as string]: gutter }}
                >
                  {line || ' '}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
