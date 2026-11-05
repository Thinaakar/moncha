export type ImageSize = { width: number; height: number };

/** `ispe` (image spatial extent) box of an AVIF/HEIF file, searched in its header. */
function avifSize(bytes: Uint8Array, view: DataView): ImageSize | null {
  const end = Math.min(bytes.length - 20, 64 * 1024);
  for (let o = 12; o < end; o++) {
    if (bytes[o] === 0x69 && bytes[o + 1] === 0x73 && bytes[o + 2] === 0x70 && bytes[o + 3] === 0x65) {
      const width = view.getUint32(o + 8);
      const height = view.getUint32(o + 12);
      return width && height ? { width, height } : null;
    }
  }
  return null;
}

/** Root `<svg>` width/height in px (or plain numbers), else its viewBox. */
function svgSize(bytes: Uint8Array): ImageSize | null {
  const text = new TextDecoder().decode(bytes.subarray(0, 4096));
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) return null;
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1]?.trim();
  const px = (value: string | undefined) => {
    const m = value ? /^(\d+(?:\.\d+)?)(px)?$/i.exec(value) : null;
    return m ? Number(m[1]) : null;
  };
  const width = px(attr('width'));
  const height = px(attr('height'));
  if (width && height) return { width, height };
  const box = attr('viewBox')?.split(/[\s,]+/).map(Number);
  if (box?.length === 4 && box[2]! > 0 && box[3]! > 0) return { width: box[2]!, height: box[3]! };
  return null;
}

/**
 * Pixel size read from the file header: PNG, GIF, WebP, JPEG, AVIF, ICO (its largest entry) and SVG (width/height
 * or viewBox). Null for anything unreadable.
 */
export function imageSize(bytes: Uint8Array): ImageSize | null {
  const n = bytes.length;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));

  if (n >= 32 && ascii(4, 4) === 'ftyp' && /^(avif|avis|mif1|heic)$/.test(ascii(8, 4))) return avifSize(bytes, view);
  if (n >= 4 && /<svg\b/i.test(new TextDecoder().decode(bytes.subarray(0, Math.min(n, 1024))))) return svgSize(bytes);

  if (n >= 24 && bytes[0] === 0x89 && ascii(1, 3) === 'PNG') {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (n >= 10 && ascii(0, 3) === 'GIF') {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (n >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') {
      const u24 = (o: number) => bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16);
      return { width: u24(24) + 1, height: u24(27) + 1 };
    }
    return null;
  }
  if (n >= 6 && view.getUint16(0, true) === 0 && view.getUint16(2, true) === 1) {
    const count = view.getUint16(4, true);
    if (!count || n < 6 + 16 * count) return null;
    let best: ImageSize | null = null;
    for (let i = 0; i < count; i++) {
      const o = 6 + 16 * i;
      const size = { width: bytes[o]! || 256, height: bytes[o + 1]! || 256 };
      if (!best || size.width * size.height > best.width * best.height) best = size;
    }
    return best;
  }
  if (n >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let o = 2;
    while (o + 9 < n) {
      if (bytes[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = bytes[o + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: view.getUint16(o + 7), height: view.getUint16(o + 5) };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
        o += marker === 0xff ? 1 : 2;
        continue;
      }
      o += 2 + view.getUint16(o + 2);
    }
  }
  return null;
}
