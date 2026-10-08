import { createHash } from 'node:crypto';
import path from 'node:path';
import type { SiteAssetKind } from '@moncha/domain';

const EXT_BY_TYPE: Record<string, string> = {
  'text/css': 'css',
  'text/javascript': 'js',
  'application/javascript': 'js',
  'application/x-javascript': 'js',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'application/font-woff': 'woff',
  'application/font-woff2': 'woff2',
  'application/vnd.ms-fontobject': 'eot',
  'application/manifest+json': 'webmanifest',
  'application/json': 'json',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
};

const TYPE_BY_EXT: Record<string, string> = {
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  webmanifest: 'application/manifest+json',
  json: 'application/json',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
};

const sha = (value: string, len: number) => createHash('sha256').update(value).digest('hex').slice(0, len);

export function baseContentType(contentType: string | null | undefined): string {
  return (contentType ?? '').split(';')[0]!.trim().toLowerCase();
}

export function extensionFor(contentType: string | null | undefined): string | undefined {
  return EXT_BY_TYPE[baseContentType(contentType)];
}

/** Best content type for a stored file: the server's, else guessed from the extension. */
export function contentTypeFor(storedPath: string, served?: string | null): string {
  const base = baseContentType(served);
  if (base && base !== 'application/octet-stream' && base !== 'binary/octet-stream') return served!.trim();
  const ext = path.posix.extname(storedPath).slice(1).toLowerCase();
  return TYPE_BY_EXT[ext] ?? (base || 'application/octet-stream');
}

function sanitizeSegment(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // keep raw
  }
  const clean = decoded.replace(/[^A-Za-z0-9._-]/g, '_');
  if (!clean || clean === '.' || clean === '..') return '_';
  return clean;
}

/**
 * Storage path (relative to the snapshot root) for an asset URL:
 * `assets/{host}/{path}`, with `~{hash}` before the extension when the URL has a query string.
 */
export function assetStoragePath(rawUrl: string, contentType?: string | null): string {
  const url = new URL(rawUrl);
  const host = sanitizeSegment(url.port ? `${url.hostname}_${url.port}` : url.hostname).toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean).map(sanitizeSegment);
  if (!segments.length || url.pathname.endsWith('/')) segments.push('index');

  let file = segments.pop()!;
  let ext = path.posix.extname(file).slice(1).toLowerCase();
  let stem = ext ? file.slice(0, -(ext.length + 1)) : file;
  if (!ext || ext.length > 8) {
    const guessed = extensionFor(contentType);
    if (guessed) {
      stem = file;
      ext = guessed;
    }
  }
  if (url.search) stem = `${stem}~${sha(url.search, 8)}`;
  file = ext ? `${stem}.${ext}` : stem;

  const full = ['assets', host, ...segments, file].join('/');
  if (full.length <= 240 && ![...segments, file].some((s) => s.length > 100)) return full;
  return `assets/${host}/_long/${sha(rawUrl, 16)}${ext ? `.${ext}` : ''}`;
}

/** Path from one stored file to another, both relative to the snapshot root. */
export function relativeStoredPath(fromFile: string, toFile: string): string {
  const rel = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return rel || path.posix.basename(toFile);
}

export function classifyAsset(url: string, contentType: string | null | undefined, hint?: SiteAssetKind): SiteAssetKind {
  const type = baseContentType(contentType);
  const ext = path.posix.extname(new URL(url).pathname).slice(1).toLowerCase();
  if (hint === 'icon') return 'icon';
  if (hint === 'manifest' || type === 'application/manifest+json' || ext === 'webmanifest') return 'manifest';
  if (type === 'text/css' || ext === 'css') return 'css';
  if (type.includes('javascript') || ext === 'js' || ext === 'mjs') return 'js';
  if (type.startsWith('font/') || type.includes('font') || ['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) return 'font';
  if (type === 'image/x-icon' || type === 'image/vnd.microsoft.icon' || ext === 'ico') return 'icon';
  if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp'].includes(ext)) return 'image';
  if (type.startsWith('video/') || type.startsWith('audio/') || ['mp4', 'webm', 'mp3', 'ogg'].includes(ext)) return 'media';
  return hint ?? 'other';
}
