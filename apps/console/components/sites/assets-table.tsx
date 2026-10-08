'use client';

import { useMemo, useState } from 'react';
import { Ban, Download, ExternalLink, FileBox, FileCode2, FileImage, FileType2, Package, SearchX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/app/states';
import { SearchInput } from '@/components/app/widgets';
import { Segmented } from '@/components/sites/tabs';
import { skipReasonText } from '@/components/sites/labels';
import { siteFileUrl } from '@/lib/queries';
import { formatBytes, formatNumber } from '@/lib/format';
import type { SiteAssetKind, SiteManifest, SiteManifestAsset } from '@/lib/types';

type Filter = 'all' | 'image' | 'css' | 'js' | 'font' | 'other';

const FILTER_KINDS: Record<Exclude<Filter, 'all' | 'other'>, SiteAssetKind[]> = {
  image: ['image', 'icon'],
  css: ['css'],
  js: ['js'],
  font: ['font'],
};

function matches(asset: SiteManifestAsset, filter: Filter) {
  if (filter === 'all') return true;
  if (filter === 'other') return !Object.values(FILTER_KINDS).some((kinds) => kinds.includes(asset.kind));
  return FILTER_KINDS[filter].includes(asset.kind);
}

const KIND_ICON: Partial<Record<SiteAssetKind, React.ComponentType<{ className?: string }>>> = {
  image: FileImage,
  icon: FileImage,
  css: FileCode2,
  js: FileCode2,
  font: FileType2,
};

function shortUrl(url: string) {
  return url.replace(/^https?:\/\//, '');
}

export function AssetsTable({ manifest, previewBase }: { manifest: SiteManifest | null; previewBase: string | null }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'stored' | 'skipped'>('stored');

  const assets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (manifest?.assets ?? []).filter(
      (a) => matches(a, filter) && (!q || a.url.toLowerCase().includes(q) || a.storedPath.toLowerCase().includes(q)),
    );
  }, [manifest, filter, search]);
  const skipped = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (manifest?.skipped ?? []).filter((s) => !q || s.url.toLowerCase().includes(q));
  }, [manifest, search]);

  if (!manifest || !previewBase) {
    return <EmptyState icon={Package} title="No assets yet" description="The asset list is available when the copy finishes." />;
  }

  const counts = (f: Filter) => manifest.assets.filter((a) => matches(a, f)).length;
  const totalBytes = manifest.assets.reduce((n, a) => n + a.bytes, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Segmented
          label="Asset list"
          value={view}
          onChange={setView}
          options={[
            { value: 'stored', label: `Copied (${formatNumber(manifest.assets.length)})`, icon: FileBox },
            { value: 'skipped', label: `Skipped (${formatNumber(manifest.skipped.length)})`, icon: Ban },
          ]}
        />
        {view === 'stored' && (
          <Segmented
            label="Asset type"
            value={filter}
            onChange={setFilter}
            options={(['all', 'image', 'css', 'js', 'font', 'other'] as const).map((f) => ({
              value: f,
              label: `${f === 'all' ? 'All' : f === 'css' ? 'CSS' : f === 'js' ? 'JS' : f[0]!.toUpperCase() + f.slice(1)} ${counts(f)}`,
            }))}
          />
        )}
        <SearchInput value={search} onChange={setSearch} placeholder="Filter by URL…" className="lg:ml-auto lg:w-72" />
      </div>

      {view === 'stored' ? (
        assets.length === 0 ? (
          <EmptyState icon={SearchX} title="No assets match" description="Try another type or search term." />
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-16">Preview</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead>Found in</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.map((asset) => {
                  const href = siteFileUrl(`${previewBase}${asset.storedPath}`);
                  const Icon = KIND_ICON[asset.kind] ?? FileBox;
                  return (
                    <TableRow key={asset.id}>
                      <TableCell>
                        <div className="flex size-10 items-center justify-center overflow-hidden rounded-md border bg-[repeating-conic-gradient(#f1f4f9_0%_25%,#fff_0%_50%)] bg-[length:10px_10px]">
                          {asset.kind === 'image' || asset.kind === 'icon' ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={href} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
                          ) : (
                            <Icon className="size-4 text-muted-foreground" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[420px]">
                        <p className="truncate font-mono text-xs" title={asset.storedPath}>
                          {asset.storedPath}
                        </p>
                        <a
                          href={asset.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground hover:text-primary"
                          title={asset.url}
                        >
                          <span className="truncate">{shortUrl(asset.url)}</span>
                          <ExternalLink className="size-3 shrink-0 opacity-60" />
                        </a>
                      </TableCell>
                      <TableCell>
                        <Badge variant="muted">{asset.kind}</Badge>
                        <p className="mt-1 max-w-40 truncate text-[11px] text-muted-foreground">{asset.contentType}</p>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{formatBytes(asset.bytes)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{asset.discoveredBy.join(', ')}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon-sm" asChild>
                          <a href={siteFileUrl(`${previewBase}${asset.storedPath}`, true)} aria-label="Download file">
                            <Download />
                          </a>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="border-t bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
              {formatNumber(assets.length)} of {formatNumber(manifest.assets.length)} files · {formatBytes(totalBytes)} copied in total
            </div>
          </div>
        )
      ) : skipped.length === 0 ? (
        <EmptyState icon={Ban} title="Nothing skipped" description="Every asset the page referenced was copied." />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>URL</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {skipped.map((s, i) => (
                <TableRow key={`${s.url}-${i}`}>
                  <TableCell className="max-w-[520px]">
                    <p className="truncate font-mono text-xs" title={s.url}>
                      {shortUrl(s.url)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.reason === 'tracking' ? 'muted' : 'warning'}>{skipReasonText(s.reason)}</Badge>
                  </TableCell>
                  <TableCell className="max-w-60 truncate text-xs text-muted-foreground">{s.detail ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
