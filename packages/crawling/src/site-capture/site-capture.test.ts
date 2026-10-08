import { describe, expect, it } from 'vitest';
import { assetStoragePath, classifyAsset, relativeStoredPath } from './asset-paths';
import { detectCharset, fromLatin1, toLatin1 } from './charset';
import { findCssUrls } from './css-urls';
import { scanHtml } from './html-urls';
import { collectCssUrls, collectHtmlUrls, rewriteCss, rewriteHtml, splice, type UrlResolver } from './rewriter';
import { isInlineOrNonFetchable, isTrackingUrl } from './skip-rules';
import { parseSrcset } from './srcset';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

/** Maps every absolute URL to `assets/<last segment>` relative to index.html. */
const flatResolver: UrlResolver = (abs) => {
  const name = new URL(abs).pathname.split('/').filter(Boolean).pop() ?? 'index';
  return `assets/${name}`;
};

describe('charset', () => {
  it('prefers BOM, then header, then meta', () => {
    expect(detectCharset(new Uint8Array([0xef, 0xbb, 0xbf, 0x3c]), 'text/html; charset=iso-8859-1')).toEqual({
      charset: 'utf-8',
      source: 'bom',
    });
    expect(detectCharset(enc('<meta charset="shift_jis">'), 'text/html; charset=windows-1252').source).toBe('header');
    expect(detectCharset(enc('<meta charset="shift_jis">'), 'text/html')).toEqual({ charset: 'shift_jis', source: 'meta' });
    expect(
      detectCharset(enc('<meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1">'), null).charset,
    ).toBe('windows-1252');
    expect(detectCharset(enc('<html>'), null)).toEqual({ charset: 'utf-8', source: 'default' });
  });

  it('treats a meta utf-16 declaration as utf-8', () => {
    expect(detectCharset(enc('<meta charset="utf-16">'), null).charset).toBe('utf-8');
  });
});

describe('srcset', () => {
  it('splits candidates and keeps descriptors out of the span', () => {
    const value = 'a.jpg 1x, /b/c.jpg?w=2 2x,https://x.com/d.jpg 800w';
    const parts = parseSrcset(value);
    expect(parts.map((p) => p.url)).toEqual(['a.jpg', '/b/c.jpg?w=2', 'https://x.com/d.jpg']);
    for (const p of parts) expect(value.slice(p.start, p.end)).toBe(p.url);
  });

  it('handles data URLs with commas', () => {
    const parts = parseSrcset('data:image/png;base64,AAA= 1x, b.png 2x');
    expect(parts.map((p) => p.url)).toEqual(['data:image/png;base64,AAA=', 'b.png']);
  });
});

describe('css urls', () => {
  it('finds url(), @import and image-set, skipping comments', () => {
    const css = `@import "base.css";
/* url(ignored.png) */
@import url('print.css') print;
.a { background: url( "img/a.png" ) no-repeat, url(img/b\\(1\\).png); }
.b { background-image: image-set("c.png" 1x, url(d.png) 2x); }
.c { content: "url(nope.png)"; }`;
    const refs = findCssUrls(css);
    expect(refs.map((r) => r.url)).toEqual(['base.css', 'print.css', 'img/a.png', 'img/b(1).png', 'c.png', 'd.png']);
    expect(refs[0]!.kind).toBe('import');
    expect(css.slice(refs[3]!.start, refs[3]!.end)).toBe('img/b\\(1\\).png');
  });

  it('rewrites a stylesheet relative to its stored location', () => {
    const css = enc('a{background:url(../img/x.png)} b{background:url("data:image/png;base64,AA")}');
    const out = rewriteCss(css, 'https://site.com/css/main.css', () => '../site.com/img/x.png');
    expect(dec(out.bytes)).toBe('a{background:url(../site.com/img/x.png)} b{background:url("data:image/png;base64,AA")}');
    expect(collectCssUrls(css, 'https://site.com/css/main.css')).toEqual([{ url: 'https://site.com/img/x.png', kind: 'url' }]);
  });
});

describe('html scan', () => {
  it('collects asset attributes, lazy attributes, inline styles and style blocks', () => {
    const html = `<!doctype html><html><head>
<link rel="stylesheet" href="/css/site.css?v=3">
<link rel="icon" href="favicon.ico">
<link rel="canonical" href="https://site.com/">
<style>body{background:url('bg.jpg')}</style>
<script src="app.js"></script>
</head><body background="tile.gif">
<img src="logo.png" srcset="logo@2x.png 2x" alt="x">
<div data-src="lazy.jpg" style="background-image:url(&quot;hero.jpg&quot;)"></div>
<svg><use xlink:href="sprite.svg#icon"></use></svg>
<iframe src="https://www.youtube.com/embed/x"></iframe>
<a href="/contact">Contact</a>
</body></html>`;
    const scan = scanHtml(html);
    expect(scan.refs.map((r) => r.raw)).toEqual([
      '/css/site.css?v=3',
      'favicon.ico',
      'bg.jpg',
      'app.js',
      'tile.gif',
      'logo.png',
      'logo@2x.png',
      'lazy.jpg',
      'hero.jpg',
      'sprite.svg#icon',
    ]);
    expect(scan.iframes).toEqual(['https://www.youtube.com/embed/x']);
    for (const ref of scan.refs) {
      if (ref.attr === 'style') expect(html.slice(ref.start, ref.end)).toBe('hero.jpg');
    }
  });

  it('finds URLs inside template content', () => {
    const scan = scanHtml('<template><img src="t.png"></template>');
    expect(scan.refs.map((r) => r.raw)).toEqual(['t.png']);
  });
});

describe('rewriteHtml', () => {
  it('changes only URL spans and keeps every other byte', () => {
    const source = `<!DOCTYPE html>\r\n<html>\r\n<head>\r\n  <!-- keep me -->\r\n  <link rel=stylesheet href=/s.css>\r\n  <script>var a = "<img src=x.png>";</script>\r\n</head>\r\n<body>\r\n<img  SRC = 'https://cdn.site.com/i/a.png?x=1&amp;y=2'   alt="a">\r\n<a href="/page">p</a>\r\n</body>\r\n</html>\r\n`;
    const out = rewriteHtml(enc(source), 'utf-8', 'https://site.com/', flatResolver);
    const expected = source
      .replace('href=/s.css', 'href=assets/s.css')
      .replace("'https://cdn.site.com/i/a.png?x=1&amp;y=2'", "'assets/a.png'");
    expect(dec(out.bytes)).toBe(expected);
    expect(out.count).toBe(2);
  });

  it('keeps the original bytes of a Shift_JIS page', () => {
    // "日本" in Shift_JIS is 93 FA 96 7B.
    const head = enc('<html><head><meta charset="shift_jis"><title>');
    const title = new Uint8Array([0x93, 0xfa, 0x96, 0x7b]);
    const tail = enc('</title></head><body><img src="a.png"></body></html>');
    const source = new Uint8Array([...head, ...title, ...tail]);
    const out = rewriteHtml(source, 'shift_jis', 'https://site.jp/', flatResolver);
    const expected = new Uint8Array([...head, ...title, ...enc('</title></head><body><img src="assets/a.png"></body></html>')]);
    expect(Buffer.from(out.bytes).equals(Buffer.from(expected))).toBe(true);
  });

  it('resolves against <base href> and neutralizes it', () => {
    const source = '<html><head><base href="https://cdn.site.com/theme/"></head><body><img src="a.png"></body></html>';
    const seen: string[] = [];
    const out = rewriteHtml(enc(source), 'utf-8', 'https://site.com/', (abs) => {
      seen.push(abs);
      return 'assets/a.png';
    });
    expect(seen).toEqual(['https://cdn.site.com/theme/a.png']);
    expect(dec(out.bytes)).toBe('<html><head><base href="./"></head><body><img src="assets/a.png"></body></html>');
    expect(out.exceptions[0]!.kind).toBe('base_href_neutralized');
  });

  it('leaves unresolved, inline and non-http URLs untouched', () => {
    const source = '<img src="data:image/gif;base64,R0lG"><img src="missing.png"><a href="mailto:x@y.z">m</a>';
    const out = rewriteHtml(enc(source), 'utf-8', 'https://site.com/', () => null);
    expect(dec(out.bytes)).toBe(source);
    expect(out.unresolved).toEqual(['https://site.com/missing.png']);
  });

  it('copies UTF-16 pages unchanged with an exception', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x3c, 0x00]);
    const out = rewriteHtml(bytes, 'utf-16le', 'https://site.com/', flatResolver);
    expect(out.bytes).toBe(bytes);
    expect(out.exceptions[0]!.kind).toBe('rewrite_skipped_utf16');
  });

  it('collects absolute URLs once', () => {
    const r = collectHtmlUrls(enc('<img src="a.png"><img src="/a.png"><iframe src="/f"></iframe>'), 'utf-8', 'https://s.com/x/');
    expect(r.urls.map((u) => u.url)).toEqual(['https://s.com/x/a.png', 'https://s.com/a.png']);
    expect(r.iframes).toEqual(['https://s.com/f']);
  });
});

describe('asset paths', () => {
  it('maps URLs to safe stored paths', () => {
    expect(assetStoragePath('https://Site.com/wp-content/uploads/logo.png')).toBe('assets/site.com/wp-content/uploads/logo.png');
    expect(assetStoragePath('https://site.com:8080/a/')).toBe('assets/site.com_8080/a/index');
    expect(assetStoragePath('https://fonts.gstatic.com/s/x', 'font/woff2')).toBe('assets/fonts.gstatic.com/s/x.woff2');
    const q = assetStoragePath('https://site.com/style.css?ver=6.4');
    expect(q).toMatch(/^assets\/site\.com\/style~[0-9a-f]{8}\.css$/);
    expect(assetStoragePath('https://site.com/a%20b/../c.png')).toBe('assets/site.com/c.png');
    expect(assetStoragePath(`https://site.com/${'x'.repeat(300)}.png`)).toMatch(/^assets\/site\.com\/_long\/[0-9a-f]{16}\.png$/);
  });

  it('computes relative paths between stored files', () => {
    expect(relativeStoredPath('index.html', 'assets/site.com/a.png')).toBe('assets/site.com/a.png');
    expect(relativeStoredPath('assets/site.com/css/main.css', 'assets/site.com/img/x.png')).toBe('../img/x.png');
    expect(relativeStoredPath('assets/a.com/x.css', 'assets/b.com/y.woff2')).toBe('../b.com/y.woff2');
  });

  it('classifies assets', () => {
    expect(classifyAsset('https://s.com/a', 'text/css; charset=utf-8')).toBe('css');
    expect(classifyAsset('https://s.com/a.woff2', null)).toBe('font');
    expect(classifyAsset('https://s.com/favicon.ico', 'image/x-icon')).toBe('icon');
    expect(classifyAsset('https://s.com/a.png', 'image/png', 'icon')).toBe('icon');
  });
});

describe('skip rules', () => {
  it('detects tracking hosts', () => {
    expect(isTrackingUrl('https://www.googletagmanager.com/gtag/js?id=G-1')).toBe(true);
    expect(isTrackingUrl('https://connect.facebook.net/en_US/fbevents.js')).toBe(true);
    expect(isTrackingUrl('https://www.facebook.com/tr?id=1')).toBe(true);
    expect(isTrackingUrl('https://www.facebook.com/page')).toBe(false);
    expect(isTrackingUrl('https://fonts.googleapis.com/css2')).toBe(false);
  });

  it('flags inline and non-fetchable values', () => {
    expect(isInlineOrNonFetchable('data:image/png;base64,AA')).toBe('inline');
    expect(isInlineOrNonFetchable('blob:https://x')).toBe('blob');
    expect(isInlineOrNonFetchable('javascript:void(0)')).toBe('unsupported');
    expect(isInlineOrNonFetchable('#top')).toBe('fragment');
    expect(isInlineOrNonFetchable('/a.png')).toBeNull();
  });
});

describe('splice', () => {
  it('applies replacements in order and ignores overlaps', () => {
    expect(splice('abcdef', [{ start: 4, end: 5, text: 'X' }, { start: 1, end: 3, text: 'YY' }, { start: 2, end: 4, text: 'Z' }])).toBe(
      'aYYdXf',
    );
  });

  it('round-trips arbitrary bytes through latin1', () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect(Buffer.from(fromLatin1(toLatin1(bytes))).equals(Buffer.from(bytes))).toBe(true);
  });
});
