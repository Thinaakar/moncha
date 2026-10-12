'use client';

import { ExternalLink, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/app/widgets';

/** Opens the copy's public demo link (sites Pages project). Hidden until the API returns one. */
export function LiveSiteButton({
  url,
  size = 'default',
  variant = 'outline',
}: {
  url: string | null | undefined;
  size?: 'default' | 'sm';
  variant?: 'outline' | 'default' | 'ghost';
}) {
  if (!url) return null;
  return (
    <Button variant={variant} size={size} asChild>
      <a href={url} target="_blank" rel="noreferrer noopener">
        <Radio /> Live site
      </a>
    </Button>
  );
}

/** Compact link plus copy button for tables and detail rows. */
export function LiveSiteLink({ url, full = false }: { url: string | null | undefined; full?: boolean }) {
  if (!url) return <span className="text-muted-foreground">—</span>;
  const label = full ? url.replace(/^https?:\/\//, '') : 'Open';
  return (
    <span className="inline-flex max-w-full items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex min-w-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        <span className={full ? 'break-all' : undefined}>{label}</span>
        <ExternalLink className="size-3 shrink-0" />
      </a>
      <CopyButton value={url} />
    </span>
  );
}
