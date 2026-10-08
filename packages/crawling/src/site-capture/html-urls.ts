import { parse, type DefaultTreeAdapterMap } from 'parse5';
import type { SiteAssetKind } from '@moncha/domain';
import { findCssUrls } from './css-urls';
import { parseSrcset } from './srcset';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];

export type HtmlUrlRef = {
  /** URL text with HTML entities decoded (still in latin1 byte form). */
  raw: string;
  /** Span of the raw bytes to replace. */
  start: number;
  end: number;
  /** How a replacement must be written. */
  context: 'attr' | 'css';
  tag: string;
  attr: string;
  hint?: SiteAssetKind;
};

export type HtmlScan = {
  refs: HtmlUrlRef[];
  base?: { raw: string; start: number; end: number };
  iframes: string[];
};

const LAZY_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-bg', 'data-background'];
const LAZY_SRCSET_ATTRS = ['data-srcset', 'data-lazy-srcset'];
const LINK_RELS = new Set([
  'stylesheet',
  'icon',
  'shortcut',
  'apple-touch-icon',
  'apple-touch-icon-precomposed',
  'mask-icon',
  'preload',
  'modulepreload',
  'manifest',
]);

/** `url(&quot;x&quot;)` inside a style attribute: the quotes are entities, not CSS quotes. */
const ENTITY_QUOTED = /^(&quot;|&#0*34;|&#x0*22;|&apos;|&#0*39;|&#x0*27;)[\s\S]*\1$/i;

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: '\u00a0' };

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Offsets of an attribute value inside `name="value"` raw source. */
function valueSpan(html: string, start: number, end: number): { start: number; end: number } | null {
  const raw = html.slice(start, end);
  const eq = raw.indexOf('=');
  if (eq < 0) return null;
  let i = eq + 1;
  while (i < raw.length && /\s/.test(raw[i]!)) i += 1;
  const q = raw[i];
  if (q === '"' || q === "'") {
    const close = raw.lastIndexOf(q);
    if (close <= i) return null;
    return { start: start + i + 1, end: start + close };
  }
  let j = raw.length;
  while (j > i && /\s/.test(raw[j - 1]!)) j -= 1;
  return { start: start + i, end: start + j };
}

function attrValue(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => (a.prefix ? `${a.prefix}:${a.name}` : a.name) === name)?.value;
}

function locate(html: string, el: Element, name: string) {
  const loc = el.sourceCodeLocation?.attrs?.[name];
  if (!loc) return null;
  return valueSpan(html, loc.startOffset, loc.endOffset);
}

function hintFor(tag: string, attr: string, rel?: string): SiteAssetKind | undefined {
  if (tag === 'link') {
    if (rel?.includes('stylesheet')) return 'css';
    if (rel?.includes('manifest')) return 'manifest';
    if (rel?.includes('icon')) return 'icon';
    return undefined;
  }
  if (tag === 'script') return 'js';
  if (tag === 'img' || attr === 'poster' || attr === 'background') return 'image';
  if (tag === 'video' || tag === 'audio' || tag === 'track') return 'media';
  return undefined;
}

/**
 * Finds every asset URL in a document decoded as latin1 (one char per byte), so offsets are byte
 * offsets of the original file. Iframe sources are reported but not rewritten.
 */
export function scanHtml(html: string): HtmlScan {
  const doc = parse(html, { sourceCodeLocationInfo: true });
  const refs: HtmlUrlRef[] = [];
  const iframes: string[] = [];
  let base: HtmlScan['base'];

  const addAttr = (el: Element, attr: string, hint?: SiteAssetKind) => {
    const value = attrValue(el, attr);
    if (value === undefined || !value.trim()) return;
    const span = locate(html, el, attr);
    if (!span) return;
    refs.push({ raw: value.trim(), start: span.start, end: span.end, context: 'attr', tag: el.tagName, attr, hint });
  };

  const addSrcset = (el: Element, attr: string) => {
    const span = locate(html, el, attr);
    if (!span) return;
    const rawValue = html.slice(span.start, span.end);
    for (const c of parseSrcset(rawValue)) {
      refs.push({
        raw: decodeEntities(c.url),
        start: span.start + c.start,
        end: span.start + c.end,
        context: 'attr',
        tag: el.tagName,
        attr,
        hint: 'image',
      });
    }
  };

  const addCss = (css: string, offset: number, tag: string, attr: string, entityEncoded: boolean) => {
    for (const ref of findCssUrls(css)) {
      let { start, end } = ref;
      let raw = ref.url;
      if (entityEncoded) {
        const quoted = ENTITY_QUOTED.exec(css.slice(start, end));
        if (quoted) {
          start += quoted[1]!.length;
          end -= quoted[1]!.length;
          raw = css.slice(start, end);
        }
        raw = decodeEntities(raw);
      }
      refs.push({
        raw,
        start: offset + start,
        end: offset + end,
        context: 'css',
        tag,
        attr,
        hint: ref.kind === 'import' ? 'css' : undefined,
      });
    }
  };

  const visit = (node: Node) => {
    if ('tagName' in node) {
      const el = node;
      const tag = el.tagName;
      const rel = (attrValue(el, 'rel') ?? '').toLowerCase();

      switch (tag) {
        case 'img':
          addAttr(el, 'src', 'image');
          addSrcset(el, 'srcset');
          break;
        case 'source':
          addAttr(el, 'src');
          addSrcset(el, 'srcset');
          break;
        case 'script':
          addAttr(el, 'src', 'js');
          break;
        case 'link':
          if (rel.split(/\s+/).some((r) => LINK_RELS.has(r))) addAttr(el, 'href', hintFor('link', 'href', rel));
          if (rel.includes('preload') || rel.includes('icon')) addSrcset(el, 'imagesrcset');
          break;
        case 'video':
          addAttr(el, 'src', 'media');
          addAttr(el, 'poster', 'image');
          break;
        case 'audio':
        case 'track':
        case 'embed':
          addAttr(el, 'src', hintFor(tag, 'src'));
          break;
        case 'object':
          addAttr(el, 'data');
          break;
        case 'input':
          if ((attrValue(el, 'type') ?? '').toLowerCase() === 'image') addAttr(el, 'src', 'image');
          break;
        case 'use':
        case 'image':
          addAttr(el, 'href', 'image');
          addAttr(el, 'xlink:href', 'image');
          break;
        case 'body':
        case 'table':
        case 'td':
        case 'th':
          addAttr(el, 'background', 'image');
          break;
        case 'iframe': {
          const src = attrValue(el, 'src');
          if (src?.trim()) iframes.push(src.trim());
          break;
        }
        case 'base': {
          const href = attrValue(el, 'href');
          const span = locate(html, el, 'href');
          if (href !== undefined && span && !base) base = { raw: href.trim(), start: span.start, end: span.end };
          break;
        }
        case 'style': {
          const text = el.childNodes.find((c) => c.nodeName === '#text');
          const loc = text?.sourceCodeLocation;
          if (loc) addCss(html.slice(loc.startOffset, loc.endOffset), loc.startOffset, 'style', '#text', false);
          break;
        }
        default:
          break;
      }

      for (const attr of LAZY_ATTRS) addAttr(el, attr, 'image');
      for (const attr of LAZY_SRCSET_ATTRS) addSrcset(el, attr);

      const styleSpan = locate(html, el, 'style');
      if (styleSpan) addCss(html.slice(styleSpan.start, styleSpan.end), styleSpan.start, tag, 'style', true);

      if (tag === 'template' && 'content' in el) visit((el as DefaultTreeAdapterMap['template']).content);
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child);
  };

  visit(doc);
  refs.sort((a, b) => a.start - b.start);
  return { refs: dedupeOverlaps(refs), base, iframes };
}

function dedupeOverlaps(refs: HtmlUrlRef[]): HtmlUrlRef[] {
  const out: HtmlUrlRef[] = [];
  let lastEnd = -1;
  for (const ref of refs) {
    if (ref.start < lastEnd) continue;
    out.push(ref);
    lastEnd = ref.end;
  }
  return out;
}
