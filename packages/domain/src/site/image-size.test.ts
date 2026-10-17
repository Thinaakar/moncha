import { describe, expect, it } from 'vitest';
import { imageSize } from './image-size';

function bytes(length: number, fill: (b: Uint8Array, v: DataView) => void): Uint8Array {
  const b = new Uint8Array(length);
  fill(b, new DataView(b.buffer));
  return b;
}
const put = (b: Uint8Array, offset: number, text: string) => [...text].forEach((c, i) => (b[offset + i] = c.charCodeAt(0)));

describe('imageSize', () => {
  it('reads PNG and GIF headers', () => {
    const png = bytes(33, (b, v) => {
      b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      v.setUint32(16, 64);
      v.setUint32(20, 64);
    });
    expect(imageSize(png)).toEqual({ width: 64, height: 64 });
    const gif = bytes(13, (b, v) => {
      put(b, 0, 'GIF89a');
      v.setUint16(6, 120, true);
      v.setUint16(8, 40, true);
    });
    expect(imageSize(gif)).toEqual({ width: 120, height: 40 });
  });

  it('reads the largest ICO entry, 0 meaning 256', () => {
    const ico = bytes(6 + 32, (b, v) => {
      v.setUint16(2, 1, true);
      v.setUint16(4, 2, true);
      b[6] = 16;
      b[7] = 16;
      b[22] = 0;
      b[23] = 0;
    });
    expect(imageSize(ico)).toEqual({ width: 256, height: 256 });
  });

  it('reads WebP VP8X and JPEG SOF sizes', () => {
    const webp = bytes(30, (b) => {
      put(b, 0, 'RIFF');
      put(b, 8, 'WEBP');
      put(b, 12, 'VP8X');
      b.set([191, 0, 0], 24);
      b.set([191, 0, 0], 27);
    });
    expect(imageSize(webp)).toEqual({ width: 192, height: 192 });
    const jpeg = bytes(30, (b, v) => {
      b.set([0xff, 0xd8, 0xff, 0xe0]);
      v.setUint16(4, 4);
      b.set([0xff, 0xc0], 8);
      v.setUint16(10, 17);
      b[12] = 8;
      v.setUint16(13, 300);
      v.setUint16(15, 400);
    });
    expect(imageSize(jpeg)).toEqual({ width: 400, height: 300 });
  });

  it('returns null for SVG and unknown data', () => {
    expect(imageSize(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
