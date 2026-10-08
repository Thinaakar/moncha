export type CssUrlRef = {
  /** Unescaped URL text. */
  url: string;
  /** Span of the raw (escaped) URL text inside the stylesheet. */
  start: number;
  end: number;
  kind: 'url' | 'import';
};

const isIdentChar = (c: string | undefined) => !!c && /[\w-]/.test(c);
const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

function unescapeCss(raw: string): string {
  return raw.replace(/\\([0-9a-fA-F]{1,6})\s?|\\(.)/g, (_m, hex: string | undefined, ch: string | undefined) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : (ch ?? ''),
  );
}

/** Reads a quoted string starting at `i` (the quote). Returns the inner span and the index after the closing quote. */
function readString(css: string, i: number): { start: number; end: number; next: number } {
  const quote = css[i];
  let j = i + 1;
  while (j < css.length && css[j] !== quote && css[j] !== '\n') {
    if (css[j] === '\\') j += 1;
    j += 1;
  }
  return { start: i + 1, end: Math.min(j, css.length), next: Math.min(j + 1, css.length) };
}

function startsWithAt(css: string, i: number, word: string): boolean {
  return css.slice(i, i + word.length).toLowerCase() === word;
}

/** Finds url(), @import "..." and image-set("...") references in CSS, skipping comments. */
export function findCssUrls(css: string): CssUrlRef[] {
  const refs: CssUrlRef[] = [];
  let i = 0;
  let imageSetDepth = 0;
  let parenDepth = 0;
  const n = css.length;

  while (i < n) {
    const c = css[i]!;
    if (c === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      i = close < 0 ? n : close + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const s = readString(css, i);
      if (imageSetDepth > 0) {
        const raw = css.slice(s.start, s.end);
        if (raw.trim()) refs.push({ url: unescapeCss(raw).trim(), start: s.start, end: s.end, kind: 'url' });
      }
      i = s.next;
      continue;
    }
    if (c === '@' && startsWithAt(css, i, '@import') && !isIdentChar(css[i + 7])) {
      let j = i + 7;
      while (isSpace(css[j])) j += 1;
      if (css[j] === '"' || css[j] === "'") {
        const s = readString(css, j);
        const raw = css.slice(s.start, s.end);
        if (raw.trim()) refs.push({ url: unescapeCss(raw).trim(), start: s.start, end: s.end, kind: 'import' });
        i = s.next;
        continue;
      }
      i = j;
      continue;
    }
    if ((c === 'u' || c === 'U') && startsWithAt(css, i, 'url(') && !isIdentChar(css[i - 1])) {
      let j = i + 4;
      while (isSpace(css[j])) j += 1;
      if (css[j] === '"' || css[j] === "'") {
        const s = readString(css, j);
        const raw = css.slice(s.start, s.end);
        if (raw.trim()) refs.push({ url: unescapeCss(raw).trim(), start: s.start, end: s.end, kind: 'url' });
        let k = s.next;
        while (k < n && css[k] !== ')') k += 1;
        i = k + 1;
        continue;
      }
      const start = j;
      while (j < n && css[j] !== ')') {
        if (css[j] === '\\') j += 1;
        j += 1;
      }
      let end = Math.min(j, n);
      while (end > start && isSpace(css[end - 1])) end -= 1;
      const raw = css.slice(start, end);
      if (raw) refs.push({ url: unescapeCss(raw), start, end, kind: 'url' });
      i = j + 1;
      continue;
    }
    if (
      (c === 'i' || c === 'I' || c === '-') &&
      !isIdentChar(css[i - 1]) &&
      (startsWithAt(css, i, 'image-set(') || startsWithAt(css, i, '-webkit-image-set('))
    ) {
      const len = css[i] === '-' ? '-webkit-image-set('.length : 'image-set('.length;
      imageSetDepth += 1;
      parenDepth = 1;
      i += len;
      continue;
    }
    if (imageSetDepth > 0) {
      if (c === '(') parenDepth += 1;
      else if (c === ')') {
        parenDepth -= 1;
        if (parenDepth <= 0) imageSetDepth = 0;
      }
    }
    i += 1;
  }
  return refs;
}
