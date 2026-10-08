import type { SiteManifestException } from '@moncha/domain';
import { decodeText, fromLatin1, isAsciiCompatible, toLatin1 } from './charset';
import { findCssUrls } from './css-urls';
import { scanHtml, type HtmlUrlRef } from './html-urls';
import { isInlineOrNonFetchable } from './skip-rules';

export type Replacement = { start: number; end: number; text: string };

/** Applies sorted, non-overlapping replacements to a string. */
export function splice(text: string, replacements: Replacement[]): string {
  const sorted = [...replacements].sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const r of sorted) {
    if (r.start < cursor) continue;
    out += text.slice(cursor, r.start) + r.text;
    cursor = r.end;
  }
  return out + text.slice(cursor);
}

/**
 * Turns a latin1-form value (one char per byte, plus any chars above U+00FF that came from
 * entity decoding) into real text using the document charset.
 */
export function latin1ValueToText(value: string, charset: string): string {
  if (!/[\x80-\xff]/.test(value)) return value;
  let out = '';
  let run = '';
  for (const ch of value) {
    if (ch.charCodeAt(0) <= 0xff && ch.length === 1) {
      run += ch;
      continue;
    }
    if (run) out += decodeText(Buffer.from(run, 'latin1'), charset);
    run = '';
    out += ch;
  }
  if (run) out += decodeText(Buffer.from(run, 'latin1'), charset);
  return out;
}

export function resolveUrl(raw: string, baseUrl: string): string | null {
  if (isInlineOrNonFetchable(raw)) return null;
  try {
    const url = new URL(raw.trim(), baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/** `#fragment` of a raw URL (SVG sprites, `font.svg#id`), encoded so it is safe in any quoting context. */
export function fragmentOf(raw: string): string {
  const at = raw.indexOf('#');
  if (at < 0) return '';
  return `#${raw.slice(at + 1).replace(/['"()\s<>\\]/g, (ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, '0')}`)}`;
}

/** Maps an absolute URL to a relative path from the file being rewritten, or null to keep the original. */
export type UrlResolver = (absoluteUrl: string, ref: { hint?: HtmlUrlRef['hint']; tag?: string }) => string | null;

export type HtmlRewriteResult = {
  bytes: Uint8Array;
  count: number;
  unresolved: string[];
  exceptions: SiteManifestException[];
};

/** Absolute URLs referenced by a document, resolved against its `<base href>` when present. */
export function collectHtmlUrls(
  sourceBytes: Uint8Array,
  charset: string,
  pageUrl: string,
): {
  urls: { url: string; hint?: HtmlUrlRef['hint']; tag: string }[];
  iframes: string[];
  ignored: { value: string; reason: 'blob' | 'unsupported' }[];
  baseUrl: string;
} {
  if (!isAsciiCompatible(charset)) return { urls: [], iframes: [], ignored: [], baseUrl: pageUrl };
  const scan = scanHtml(toLatin1(sourceBytes));
  const baseUrl = scan.base ? (resolveUrl(latin1ValueToText(scan.base.raw, charset), pageUrl) ?? pageUrl) : pageUrl;
  const seen = new Set<string>();
  const urls: { url: string; hint?: HtmlUrlRef['hint']; tag: string }[] = [];
  const ignored: { value: string; reason: 'blob' | 'unsupported' }[] = [];
  for (const ref of scan.refs) {
    const text = latin1ValueToText(ref.raw, charset);
    const kind = isInlineOrNonFetchable(text);
    if (kind === 'blob' || kind === 'unsupported') {
      if (text.trim()) ignored.push({ value: text.trim().slice(0, 200), reason: kind });
      continue;
    }
    const abs = resolveUrl(text, baseUrl);
    if (!abs || seen.has(abs)) continue;
    seen.add(abs);
    urls.push({ url: abs, hint: ref.hint, tag: ref.tag });
  }
  const iframes = scan.iframes
    .map((raw) => resolveUrl(latin1ValueToText(raw, charset), baseUrl))
    .filter((u): u is string => !!u);
  return { urls, iframes, ignored, baseUrl };
}

/**
 * Rewrites only asset URL spans of the original bytes. Every other byte (whitespace, comments,
 * inline scripts, attribute order, line endings) is preserved exactly.
 */
export function rewriteHtml(
  sourceBytes: Uint8Array,
  charset: string,
  pageUrl: string,
  resolve: UrlResolver,
): HtmlRewriteResult {
  if (!isAsciiCompatible(charset)) {
    return {
      bytes: sourceBytes,
      count: 0,
      unresolved: [],
      exceptions: [{ file: 'index.html', kind: 'rewrite_skipped_utf16', detail: charset }],
    };
  }

  const html = toLatin1(sourceBytes);
  const scan = scanHtml(html);
  const exceptions: SiteManifestException[] = [];
  const replacements: Replacement[] = [];
  const unresolved: string[] = [];

  let baseUrl = pageUrl;
  if (scan.base) {
    baseUrl = resolveUrl(latin1ValueToText(scan.base.raw, charset), pageUrl) ?? pageUrl;
    replacements.push({ start: scan.base.start, end: scan.base.end, text: './' });
    exceptions.push({ file: 'index.html', kind: 'base_href_neutralized', detail: scan.base.raw });
  }

  for (const ref of scan.refs) {
    const text = latin1ValueToText(ref.raw, charset);
    const abs = resolveUrl(text, baseUrl);
    if (!abs) continue;
    const rel = resolve(abs, { hint: ref.hint, tag: ref.tag });
    if (rel === null) {
      unresolved.push(abs);
      continue;
    }
    replacements.push({ start: ref.start, end: ref.end, text: rel + fragmentOf(text) });
  }

  const out = splice(html, replacements);
  return {
    bytes: fromLatin1(out),
    count: replacements.length - (scan.base ? 1 : 0),
    unresolved: [...new Set(unresolved)],
    exceptions,
  };
}

/** Absolute URLs referenced by a stylesheet. */
export function collectCssUrls(bytes: Uint8Array, cssUrl: string): { url: string; kind: 'url' | 'import' }[] {
  const seen = new Set<string>();
  const out: { url: string; kind: 'url' | 'import' }[] = [];
  for (const ref of findCssUrls(toLatin1(bytes))) {
    const abs = resolveUrl(latin1ValueToText(ref.url, 'utf-8'), cssUrl);
    if (!abs || seen.has(abs)) continue;
    seen.add(abs);
    out.push({ url: abs, kind: ref.kind });
  }
  return out;
}

/** Rewrites url() and @import targets of a stylesheet; paths are relative to the stylesheet's stored location. */
export function rewriteCss(
  bytes: Uint8Array,
  cssUrl: string,
  resolve: UrlResolver,
): { bytes: Uint8Array; count: number; unresolved: string[] } {
  const css = toLatin1(bytes);
  const replacements: Replacement[] = [];
  const unresolved: string[] = [];
  for (const ref of findCssUrls(css)) {
    const text = latin1ValueToText(ref.url, 'utf-8');
    const abs = resolveUrl(text, cssUrl);
    if (!abs) continue;
    const rel = resolve(abs, { hint: ref.kind === 'import' ? 'css' : undefined });
    if (rel === null) {
      unresolved.push(abs);
      continue;
    }
    replacements.push({ start: ref.start, end: ref.end, text: rel + fragmentOf(text) });
  }
  if (!replacements.length) return { bytes, count: 0, unresolved: [...new Set(unresolved)] };
  return { bytes: fromLatin1(splice(css, replacements)), count: replacements.length, unresolved: [...new Set(unresolved)] };
}
