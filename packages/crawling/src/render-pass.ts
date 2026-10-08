import { createHash } from 'node:crypto';
import type {
  DetectedChannelInput,
  EvidenceItemInput,
  WebsiteAuditResult,
  WebsiteStatus,
} from '@moncha/domain';
import { DEFAULT_AUDIT_CONFIG } from '@moncha/domain';
import { chromium, type Browser, type Page, type Request } from 'playwright';
import { extractChannelsFromHtml } from './channels';
import { waitForHostSlot } from './host-rate';
import { extractTitle } from './http-checker';
import { checkRobotsAllowed } from './robots';
import {
  assistantGlobalNames,
  assistantSelectors,
  hitFromGlobal,
  hitFromSelector,
  looksParked,
  matchAssistantSignatures,
  partitionHits,
  type SignatureHit,
} from './signatures';
import { assertSafeUrl, isBlockedNavigationUrl } from './url-safety';

const NAV_TIMEOUT_MS = 25_000;
/** SRS: wait networkidle + 4s for late-loaded chat widgets. */
const SETTLE_MS = 4_000;
const MAX_HTML_CHARS = 1_500_000;
const MAX_PAGES = 3;

export type RenderPassResult = {
  ok: boolean;
  websiteStatus: WebsiteStatus;
  finalUrl?: string;
  httpStatus?: number;
  httpsOk?: boolean;
  robotsAllowed?: boolean;
  title?: string;
  language?: string;
  html?: string;
  contentHash?: string;
  failureReason?: string;
  assistantHits: SignatureHit[];
  networkHits: SignatureHit[];
  channels: DetectedChannelInput[];
  /** True when at least the homepage navigation + DOM capture completed. */
  renderComplete: boolean;
  pagesVisited: string[];
  screenshot?: Uint8Array;
};

let sharedBrowser: Browser | null = null;

async function launchBrowser(): Promise<Browser> {
  const args = ['--disable-dev-shm-usage', '--no-sandbox'];
  const preferred = process.env.PLAYWRIGHT_CHANNEL?.trim();
  // Prefer system Edge/Chrome when bundled Chromium isn't installed (common on Windows).
  const channels: Array<string | undefined> = preferred
    ? [preferred, 'msedge', 'chrome', undefined]
    : process.platform === 'win32'
      ? ['msedge', 'chrome', undefined]
      : [undefined, 'msedge', 'chrome'];

  let lastError: unknown;
  const tried = new Set<string>();
  for (const channel of channels) {
    const key = channel ?? 'bundled-chromium';
    if (tried.has(key)) continue;
    tried.add(key);
    try {
      return await chromium.launch({
        headless: true,
        ...(channel ? { channel } : {}),
        args,
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('playwright_launch_failed');
}

let launching: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  // Audit and site-snapshot loops run concurrently; share one launch instead of starting two browsers.
  launching ??= launchBrowser().finally(() => {
    launching = null;
  });
  sharedBrowser = await launching;
  return sharedBrowser;
}

/** Shared Chromium instance (also used by the site capturer). */
export const getRenderBrowser = getBrowser;

/** Close shared browser (tests / worker shutdown). */
export async function closeRenderBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => undefined);
    sharedBrowser = null;
  }
}

function hitFromUrl(url: string): SignatureHit | null {
  const hits = matchAssistantSignatures(url);
  if (!hits.length) return null;
  const top = hits[0]!;
  return { ...top, type: 'network_request', matched: url.slice(0, 240) };
}

/** Pick up to 2 extra same-origin pages: /contact + one of /book|/appointment|/services. */
export function pickExtraPageUrls(homepageHtml: string, homepageUrl: string): string[] {
  const base = new URL(homepageUrl);
  const hrefRe = /href=["']([^"'#]+)["']/gi;
  const candidates: { url: string; score: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(homepageHtml))) {
    const href = m[1] || '';
    try {
      const abs = new URL(href, homepageUrl);
      if (abs.origin !== base.origin) continue;
      const path = abs.pathname.toLowerCase().replace(/\/+$/, '') || '/';
      if (path === '/' || path === base.pathname.replace(/\/+$/, '')) continue;
      let score = 0;
      if (/\/contact/.test(path)) score = 3;
      else if (/\/(book|booking|appointment|appointments)/.test(path)) score = 2;
      else if (/\/services?/.test(path)) score = 1;
      else continue;
      candidates.push({ url: abs.toString(), score });
    } catch {
      // ignore
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const picked: string[] = [];
  let hasContact = false;
  let hasBookOrServices = false;
  for (const c of candidates) {
    if (picked.length >= 2) break;
    const path = new URL(c.url).pathname.toLowerCase();
    if (/\/contact/.test(path)) {
      if (hasContact) continue;
      hasContact = true;
      picked.push(c.url);
      continue;
    }
    if (hasBookOrServices) continue;
    hasBookOrServices = true;
    picked.push(c.url);
  }

  // Fallback paths when homepage has no useful links.
  if (picked.length < 2) {
    for (const path of ['/contact', '/book', '/appointment', '/services']) {
      if (picked.length >= 2) break;
      const guess = new URL(path, homepageUrl).toString();
      if (!picked.includes(guess) && guess !== homepageUrl) {
        // Only add /contact first; then one book-like.
        if (path === '/contact' && !hasContact) {
          picked.push(guess);
          hasContact = true;
        } else if (path !== '/contact' && !hasBookOrServices && hasContact) {
          picked.push(guess);
          hasBookOrServices = true;
        } else if (path === '/contact' && picked.length === 0) {
          picked.push(guess);
          hasContact = true;
        }
      }
    }
  }
  return picked.slice(0, 2);
}

type DomProbe = {
  globals: string[];
  selectors: string[];
  cornerWidgets: Array<{ tag: string; id: string; className: string; aria: string }>;
};

async function probeDom(page: Page): Promise<DomProbe> {
  const globalNames = assistantGlobalNames();
  const selectors = assistantSelectors();
  return page.evaluate(
    ({ globalNames: globals, selectors: sels }) => {
      const foundGlobals: string[] = [];
      for (const name of globals) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (typeof (window as any)[name] !== 'undefined') foundGlobals.push(name);
        } catch {
          // ignore cross-origin / revoked
        }
      }

      // Document plus every (forced-open) shadow root, so widgets rendered in shadow DOM are visible.
      const roots: Array<Document | ShadowRoot> = [document];
      for (let i = 0; i < roots.length && roots.length < 200; i += 1) {
        roots[i]!.querySelectorAll('*').forEach((el) => {
          if (el.shadowRoot) roots.push(el.shadowRoot);
        });
      }

      const foundSelectors: string[] = [];
      for (const sel of sels) {
        try {
          if (roots.some((root) => root.querySelector(sel))) foundSelectors.push(sel);
        } catch {
          // invalid selector
        }
      }

      // Messaging-app buttons (WhatsApp, Messenger, Telegram, LINE, Viber) are contact channels, not assistants.
      const messaging =
        /whatsapp|wa\.me|wa\.link|messenger|m\.me\/|fb-messenger|facebook|telegram|t\.me\/|line\.me|lin\.ee|viber/;
      const cornerWidgets: Array<{ tag: string; id: string; className: string; aria: string }> = [];
      outer: for (const root of roots) {
        const nodes = root.querySelectorAll('iframe, button, a, div');
        for (const el of nodes) {
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          if (style.position !== 'fixed' && style.position !== 'sticky') continue;
          const rect = el.getBoundingClientRect();
          if (rect.width < 24 || rect.height < 24) continue;
          const nearBottom = rect.bottom >= window.innerHeight - 140;
          const nearCorner = rect.left <= 96 || rect.right >= window.innerWidth - 96;
          if (!nearBottom || !nearCorner) continue;
          const links = Array.from(el.querySelectorAll('a[href], iframe[src]'))
            .map((node) => node.getAttribute('href') || node.getAttribute('src') || '')
            .join(' ');
          const blob = `${el.id} ${el.className} ${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''} ${el.getAttribute('href') ?? ''} ${el.getAttribute('src') ?? ''} ${links}`.toLowerCase();
          if (messaging.test(blob)) continue;
          const chatty =
            /chat|intercom|tawk|crisp|tidio|support|assistant|help/.test(blob) || el.tagName === 'IFRAME';
          if (!chatty) continue;
          cornerWidgets.push({
            tag: el.tagName,
            id: el.id || '',
            className: String(el.className || '').slice(0, 120),
            aria: (el.getAttribute('aria-label') || '').slice(0, 80),
          });
          if (cornerWidgets.length >= 8) break outer;
        }
      }
      return { globals: foundGlobals, selectors: foundSelectors, cornerWidgets };
    },
    { globalNames, selectors },
  );
}

const COOKIE_ACCEPT_SELECTORS = [
  '#onetrust-accept-btn-handler',
  '.onetrust-accept-btn-handler',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#CybotCookiebotDialogBodyButtonAccept',
  '.cky-btn-accept',
  '.cmplz-accept',
  '#cookie_action_close_header',
  '.cc-allow',
  '.cc-accept',
  'button[data-cookiefirst-action="accept"]',
  'button[aria-label*="accept" i]',
  'button[id*="accept" i]',
  'button[class*="accept" i]',
];

/** English, Malay/Indonesian, Chinese, Thai, Arabic consent button labels. */
export const COOKIE_BUTTON_RE =
  /^(accept|accept all|accept all cookies|accept cookies|allow|allow all|allow cookies|agree|i agree|i accept|agree and close|got it|ok|okay|terima|terima semua|setuju|saya setuju|benarkan|benarkan semua|接受|全部接受|同意|ยอมรับ|ยอมรับทั้งหมด|موافق|قبول|أوافق|قبول الكل)$/i;

/** Click one cookie-consent accept button; many chat widgets load only after consent. */
async function dismissCookieBanners(page: Page): Promise<boolean> {
  for (const sel of COOKIE_ACCEPT_SELECTORS) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 1_500 }).catch(() => undefined);
      await page.waitForTimeout(400).catch(() => undefined);
      return true;
    }
  }
  // Text match on real buttons only — clicking links could navigate away from the audited page.
  const buttons = page.locator('button, [role="button"], input[type="button"], input[type="submit"]');
  const count = Math.min(await buttons.count().catch(() => 0), 40);
  for (let i = 0; i < count; i += 1) {
    const btn = buttons.nth(i);
    const text = (
      (await btn.innerText().catch(() => '')) ||
      (await btn.getAttribute('value').catch(() => '')) ||
      ''
    ).trim();
    if (text && COOKIE_BUTTON_RE.test(text) && (await btn.isVisible().catch(() => false))) {
      await btn.click({ timeout: 1_500 }).catch(() => undefined);
      await page.waitForTimeout(400).catch(() => undefined);
      return true;
    }
  }
  return false;
}

/** Scroll and move the mouse to trigger widgets that load on interaction. */
async function awakenLazyWidgets(page: Page): Promise<void> {
  await page
    .evaluate(async () => {
      const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const height = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
      const steps = 6;
      for (let i = 1; i <= steps; i += 1) {
        window.scrollTo(0, Math.floor((height * i) / steps));
        await delay(180);
      }
      window.scrollTo(0, 0);
    })
    .catch(() => undefined);
  await page.mouse.move(120, 200).catch(() => undefined);
  await page.mouse.move(1100, 640).catch(() => undefined);
  await page.waitForTimeout(300).catch(() => undefined);
}

const BLOCKED_RE =
  /just a moment|attention required|cf-browser-verification|challenge-platform|verify you are human|are you a robot|access denied|captcha/;

/** Bot-challenge / captcha interstitial — an empty "no assistant" result would be wrong. */
export async function looksBlocked(page: Page): Promise<boolean> {
  const title = (await page.title().catch(() => '')).toLowerCase();
  const body = ((await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '')) || '')
    .slice(0, 4_000)
    .toLowerCase();
  if (BLOCKED_RE.test(title)) return true;
  // Short body only: long real pages may legitimately mention "captcha" in a form.
  return body.length < 1_500 && BLOCKED_RE.test(body);
}

function mergeHits(...lists: SignatureHit[][]): SignatureHit[] {
  const byKey = new Map<string, SignatureHit>();
  for (const list of lists) {
    for (const hit of list) {
      const key = `${hit.vendor}:${hit.type}:${hit.matched}`;
      if (!byKey.has(key)) byKey.set(key, hit);
    }
  }
  return [...byKey.values()];
}

async function settlePage(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(SETTLE_MS).catch(() => undefined);
}

/**
 * Pass 2: headless Chromium render.
 * Homepage + up to 2 linked pages. Never treats a failed render as NO_ASSISTANT.
 */
export async function runRenderPass(url: string): Promise<RenderPassResult> {
  let safe: URL;
  try {
    safe = await assertSafeUrl(url);
  } catch (error) {
    return {
      ok: false,
      websiteStatus: 'INACCESSIBLE',
      failureReason: error instanceof Error ? error.message : 'blocked_host',
      assistantHits: [],
      networkHits: [],
      channels: [],
      renderComplete: false,
      pagesVisited: [],
      robotsAllowed: false,
    };
  }

  const robots = await checkRobotsAllowed(safe.toString());
  if (!robots.allowed) {
    return {
      ok: false,
      websiteStatus: 'ACTIVE',
      finalUrl: safe.toString(),
      robotsAllowed: false,
      failureReason: robots.failureReason ?? 'robots_disallowed',
      assistantHits: [],
      networkHits: [],
      channels: [],
      renderComplete: false,
      pagesVisited: [],
    };
  }

  await waitForHostSlot(safe.hostname);

  const networkHits: SignatureHit[] = [];
  const seenVendors = new Set<string>();
  const pagesVisited: string[] = [];

  try {
    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent: 'MonChaLeadEngine/1.0 (+website-audit-render)',
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
    });
    // Force shadow roots open so probeDom can see widgets rendered inside closed shadow DOM.
    await context.addInitScript(() => {
      const original = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function attachShadowOpen(this: Element, init: ShadowRootInit) {
        return original.call(this, { ...init, mode: 'open' });
      };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);

    page.on('request', (req: Request) => {
      const reqUrl = req.url();
      if (isBlockedNavigationUrl(reqUrl)) return;
      const hit = hitFromUrl(reqUrl);
      if (hit && !seenVendors.has(`${hit.vendor}:net`)) {
        seenVendors.add(`${hit.vendor}:net`);
        networkHits.push(hit);
      }
    });

    let response;
    try {
      response = await page.goto(safe.toString(), {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });
    } catch (error) {
      await context.close().catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        websiteStatus: 'INACCESSIBLE',
        finalUrl: safe.toString(),
        robotsAllowed: true,
        failureReason: message.toLowerCase().includes('timeout')
          ? 'render_timeout'
          : `render_nav_${message.slice(0, 80)}`,
        assistantHits: [],
        networkHits,
        channels: [],
        renderComplete: false,
        pagesVisited,
      };
    }

    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
    await dismissCookieBanners(page);
    await awakenLazyWidgets(page);
    await settlePage(page);

    const finalUrl = page.url();
    try {
      await assertSafeUrl(finalUrl);
    } catch {
      await context.close().catch(() => undefined);
      return {
        ok: false,
        websiteStatus: 'INACCESSIBLE',
        finalUrl,
        robotsAllowed: true,
        failureReason: 'render_redirect_blocked',
        assistantHits: [],
        networkHits,
        channels: [],
        renderComplete: false,
        pagesVisited,
      };
    }

    pagesVisited.push(finalUrl);
    const httpStatus = response?.status();
    let html = '';
    try {
      html = await page.content();
      if (html.length > MAX_HTML_CHARS) html = html.slice(0, MAX_HTML_CHARS);
    } catch {
      await context.close().catch(() => undefined);
      return {
        ok: false,
        websiteStatus: 'INACCESSIBLE',
        finalUrl,
        httpStatus,
        robotsAllowed: true,
        failureReason: 'render_dom_failed',
        assistantHits: [],
        networkHits,
        channels: [],
        renderComplete: false,
        pagesVisited,
      };
    }

    const title = (await page.title().catch(() => extractTitle(html))) || extractTitle(html);
    const language = await page
      .locator('html')
      .getAttribute('lang')
      .catch(() => undefined);

    if (await looksBlocked(page)) {
      await context.close().catch(() => undefined);
      return {
        ok: false,
        websiteStatus: 'ACTIVE',
        finalUrl,
        httpStatus,
        httpsOk: finalUrl.startsWith('https:'),
        robotsAllowed: true,
        title,
        failureReason: 'blocked_or_captcha',
        assistantHits: [],
        networkHits,
        channels: [],
        renderComplete: false,
        pagesVisited,
      };
    }

    let screenshot: Uint8Array | undefined;
    try {
      screenshot = await page.screenshot({ fullPage: false, type: 'png' });
    } catch {
      // screenshot is best-effort
    }

    const allDomHits: SignatureHit[] = [];
    const homepageProbe = await probeDom(page);
    for (const g of homepageProbe.globals) {
      const hit = hitFromGlobal(g);
      if (hit) allDomHits.push(hit);
    }
    for (const sel of homepageProbe.selectors) {
      allDomHits.push(hitFromSelector(sel));
    }
    for (const w of homepageProbe.cornerWidgets) {
      allDomHits.push({
        vendor: 'GenericChat',
        kind: 'LIVE_CHAT',
        matched: `${w.tag}#${w.id}.${w.className} ${w.aria}`.slice(0, 200),
        type: 'dom_selector',
        generic: true,
      });
    }

    allDomHits.push(...matchAssistantSignatures(html));

    // Extra pages: /contact + book|appointment|services (max 3 total including homepage).
    const extras = pickExtraPageUrls(html, finalUrl).slice(0, MAX_PAGES - 1);
    for (const extraUrl of extras) {
      try {
        await assertSafeUrl(extraUrl);
        await waitForHostSlot(safe.hostname);
        const extraResp = await page.goto(extraUrl, {
          waitUntil: 'domcontentloaded',
          timeout: NAV_TIMEOUT_MS,
        });
        if (!extraResp || extraResp.status() >= 400) continue;
        await awakenLazyWidgets(page);
        await settlePage(page);
        const extraFinal = page.url();
        if (isBlockedNavigationUrl(extraFinal)) continue;
        pagesVisited.push(extraFinal);
        const extraHtml = await page.content().catch(() => '');
        if (extraHtml) {
          allDomHits.push(...matchAssistantSignatures(extraHtml.slice(0, MAX_HTML_CHARS)));
        }
        const probe = await probeDom(page);
        for (const g of probe.globals) {
          const hit = hitFromGlobal(g);
          if (hit) allDomHits.push(hit);
        }
        for (const sel of probe.selectors) {
          allDomHits.push(hitFromSelector(sel));
        }
      } catch {
        // Extra page failures do not fail the whole render if homepage succeeded.
      }
    }

    await context.close().catch(() => undefined);

    const channels = extractChannelsFromHtml(html, finalUrl);
    const assistantHits = mergeHits(allDomHits);

    if (httpStatus === 404 || httpStatus === 410) {
      return {
        ok: false,
        websiteStatus: 'INACTIVE',
        finalUrl,
        httpStatus,
        httpsOk: finalUrl.startsWith('https:'),
        robotsAllowed: true,
        title,
        language: language ?? undefined,
        html,
        failureReason: `http_${httpStatus}`,
        assistantHits: [],
        networkHits,
        channels: [],
        renderComplete: true,
        pagesVisited,
        screenshot,
      };
    }

    if (httpStatus && httpStatus >= 400) {
      return {
        ok: false,
        websiteStatus: 'INACCESSIBLE',
        finalUrl,
        httpStatus,
        httpsOk: finalUrl.startsWith('https:'),
        robotsAllowed: true,
        title,
        failureReason: `http_${httpStatus}`,
        assistantHits,
        networkHits,
        channels: [],
        renderComplete: true,
        pagesVisited,
        screenshot,
      };
    }

    if (looksParked(html, title)) {
      return {
        ok: true,
        websiteStatus: 'PARKED',
        finalUrl,
        httpStatus,
        httpsOk: finalUrl.startsWith('https:'),
        robotsAllowed: true,
        title,
        language: language ?? undefined,
        html,
        contentHash: createHash('sha256').update(html).digest('hex'),
        assistantHits: [],
        networkHits,
        channels: [],
        renderComplete: true,
        pagesVisited,
        screenshot,
      };
    }

    return {
      ok: true,
      websiteStatus: 'ACTIVE',
      finalUrl,
      httpStatus,
      httpsOk: finalUrl.startsWith('https:'),
      robotsAllowed: true,
      title,
      language: language ?? undefined,
      html,
      contentHash: createHash('sha256').update(html).digest('hex'),
      assistantHits,
      networkHits,
      channels,
      renderComplete: true,
      pagesVisited,
      screenshot,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      websiteStatus: 'INACCESSIBLE',
      robotsAllowed: true,
      failureReason: `render_error_${message.slice(0, 100)}`,
      assistantHits: [],
      networkHits,
      channels: [],
      renderComplete: false,
      pagesVisited,
    };
  }
}

export function renderPassToAuditResult(
  pass: RenderPassResult,
  prior?: WebsiteAuditResult,
): WebsiteAuditResult {
  const auditedAt = new Date();
  const classifierVersion = DEFAULT_AUDIT_CONFIG.classifierVersion;
  const mergedHits = mergeHits(pass.networkHits, pass.assistantHits);
  const { definite, generic } = partitionHits(mergedHits);

  const baseEvidence: EvidenceItemInput[] = [
    ...(prior?.evidence ?? []),
    ...mergedHits.map((hit) => ({
      type: hit.type as EvidenceItemInput['type'],
      excerpt: hit.matched,
      vendor: hit.vendor,
      url: hit.type === 'network_request' ? hit.matched : undefined,
      selector: hit.type === 'dom_selector' ? hit.matched : undefined,
      sourcePage: pass.finalUrl,
    })),
  ];

  if (pass.screenshot?.length) {
    baseEvidence.push({
      type: 'screenshot',
      excerpt: 'homepage screenshot',
      sourcePage: pass.finalUrl,
      contentHash: createHash('sha256').update(pass.screenshot).digest('hex'),
    });
  }

  const artifacts =
    pass.screenshot || pass.html
      ? {
          screenshot: pass.screenshot,
          renderedDom: pass.html,
        }
      : undefined;

  if (!pass.renderComplete) {
    return {
      websiteStatus: prior?.websiteStatus === 'ACTIVE' ? 'ACTIVE' : pass.websiteStatus,
      finalUrl: pass.finalUrl ?? prior?.finalUrl,
      httpStatus: pass.httpStatus ?? prior?.httpStatus,
      httpsOk: pass.httpsOk ?? prior?.httpsOk,
      robotsAllowed: pass.robotsAllowed,
      title: pass.title ?? prior?.title,
      language: pass.language ?? prior?.language,
      verdict: 'UNCERTAIN',
      kind: 'NONE',
      confidence: 0.35,
      method: 'render',
      renderRan: true,
      llmRan: false,
      evidence: [
        ...baseEvidence,
        {
          type: 'page_excerpt',
          excerpt: `Render incomplete: ${pass.failureReason ?? 'unknown'}`,
          sourcePage: pass.finalUrl,
        },
      ],
      channels: pass.channels.length ? pass.channels : prior?.channels ?? [],
      failureReason: pass.failureReason ?? 'render_incomplete',
      contentHash: pass.contentHash ?? prior?.contentHash,
      auditedAt,
      classifierVersion,
      artifacts,
    };
  }

  if (pass.websiteStatus !== 'ACTIVE') {
    return {
      websiteStatus: pass.websiteStatus,
      finalUrl: pass.finalUrl,
      httpStatus: pass.httpStatus,
      httpsOk: pass.httpsOk,
      robotsAllowed: pass.robotsAllowed,
      title: pass.title,
      language: pass.language,
      verdict: 'NOT_APPLICABLE',
      kind: 'NONE',
      confidence: 1,
      method: 'render',
      renderRan: true,
      llmRan: false,
      evidence: baseEvidence,
      channels: pass.channels,
      failureReason: pass.failureReason,
      contentHash: pass.contentHash,
      auditedAt,
      classifierVersion,
      artifacts,
    };
  }

  if (definite.length > 0) {
    const top = definite[0]!;
    return {
      websiteStatus: 'ACTIVE',
      finalUrl: pass.finalUrl,
      httpStatus: pass.httpStatus,
      httpsOk: pass.httpsOk,
      robotsAllowed: pass.robotsAllowed,
      title: pass.title,
      language: pass.language,
      verdict: 'HAS_ASSISTANT',
      kind: top.kind,
      vendor: top.vendor,
      confidence: 0.96,
      method: 'render',
      renderRan: true,
      llmRan: false,
      evidence: baseEvidence,
      channels: pass.channels,
      contentHash: pass.contentHash,
      auditedAt,
      classifierVersion,
      artifacts,
    };
  }

  // Only generic-pattern hits → UNCERTAIN (SRS).
  if (generic.length > 0) {
    return {
      websiteStatus: 'ACTIVE',
      finalUrl: pass.finalUrl,
      httpStatus: pass.httpStatus,
      httpsOk: pass.httpsOk,
      robotsAllowed: pass.robotsAllowed,
      title: pass.title,
      language: pass.language,
      verdict: 'UNCERTAIN',
      kind: 'NONE',
      confidence: 0.45,
      method: 'render',
      renderRan: true,
      llmRan: false,
      evidence: baseEvidence,
      channels: pass.channels,
      failureReason: 'generic_pattern_only',
      contentHash: pass.contentHash,
      auditedAt,
      classifierVersion,
      artifacts,
    };
  }

  // Successful full render, no assistant signatures in DOM or network.
  return {
    websiteStatus: 'ACTIVE',
    finalUrl: pass.finalUrl,
    httpStatus: pass.httpStatus,
    httpsOk: pass.httpsOk,
    robotsAllowed: pass.robotsAllowed,
    title: pass.title,
    language: pass.language,
    verdict: 'NO_ASSISTANT',
    kind: 'NONE',
    confidence: 0.9,
    method: 'render',
    renderRan: true,
    llmRan: false,
    evidence: [
      ...baseEvidence,
      {
        type: 'page_excerpt',
        excerpt: `No assistant signatures after render (${pass.pagesVisited.length} page(s))`,
        sourcePage: pass.finalUrl,
      },
    ],
    channels: pass.channels,
    contentHash: pass.contentHash,
    auditedAt,
    classifierVersion,
    artifacts,
  };
}
