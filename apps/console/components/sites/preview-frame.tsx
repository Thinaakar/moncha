'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bot, ExternalLink, FileCode2, Monitor, RotateCw, Smartphone, Tablet, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InlineAlert } from '@/components/app/states';
import { Segmented } from '@/components/sites/tabs';
import { siteFileUrl } from '@/lib/queries';
import { useUrlState } from '@/lib/use-url-state';
import type { SiteSnapshotFiles } from '@/lib/types';

type Mode = 'original' | 'demo';
type Device = 'desktop' | 'tablet' | 'mobile';

const DEVICES: Record<Device, { width: number; height: number; label: string }> = {
  desktop: { width: 1440, height: 900, label: 'Desktop' },
  tablet: { width: 820, height: 1180, label: 'Tablet' },
  mobile: { width: 390, height: 844, label: 'Mobile' },
};

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * The copied page runs in a sandboxed iframe with an opaque origin: its scripts run, but they cannot
 * read console cookies or storage, and the proxy CSP blocks every network call and nested frame.
 */
export function PreviewFrame({ files, warnings }: { files: SiteSnapshotFiles; warnings: string[] }) {
  const url = useUrlState();
  const mode: Mode = url.get('view') === 'demo' ? 'demo' : 'original';
  const requestedDevice = url.get('device') as Device;
  const device: Device = Object.hasOwn(DEVICES, requestedDevice) ? requestedDevice : 'desktop';
  const setMode = (value: Mode) => url.set({ view: value === 'original' ? null : value });
  const setDevice = (value: Device) => url.set({ device: value === 'desktop' ? null : value });
  const [reloads, setReloads] = useState(0);
  const [loading, setLoading] = useState(true);
  const [containerRef, containerWidth] = useWidth<HTMLDivElement>();

  // The signed links change when the snapshot is refetched; keep the loaded page until the user acts.
  const latest = useRef(files);
  latest.current = files;
  const current = () => siteFileUrl(mode === 'demo' ? latest.current.demo : latest.current.index);
  const [src, setSrc] = useState(current);
  useEffect(() => {
    setSrc(current());
    setLoading(true);
  }, [mode, reloads]); // eslint-disable-line react-hooks/exhaustive-deps

  const size = DEVICES[device];
  const scale = containerWidth > 0 ? Math.min(1, containerWidth / size.width) : 1;
  const jsRendered = warnings.includes('js_rendered_site');
  const metaCsp = warnings.includes('meta_csp_present');

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Segmented
          label="Preview version"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'original', label: 'Original copy', icon: FileCode2 },
            { value: 'demo', label: 'MonCha demo', icon: Bot },
          ]}
        />
        <Segmented
          label="Device width"
          value={device}
          onChange={setDevice}
          options={[
            { value: 'desktop', label: 'Desktop', icon: Monitor },
            { value: 'tablet', label: 'Tablet', icon: Tablet },
            { value: 'mobile', label: 'Mobile', icon: Smartphone },
          ]}
        />
        <div className="flex items-center gap-2 lg:ml-auto">
          <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
            {size.width}px{scale < 1 ? ` · ${Math.round(scale * 100)}%` : ''}
          </span>
          <Button variant="outline" size="sm" onClick={() => setReloads((n) => n + 1)}>
            <RotateCw /> Reload
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={current()} target="_blank" rel="noreferrer noopener">
              <ExternalLink /> Open in new tab
            </a>
          </Button>
        </div>
      </div>

      {jsRendered && (
        <InlineAlert variant="warning" icon={TriangleAlert} title="JavaScript-rendered site">
          The served HTML contains little content and the page builds itself with scripts that call the live site,
          which the offline copy blocks. The preview may look blank or partial; the screenshots and rendered HTML in
          the other tabs show the real page.
        </InlineAlert>
      )}
      {metaCsp && mode === 'original' && (
        <InlineAlert variant="info" icon={TriangleAlert} title="The page sets its own Content-Security-Policy">
          It is kept unchanged in the original copy and may block some local files. The demo version disables it.
        </InlineAlert>
      )}

      <div ref={containerRef} className="w-full">
        <div
          className="relative mx-auto overflow-hidden rounded-xl border bg-white shadow-sm"
          style={{ width: size.width * scale, height: size.height * scale }}
        >
          {loading && (
            <div className="absolute inset-x-0 top-0 z-10 h-1 overflow-hidden bg-muted">
              <div className="h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
            </div>
          )}
          <iframe
            key={`${src}-${reloads}`}
            title={mode === 'demo' ? 'MonCha demo preview' : 'Offline website copy'}
            src={src}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            onLoad={() => setLoading(false)}
            className="origin-top-left border-0 bg-white"
            style={{ width: size.width, height: size.height, transform: `scale(${scale})` }}
          />
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Offline copy: the page cannot reach the internet, so maps, videos, forms and live widgets stay empty.
      </p>
    </div>
  );
}
