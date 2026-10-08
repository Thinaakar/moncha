import type { Page } from 'playwright';
import type { SiteEvidence, SiteLogoCandidate } from '@moncha/domain';

const MAX_VISIBLE_TEXT = 12_000;

type PageEvidence = Omit<SiteEvidence, 'sourceTextLength' | 'renderedTextLength'> & { fullTextLength: number };

/**
 * tsx/esbuild (keepNames) wraps named inner functions in `__name(...)`, which does not exist in the
 * page when Playwright serializes a function. Define it before any evaluate.
 */
export const NAME_SHIM = 'globalThis.__name = globalThis.__name || function (fn) { return fn; };';

/** Collects brand evidence from the rendered DOM. Runs inside the page, so it must be self-contained. */
export async function collectPageEvidence(page: Page): Promise<PageEvidence> {
  await page.evaluate(NAME_SHIM);
  return page.evaluate((maxText: number) => {
    const clip = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
    const abs = (u: string | null | undefined) => {
      if (!u) return '';
      try {
        return new URL(u, document.baseURI).toString();
      } catch {
        return '';
      }
    };

    const toHex = (value: string): string | null => {
      const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(value.trim());
      if (m) {
        const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
        if (alpha < 0.5) return null;
        return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
      }
      const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
      if (!h) return null;
      const hex = h[1]!.toLowerCase();
      return hex.length === 3 ? `#${hex.split('').map((c) => c + c).join('')}` : `#${hex}`;
    };

    const fullText = document.body?.innerText ?? '';
    const meta: Record<string, string> = {};
    document.querySelectorAll('meta[name], meta[property], meta[itemprop]').forEach((el) => {
      const key = (el.getAttribute('property') || el.getAttribute('name') || el.getAttribute('itemprop') || '').toLowerCase();
      const content = el.getAttribute('content');
      if (!key || !content || Object.keys(meta).length >= 40) return;
      if (/^(og:|twitter:|description|keywords|theme-color|application-name|author|geo\.|business:|place:)/.test(key)) {
        meta[key] = clip(content, 300);
      }
    });

    const jsonLd: unknown[] = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
      if (jsonLd.length >= 10) return;
      const text = el.textContent ?? '';
      if (text.length > 40_000) return;
      try {
        jsonLd.push(JSON.parse(text));
      } catch {
        // ignore invalid JSON-LD
      }
    });

    const links = { tel: [] as string[], mailto: [] as string[], whatsapp: [] as string[], social: [] as string[] };
    const socialRe = /(facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com|tiktok\.com|pinterest\.|threads\.net|line\.me|t\.me)\//i;
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = (a.getAttribute('href') ?? '').trim();
      const lower = href.toLowerCase();
      const push = (list: string[], v: string) => {
        if (v && !list.includes(v) && list.length < 20) list.push(v);
      };
      if (lower.startsWith('tel:')) push(links.tel, href.slice(4).trim());
      else if (lower.startsWith('mailto:')) push(links.mailto, href.slice(7).split('?')[0]!.trim());
      else if (/wa\.me\/|api\.whatsapp\.com|whatsapp:\/\/|wa\.link\//.test(lower)) push(links.whatsapp, abs(href) || href);
      else if (socialRe.test(lower)) {
        const url = abs(href);
        if (url && !/\/sharer|\/share\?|intent\/tweet|\/plugins\//i.test(url)) push(links.social, url);
      }
    });

    const colorCounts = new Map<string, { value: string; usage: string; count: number }>();
    const addColor = (raw: string | null | undefined, usage: string) => {
      if (!raw) return;
      const hex = toHex(raw);
      if (!hex) return;
      const key = `${hex}|${usage}`;
      const entry = colorCounts.get(key);
      if (entry) entry.count += 1;
      else colorCounts.set(key, { value: hex, usage, count: 1 });
    };
    const sample = (selector: string, limit: number) => Array.from(document.querySelectorAll(selector)).slice(0, limit);
    const bodyStyle = document.body ? getComputedStyle(document.body) : null;
    addColor(bodyStyle?.backgroundColor, 'body-background');
    addColor(bodyStyle?.color, 'body-text');
    for (const el of sample('header, nav, [class*="header" i], [id*="header" i]', 6)) {
      addColor(getComputedStyle(el).backgroundColor, 'header-background');
    }
    for (const el of sample('button, .btn, .button, a[class*="btn" i], a[class*="button" i], input[type="submit"]', 30)) {
      const s = getComputedStyle(el);
      addColor(s.backgroundColor, 'button-background');
      addColor(s.color, 'button-text');
    }
    for (const el of sample('a[href]', 60)) addColor(getComputedStyle(el).color, 'link');
    for (const el of sample('h1, h2', 12)) addColor(getComputedStyle(el).color, 'heading');
    for (const el of sample('footer', 2)) addColor(getComputedStyle(el).backgroundColor, 'footer-background');
    const rootStyle = getComputedStyle(document.documentElement);
    for (let i = 0; i < rootStyle.length && i < 400; i += 1) {
      const prop = rootStyle[i]!;
      if (!prop.startsWith('--') || !/(color|primary|secondary|accent|brand|theme)/i.test(prop)) continue;
      addColor(rootStyle.getPropertyValue(prop), `var(${prop})`);
    }
    const colors = [...colorCounts.values()].sort((a, b) => b.count - a.count).slice(0, 30);

    const fonts: Array<{ family: string; usage: string }> = [];
    const addFont = (el: Element | null, usage: string) => {
      if (!el) return;
      const family = getComputedStyle(el).fontFamily.split(',')[0]?.replace(/["']/g, '').trim();
      if (family && !fonts.some((f) => f.family === family && f.usage === usage)) fonts.push({ family, usage });
    };
    addFont(document.body, 'body');
    addFont(document.querySelector('h1'), 'heading');
    addFont(document.querySelector('h2'), 'heading');
    addFont(document.querySelector('nav a, header a'), 'navigation');
    addFont(document.querySelector('button, .btn'), 'button');

    const logoCandidates: SiteLogoCandidate[] = [];
    const seenLogo = new Set<string>();
    const addLogo = (candidate: SiteLogoCandidate) => {
      if (!candidate.url || seenLogo.has(candidate.url) || logoCandidates.length >= 10) return;
      seenLogo.add(candidate.url);
      logoCandidates.push(candidate);
    };
    document.querySelectorAll('img').forEach((img) => {
      const blob = `${img.alt} ${img.className} ${img.id} ${img.getAttribute('src') ?? ''}`.toLowerCase();
      const inHeader = !!img.closest('header, nav, [class*="header" i], [id*="header" i]');
      if (!blob.includes('logo') && !inHeader) return;
      const rect = img.getBoundingClientRect();
      if (rect.width < 16 || rect.height < 12) return;
      addLogo({
        url: abs(img.currentSrc || img.getAttribute('src')),
        alt: clip(img.alt, 120) || undefined,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        inHeader,
        source: 'img',
      });
    });
    document.querySelectorAll('svg image[href], svg image').forEach((image) => {
      const href = image.getAttribute('href') || image.getAttribute('xlink:href');
      const svg = image.closest('svg');
      const blob = `${svg?.getAttribute('class') ?? ''} ${svg?.id ?? ''} ${svg?.getAttribute('aria-label') ?? ''}`.toLowerCase();
      if (href && blob.includes('logo')) addLogo({ url: abs(href), inHeader: !!svg?.closest('header, nav'), source: 'svg' });
    });
    document.querySelectorAll('link[rel~="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]').forEach((l) => {
      addLogo({ url: abs(l.getAttribute('href')), inHeader: false, source: 'apple-touch-icon' });
    });
    document.querySelectorAll('link[rel~="icon"]').forEach((l) => {
      addLogo({ url: abs(l.getAttribute('href')), inHeader: false, source: 'icon' });
    });
    const og = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
    if (og) addLogo({ url: abs(og), inHeader: false, source: 'og:image' });

    return {
      title: clip(document.title, 300) || null,
      description: clip(document.querySelector('meta[name="description" i]')?.getAttribute('content'), 500) || null,
      lang: document.documentElement.getAttribute('lang') || null,
      visibleText: fullText.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxText),
      meta,
      jsonLd,
      links,
      colors,
      fonts,
      logoCandidates,
      fullTextLength: fullText.trim().length,
    };
  }, MAX_VISIBLE_TEXT);
}

/** Approximate visible text length of raw HTML (no JS), to spot pages rendered client-side. */
export function sourceTextLength(html: string): number {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

export function emptyEvidence(): SiteEvidence {
  return {
    title: null,
    description: null,
    lang: null,
    visibleText: '',
    meta: {},
    jsonLd: [],
    links: { tel: [], mailto: [], whatsapp: [], social: [] },
    colors: [],
    fonts: [],
    logoCandidates: [],
    sourceTextLength: 0,
    renderedTextLength: 0,
  };
}
