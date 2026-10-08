import { createHash } from 'node:crypto';
import type { BrowserContext, Page, Response as PwResponse } from 'playwright';
import {
  SiteCaptureError,
  type SiteAssetKind,
  type SiteAssetSource,
  type SiteCaptureErrorCode,
  type SiteCaptureResult,
  type SiteCapturedFile,
  type SiteCapturer,
  type SiteEvidence,
  type SiteManifestAsset,
  type SiteManifestException,
  type SiteManifestSkipped,
  type SiteSkipReason,
} from '@moncha/domain';
import { getRenderBrowser, looksBlocked } from '../render-pass';
import { checkRobotsAllowed } from '../robots';
import { assertSafeUrl, isBlockedNavigationUrl } from '../url-safety';
import { assetStoragePath, classifyAsset, contentTypeFor, relativeStoredPath } from './asset-paths';
import { detectCharset, toLatin1 } from './charset';
import { collectPageEvidence, NAME_SHIM, sourceTextLength } from './evidence';
import { collectCssUrls, collectHtmlUrls, rewriteCss, rewriteHtml, type UrlResolver } from './rewriter';
import { safeFetch, SafeFetchError, type SafeFetchResult } from './safe-fetch';
import { isTrackingUrl } from './skip-rules';

export { MONCHA_WIDGET_JS } from './moncha-widget.js';
export { assetStoragePath, relativeStoredPath } from './asset-paths';
export { detectCharset, decodeText } from './charset';
export { rewriteHtml, rewriteCss, collectHtmlUrls } from './rewriter';
export { isTrackingUrl } from './skip-rules';
export { safeFetch, SafeFetchError, SITE_USER_AGENT } from './safe-fetch';

export type SiteCaptureLimits = { maxAssets: number; maxFileBytes: number; maxTotalBytes: number };

export const DEFAULT_SITE_LIMITS: SiteCaptureLimits = {
  maxAssets: 400,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 80 * 1024 * 1024,
};

export type MonchaSiteCapturerOptions = {
  limits?: Partial<SiteCaptureLimits>;
  /** Robots.txt is honored unless explicitly disabled (tests). */
  checkRobots?: boolean;
  navTimeoutMs?: number;
};

const SOURCE_MAX_BYTES = 5 * 1024 * 1024;
const SOURCE_TIMEOUT_MS = 20_000;
const ASSET_TIMEOUT_MS = 15_000;
const ASSET_HOST_INTERVAL_MS = 250;
const FETCH_CONCURRENCY = 6;
const CSS_MAX_DEPTH = 3;
const MAX_SCREENSHOT_PX = 8_000;

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 MonChaLeadEngine/1.0 (+site-snapshot)';
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1 MonChaLeadEngine/1.0 (+site-snapshot)';

const CAPTURE_RESOURCE_TYPES = new Set(['stylesheet', 'script', 'image', 'font', 'media', 'manifest', 'texttrack', 'other']);

type Captured = {
  url: string;
  bytes: Uint8Array;
  contentType: string | null;
  sources: Set<SiteAssetSource>;
  hint?: SiteAssetKind;
};

type Viewport = { width: number; height: number; scale: number };
const DESKTOP: Viewport = { width: 1440, height: 900, scale: 1 };
const MOBILE: Viewport = { width: 390, height: 844, scale: 2 };

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

function hintForResourceType(type: string): SiteAssetKind | undefined {
  switch (type) {
    case 'stylesheet':
      return 'css';
    case 'script':
      return 'js';
    case 'image':
      return 'image';
    case 'font':
      return 'font';
    case 'media':
    case 'texttrack':
      return 'media';
    case 'manifest':
      return 'manifest';
    default:
      return undefined;
  }
}

function looksLikeHtml(contentType: string | null, bytes: Uint8Array): boolean {
  const type = (contentType ?? '').toLowerCase();
  if (type.includes('html') || type.includes('xhtml')) return true;
  if (type && !type.startsWith('text/plain') && !type.includes('octet-stream')) return false;
  const head = toLatin1(bytes.subarray(0, 512)).replace(/^\uFEFF|^\xEF\xBB\xBF/, '').trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<');
}

function fetchErrorCode(error: unknown): SiteCaptureErrorCode {
  if (!(error instanceof SafeFetchError)) return 'fetch_failed';
  switch (error.code) {
    case 'blocked_host':
      return 'blocked_host';
    case 'too_many_redirects':
      return 'too_many_redirects';
    case 'too_large':
      return 'source_too_large';
    case 'timeout':
      return 'timeout';
    default:
      return 'fetch_failed';
  }
}

function skipReasonFor(error: unknown): SiteSkipReason {
  if (!(error instanceof SafeFetchError)) return 'fetch_error';
  if (error.code === 'blocked_host') return 'blocked_host';
  if (error.code === 'too_large') return 'too_large';
  if (error.code === 'timeout') return 'timeout';
  return 'fetch_error';
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/** Scrolls to the bottom in steps so lazy-loaded images and sections request their assets. */
async function scrollThrough(page: Page): Promise<void> {
  await page.evaluate(NAME_SHIM).catch(() => undefined);
  await page
    .evaluate(async () => {
      const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const height = Math.min(
        Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0),
        30_000,
      );
      const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
      for (let y = 0; y < height; y += step) {
        window.scrollTo(0, y);
        await delay(150);
      }
      window.scrollTo(0, 0);
    })
    .catch(() => undefined);
}

async function captureScreens(page: Page, viewport: Viewport): Promise<{ full?: Uint8Array; first?: Uint8Array }> {
  const out: { full?: Uint8Array; first?: Uint8Array } = {};
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  const height = await page
    .evaluate(() => Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0))
    .catch(() => viewport.height);
  const maxCss = Math.floor(MAX_SCREENSHOT_PX / viewport.scale);
  try {
    out.full = await page.screenshot({
      type: 'png',
      fullPage: true,
      ...(height > maxCss ? { clip: { x: 0, y: 0, width: viewport.width, height: maxCss } } : {}),
      timeout: 30_000,
    });
  } catch {
    // best effort
  }
  try {
    out.first = await page.screenshot({ type: 'jpeg', quality: 70, timeout: 15_000 });
  } catch {
    // best effort
  }
  return out;
}

export class MonchaSiteCapturer implements SiteCapturer {
  private readonly limits: SiteCaptureLimits;

  constructor(private readonly options: MonchaSiteCapturerOptions = {}) {
    this.limits = { ...DEFAULT_SITE_LIMITS, ...options.limits };
  }

  async capture(input: { url: string; signal?: AbortSignal }): Promise<SiteCaptureResult> {
    const { signal } = input;
    const limits = this.limits;
    const warnings: string[] = [];
    const exceptions: SiteManifestException[] = [];
    const skipped: SiteManifestSkipped[] = [];
    const skippedUrls = new Set<string>();
    const checkAbort = () => {
      if (signal?.aborted) throw new SiteCaptureError('timeout', 'capture aborted');
    };
    const skip = (url: string, reason: SiteSkipReason, detail?: string) => {
      if (skippedUrls.has(url)) return;
      skippedUrls.add(url);
      skipped.push({ url: url.slice(0, 2_000), reason, ...(detail ? { detail: detail.slice(0, 200) } : {}) });
    };

    // 1. source.html, exactly as served.
    let safe: URL;
    try {
      safe = await assertSafeUrl(input.url);
    } catch {
      throw new SiteCaptureError('blocked_host');
    }
    if (this.options.checkRobots !== false) {
      const robots = await checkRobotsAllowed(safe.toString());
      if (!robots.allowed) {
        throw new SiteCaptureError(robots.failureReason === 'robots_disallowed' ? 'robots_disallowed' : 'blocked_host');
      }
    }
    checkAbort();

    let source: SafeFetchResult;
    try {
      source = await safeFetch(safe.toString(), {
        maxBytes: SOURCE_MAX_BYTES,
        timeoutMs: SOURCE_TIMEOUT_MS,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        signal,
      });
    } catch (error) {
      throw new SiteCaptureError(fetchErrorCode(error), error instanceof Error ? error.message : undefined);
    }
    if (source.status < 200 || source.status >= 300) throw new SiteCaptureError(`http_${source.status}`);
    if (!looksLikeHtml(source.contentType, source.bytes)) throw new SiteCaptureError('not_html', source.contentType ?? undefined);
    const finalUrl = source.url;
    const { charset, source: charsetSource } = detectCharset(source.bytes, source.contentType);
    checkAbort();

    // 2. Browser visits: rendered DOM, screenshots, evidence and every asset response.
    const network = new Map<string, Captured>();
    let networkBytes = 0;
    const hostSafety = new Map<string, Promise<boolean>>();
    const hostIsSafe = (url: string) => {
      let host: string;
      try {
        host = new URL(url).host;
      } catch {
        return Promise.resolve(false);
      }
      let check = hostSafety.get(host);
      if (!check) {
        check = assertSafeUrl(url).then(
          () => true,
          () => false,
        );
        hostSafety.set(host, check);
      }
      return check;
    };

    const visit = async (viewport: Viewport, mobile: boolean) => {
      const browser = await getRenderBrowser();
      const context: BrowserContext = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.scale,
        isMobile: mobile,
        hasTouch: mobile,
        userAgent: mobile ? MOBILE_UA : DESKTOP_UA,
        ignoreHTTPSErrors: true,
        serviceWorkers: 'block',
      });
      const onAbort = () => void context.close().catch(() => undefined);
      signal?.addEventListener('abort', onAbort, { once: true });
      const pending: Promise<void>[] = [];
      try {
        await context.route('**/*', async (route) => {
          const url = route.request().url();
          if (url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
          if (isTrackingUrl(url)) {
            skip(url.split('#')[0]!, 'tracking');
            return route.abort('blockedbyclient');
          }
          if (isBlockedNavigationUrl(url) || !(await hostIsSafe(url))) {
            skip(url.split('#')[0]!, 'blocked_host');
            return route.abort('blockedbyclient');
          }
          return route.continue();
        });

        const page = await context.newPage();
        const navTimeout = this.options.navTimeoutMs ?? 30_000;
        page.setDefaultTimeout(navTimeout);

        const onResponse = async (response: PwResponse) => {
          const request = response.request();
          if (request.method() !== 'GET' || request.frame() !== page.mainFrame()) return;
          const status = response.status();
          if (status !== 200 && status !== 203) return;
          const type = request.resourceType();
          if (!CAPTURE_RESOURCE_TYPES.has(type)) return;
          const url = response.url().split('#')[0]!;
          if (network.has(url) || isBlockedNavigationUrl(url) || isTrackingUrl(url)) return;
          const headers = response.headers();
          const declared = Number(headers['content-length'] ?? '');
          if (Number.isFinite(declared) && declared > limits.maxFileBytes) {
            skip(url, 'too_large', `${declared} bytes`);
            return;
          }
          let body: Buffer;
          try {
            body = await response.body();
          } catch {
            return;
          }
          if (network.has(url)) return;
          if (body.byteLength > limits.maxFileBytes) {
            skip(url, 'too_large', `${body.byteLength} bytes`);
            return;
          }
          if (networkBytes + body.byteLength > limits.maxTotalBytes) return;
          networkBytes += body.byteLength;
          network.set(url, {
            url,
            bytes: new Uint8Array(body),
            contentType: headers['content-type'] ?? null,
            sources: new Set(['network']),
            hint: hintForResourceType(type),
          });
        };
        page.on('response', (response) => {
          pending.push(onResponse(response).catch(() => undefined));
        });

        try {
          await page.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: navTimeout });
        } catch (error) {
          checkAbort();
          const message = error instanceof Error ? error.message : String(error);
          throw new SiteCaptureError(/timeout/i.test(message) ? 'timeout' : 'render_failed', message.slice(0, 200));
        }
        await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
        await scrollThrough(page);
        await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
        await page.waitForTimeout(1_500).catch(() => undefined);
        checkAbort();
        if (isBlockedNavigationUrl(page.url())) throw new SiteCaptureError('blocked_host', 'render redirected to a blocked host');

        let rendered: string | undefined;
        let evidence: (Omit<SiteEvidence, 'sourceTextLength' | 'renderedTextLength'> & { fullTextLength: number }) | undefined;
        if (!mobile) {
          if (await looksBlocked(page)) throw new SiteCaptureError('blocked_or_captcha');
          rendered = await page.content().catch(() => undefined);
          if (rendered === undefined) throw new SiteCaptureError('render_failed', 'page.content failed');
          evidence = await collectPageEvidence(page).catch(() => undefined);
        }
        const screens = await captureScreens(page, viewport);
        await Promise.allSettled(pending);
        return { rendered, evidence, screens };
      } finally {
        signal?.removeEventListener('abort', onAbort);
        await Promise.allSettled(pending);
        await context.close().catch(() => undefined);
      }
    };

    const desktop = await visit(DESKTOP, false);
    checkAbort();
    let mobile: Awaited<ReturnType<typeof visit>> | undefined;
    try {
      mobile = await visit(MOBILE, true);
    } catch (error) {
      if (signal?.aborted) throw new SiteCaptureError('timeout', 'capture aborted');
      warnings.push(`mobile_capture_failed:${error instanceof Error ? error.message.slice(0, 80) : 'unknown'}`);
    }
    checkAbort();

    // 3. Asset selection: HTML references first, then CSS references, then anything else the page loaded.
    const assets = new Map<string, Captured>();
    let totalBytes = 0;
    const accept = (item: Captured): boolean => {
      const existing = assets.get(item.url);
      if (existing) {
        for (const s of item.sources) existing.sources.add(s);
        return true;
      }
      if (assets.size >= limits.maxAssets) {
        skip(item.url, 'limit_reached', 'max_assets');
        return false;
      }
      if (item.bytes.byteLength > limits.maxFileBytes) {
        skip(item.url, 'too_large', `${item.bytes.byteLength} bytes`);
        return false;
      }
      if (totalBytes + item.bytes.byteLength > limits.maxTotalBytes) {
        skip(item.url, 'limit_reached', 'max_total_bytes');
        return false;
      }
      totalBytes += item.bytes.byteLength;
      assets.set(item.url, item);
      return true;
    };

    const obtain = async (url: string, source: SiteAssetSource, hint?: SiteAssetKind): Promise<Captured | null> => {
      const existing = assets.get(url);
      if (existing) {
        existing.sources.add(source);
        return existing;
      }
      if (isTrackingUrl(url)) {
        skip(url, 'tracking');
        return null;
      }
      const fromNetwork = network.get(url);
      if (fromNetwork) {
        fromNetwork.sources.add(source);
        fromNetwork.hint ??= hint;
        return accept(fromNetwork) ? fromNetwork : null;
      }
      if (skippedUrls.has(url)) return null;
      if (assets.size >= limits.maxAssets) {
        skip(url, 'limit_reached', 'max_assets');
        return null;
      }
      checkAbort();
      try {
        const res = await safeFetch(url, {
          maxBytes: limits.maxFileBytes,
          timeoutMs: ASSET_TIMEOUT_MS,
          minHostIntervalMs: ASSET_HOST_INTERVAL_MS,
          signal,
        });
        if (res.status >= 400) {
          skip(url, res.status >= 500 ? 'http_5xx' : 'http_4xx', String(res.status));
          return null;
        }
        if (res.status < 200 || res.status >= 300) {
          skip(url, 'fetch_error', `status ${res.status}`);
          return null;
        }
        const item: Captured = { url, bytes: res.bytes, contentType: res.contentType, sources: new Set([source]), hint };
        return accept(item) ? item : null;
      } catch (error) {
        skip(url, skipReasonFor(error), error instanceof Error ? error.message : undefined);
        return null;
      }
    };

    const isCss = (item: Captured) => classifyAsset(item.url, item.contentType, item.hint) === 'css';
    const cssDone = new Set<string>();
    const followCss = async (roots: Captured[]) => {
      let level = roots.filter((c) => isCss(c) && !cssDone.has(c.url));
      for (let depth = 1; depth <= CSS_MAX_DEPTH && level.length; depth += 1) {
        const nextLevel: Captured[] = [];
        for (const css of level) {
          cssDone.add(css.url);
          const refs = collectCssUrls(css.bytes, css.url);
          await mapLimit(refs, FETCH_CONCURRENCY, async (ref) => {
            const got = await obtain(ref.url, 'css', ref.kind === 'import' ? 'css' : undefined);
            if (got && isCss(got) && !cssDone.has(got.url)) nextLevel.push(got);
          });
        }
        level = nextLevel;
      }
    };

    const html = collectHtmlUrls(source.bytes, charset, finalUrl);
    for (const iframe of html.iframes) skip(iframe, 'iframe_embed');
    for (const ignored of html.ignored) skip(ignored.value, ignored.reason === 'blob' ? 'blob_url' : 'unsupported_scheme');

    await mapLimit(html.urls, FETCH_CONCURRENCY, async (ref) => {
      await obtain(ref.url, 'html', ref.hint);
    });
    const logoUrls = (desktop.evidence?.logoCandidates ?? []).map((c) => c.url).filter((u) => /^https?:/i.test(u));
    await mapLimit(logoUrls, FETCH_CONCURRENCY, async (url) => {
      await obtain(url.split('#')[0]!, 'html', 'image');
    });
    await followCss([...assets.values()]);
    const before = new Set(assets.keys());
    for (const item of network.values()) {
      if (!assets.has(item.url)) accept(item);
    }
    await followCss([...assets.values()].filter((a) => !before.has(a.url)));
    checkAbort();

    // 4. Storage paths, then rewrites (CSS relative to its own location, index.html relative to the root).
    const pathByUrl = new Map<string, string>();
    const urlByPath = new Map<string, string>();
    for (const item of assets.values()) {
      let stored = assetStoragePath(item.url, item.contentType);
      if (urlByPath.has(stored) || stored === 'index.html') {
        const dot = stored.lastIndexOf('.');
        const tag = `~${sha256(item.url).slice(0, 8)}`;
        stored = dot > stored.lastIndexOf('/') ? `${stored.slice(0, dot)}${tag}${stored.slice(dot)}` : `${stored}${tag}`;
      }
      pathByUrl.set(item.url, stored);
      urlByPath.set(stored, item.url);
    }
    const resolverFrom =
      (fromFile: string): UrlResolver =>
      (abs) => {
        const target = pathByUrl.get(abs);
        return target ? relativeStoredPath(fromFile, target) : null;
      };

    const unresolved = new Set<string>();
    let cssRewrites = 0;
    const files: SiteCapturedFile[] = [];
    const manifestAssets: SiteManifestAsset[] = [];
    const idByUrl = new Map<string, string>();
    for (const item of assets.values()) {
      const storedPath = pathByUrl.get(item.url)!;
      const kind = classifyAsset(item.url, item.contentType, item.hint);
      let bytes = item.bytes;
      if (kind === 'css') {
        try {
          const rewritten = rewriteCss(item.bytes, item.url, resolverFrom(storedPath));
          bytes = rewritten.bytes;
          cssRewrites += rewritten.count;
          for (const u of rewritten.unresolved) unresolved.add(u);
        } catch (error) {
          exceptions.push({ file: storedPath, kind: 'css_unparsable', detail: error instanceof Error ? error.message.slice(0, 120) : undefined });
        }
      }
      const contentType = contentTypeFor(storedPath, item.contentType);
      const id = `a_${sha256(item.url).slice(0, 12)}`;
      idByUrl.set(item.url, id);
      files.push({ path: storedPath, bytes, contentType });
      manifestAssets.push({
        id,
        url: item.url,
        storedPath,
        contentType,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
        kind,
        discoveredBy: [...item.sources].sort(),
      });
    }

    const index = rewriteHtml(source.bytes, charset, finalUrl, resolverFrom('index.html'));
    for (const u of index.unresolved) unresolved.add(u);
    exceptions.push(...index.exceptions);
    for (const e of index.exceptions) warnings.push(e.kind);
    if (/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy/i.test(toLatin1(source.bytes.subarray(0, 64_000)))) {
      warnings.push('meta_csp_present');
    }

    // 5. Evidence.
    const page = desktop.evidence;
    const srcTextLen = sourceTextLength(toLatin1(source.bytes));
    const renderedTextLen = page?.fullTextLength ?? 0;
    if (renderedTextLen > 800 && srcTextLen < renderedTextLen * 0.25) warnings.push('js_rendered_site');
    if (!page) warnings.push('evidence_unavailable');
    const evidence: SiteEvidence = {
      title: page?.title ?? null,
      description: page?.description ?? null,
      lang: page?.lang ?? null,
      visibleText: page?.visibleText ?? '',
      meta: page?.meta ?? {},
      jsonLd: page?.jsonLd ?? [],
      links: page?.links ?? { tel: [], mailto: [], whatsapp: [], social: [] },
      colors: page?.colors ?? [],
      fonts: page?.fonts ?? [],
      logoCandidates: (page?.logoCandidates ?? []).map((c) => {
        const id = idByUrl.get(c.url.split('#')[0]!);
        return id ? { ...c, assetId: id } : c;
      }),
      sourceTextLength: srcTextLen,
      renderedTextLength: renderedTextLen,
    };

    if (assets.size >= limits.maxAssets) warnings.push('asset_limit_reached');
    if (skipped.some((s) => s.reason === 'limit_reached' && s.detail === 'max_total_bytes')) warnings.push('size_limit_reached');

    return {
      sourceUrl: input.url,
      finalUrl,
      httpStatus: source.status,
      redirects: source.redirects,
      source: { bytes: source.bytes, sha256: sha256(source.bytes), charset, charsetSource },
      renderedHtml: desktop.rendered ?? '',
      indexHtml: index.bytes,
      files,
      screenshots: {
        desktop: desktop.screens.full,
        mobile: mobile?.screens.full,
        desktopViewport: desktop.screens.first,
        mobileViewport: mobile?.screens.first,
      },
      evidence,
      manifest: {
        version: 1,
        sourceUrl: input.url,
        finalUrl,
        redirects: source.redirects,
        capturedAt: new Date().toISOString(),
        source: { bytes: source.bytes.byteLength, sha256: sha256(source.bytes), charset, charsetSource },
        assets: manifestAssets,
        skipped,
        rewrites: { index: index.count, css: cssRewrites, unresolved: unresolved.size },
        exceptions,
        limits: { ...limits },
      },
      warnings: [...new Set(warnings)],
    };
  }
}
