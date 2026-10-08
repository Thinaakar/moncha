export type SrcsetCandidate = { url: string; start: number; end: number };

const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

/** URL spans of a srcset value (HTML "parse a srcset attribute"); descriptors are left in place. */
export function parseSrcset(value: string): SrcsetCandidate[] {
  const out: SrcsetCandidate[] = [];
  let i = 0;
  const n = value.length;
  while (i < n) {
    while (i < n && (isSpace(value[i]!) || value[i] === ',')) i += 1;
    if (i >= n) break;
    const start = i;
    while (i < n && !isSpace(value[i]!)) i += 1;
    let end = i;
    let url = value.slice(start, end);
    if (url.endsWith(',')) {
      while (end > start && value[end - 1] === ',') end -= 1;
      url = value.slice(start, end);
      if (url) out.push({ url, start, end });
      continue;
    }
    if (url) out.push({ url, start, end });
    let depth = 0;
    while (i < n) {
      const c = value[i]!;
      if (c === '(') depth += 1;
      else if (c === ')') depth = Math.max(0, depth - 1);
      else if (c === ',' && depth === 0) {
        i += 1;
        break;
      }
      i += 1;
    }
  }
  return out;
}
