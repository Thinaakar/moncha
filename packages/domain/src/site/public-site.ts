/**
 * Public demo links: `{base}/sites/{domain}/{copyId}/demo.html`. The sites Pages project serves them straight
 * from the copy's R2 files, so a link works as soon as the copy is done. Kept free of imports so the Pages
 * Function can bundle this file on its own.
 */
export const PUBLIC_SITE_ENTRY = 'demo.html';

const DOMAIN = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;
const COPY_ID = /^[a-z0-9]{20,40}$/;
const MAX_FILE_PATH = 512;

export function publicSiteUrl(base: string, domain: string, copyId: string, file: string = PUBLIC_SITE_ENTRY): string {
  return `${base.replace(/\/+$/, '')}/sites/${encodeURIComponent(domain)}/${encodeURIComponent(copyId)}/${file}`;
}

export type PublicSitePath = {
  domain: string;
  copyId: string;
  /** Path inside the copy; null for the copy root (`/sites/{domain}/{copyId}/`). */
  file: string | null;
};

/** Parses the part of a URL path after `/sites/`. Null for anything that is not a file inside one copy. */
export function parsePublicSitePath(rest: string): PublicSitePath | null {
  const segments = rest.split('/');
  if (segments.length < 2) return null;
  const domain = decodeSegment(segments[0]!)?.toLowerCase();
  const copyId = decodeSegment(segments[1]!);
  if (!domain || !DOMAIN.test(domain) || !copyId || !COPY_ID.test(copyId)) return null;

  const fileSegments = segments.slice(2);
  if (fileSegments.length === 0 || (fileSegments.length === 1 && fileSegments[0] === '')) {
    return { domain, copyId, file: null };
  }
  const decoded: string[] = [];
  for (const raw of fileSegments) {
    const part = decodeSegment(raw);
    if (part === null || part === '' || part === '.' || part === '..') return null;
    if (part.includes('/') || part.includes('\\') || part.includes('\0')) return null;
    decoded.push(part);
  }
  const file = decoded.join('/');
  return file.length > MAX_FILE_PATH ? null : { domain, copyId, file };
}

function decodeSegment(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
