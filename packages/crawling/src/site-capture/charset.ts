import type { CharsetSource } from '@moncha/domain';

function canonical(label: string | undefined | null): string | null {
  if (!label) return null;
  try {
    return new TextDecoder(label.trim().toLowerCase()).encoding;
  } catch {
    return null;
  }
}

/** HTML encoding sniffing: BOM, then Content-Type charset, then a <meta> prescan of the first 1024 bytes. */
export function detectCharset(
  bytes: Uint8Array,
  contentType?: string | null,
): { charset: string; source: CharsetSource } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { charset: 'utf-8', source: 'bom' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { charset: 'utf-16be', source: 'bom' };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { charset: 'utf-16le', source: 'bom' };

  const fromHeader = canonical(/charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? '')?.[1]);
  if (fromHeader) return { charset: fromHeader, source: 'header' };

  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  const meta = /<meta\b[^>]*?charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head)?.[1];
  const fromMeta = canonical(meta);
  // A page cannot declare itself UTF-16 in an ASCII meta tag; browsers treat that as UTF-8.
  if (fromMeta) return { charset: fromMeta.startsWith('utf-16') ? 'utf-8' : fromMeta, source: 'meta' };

  return { charset: 'utf-8', source: 'default' };
}

export function decodeText(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

/** Tags and attribute names are plain ASCII bytes in these encodings, so byte offsets are safe to splice. */
export function isAsciiCompatible(charset: string): boolean {
  return !charset.toLowerCase().startsWith('utf-16');
}

export const toLatin1 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');
export const fromLatin1 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'latin1'));

/** Decodes a latin1 slice (raw bytes) with the document's real charset. */
export function decodeLatin1Slice(slice: string, charset: string): string {
  return decodeText(Buffer.from(slice, 'latin1'), charset);
}
