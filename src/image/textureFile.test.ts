import { describe, expect, it } from 'vitest';
import {
  MAX_TEXTURE_BYTES,
  MAX_TEXTURE_DIMENSION,
  MAX_TEXTURE_PIXELS,
  sniffTextureDimensions,
  validateTextureFileContent,
} from './textureFile';

function bytes(length = 64): Uint8Array {
  return new Uint8Array(length);
}

function png(width: number, height: number): ArrayBuffer {
  const buffer = bytes(33);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buffer.set([0, 0, 0, 13], 8);
  buffer.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(buffer.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return buffer.buffer as ArrayBuffer;
}

function jpeg(width: number, height: number): ArrayBuffer {
  const buffer = bytes(24);
  buffer.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  buffer[7] = (height >> 8) & 0xff;
  buffer[8] = height & 0xff;
  buffer[9] = (width >> 8) & 0xff;
  buffer[10] = width & 0xff;
  return buffer.buffer as ArrayBuffer;
}

function webp(width: number, height: number): ArrayBuffer {
  const buffer = bytes(30);
  buffer.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  buffer.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  buffer.set([0x56, 0x50, 0x38, 0x58], 12); // VP8X
  const w = width - 1;
  const h = height - 1;
  buffer[24] = w & 0xff;
  buffer[25] = (w >> 8) & 0xff;
  buffer[26] = (w >> 16) & 0xff;
  buffer[27] = h & 0xff;
  buffer[28] = (h >> 8) & 0xff;
  buffer[29] = (h >> 16) & 0xff;
  return buffer.buffer as ArrayBuffer;
}

describe('validateTextureFileContent', () => {
  it('accepts PNG, JPEG and WebP headers and reports their size', () => {
    for (const [buffer, mime, format] of [
      [png(800, 600), 'image/png', 'png'],
      [jpeg(320, 200), 'image/jpeg', 'jpeg'],
      [webp(512, 256), 'image/webp', 'webp'],
    ] as const) {
      const result = validateTextureFileContent({ buffer, declaredMime: mime });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.format).toBe(format);
        expect(result.width).toBe(format === 'jpeg' ? 320 : format === 'webp' ? 512 : 800);
        expect(result.height).toBe(format === 'jpeg' ? 200 : format === 'webp' ? 256 : 600);
      }
    }
  });

  it('rejects SVG and GIF before decoding', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const gif = new TextEncoder().encode('GIF89a......');
    for (const buffer of [svg.buffer, gif.buffer]) {
      const result = validateTextureFileContent({ buffer });
      expect(result).toMatchObject({ ok: false, code: 'unsupported_format' });
    }
  });

  it('rejects a declared MIME that disagrees with the bytes', () => {
    const result = validateTextureFileContent({
      buffer: jpeg(20, 20),
      declaredMime: 'image/png',
    });
    expect(result).toMatchObject({ ok: false, code: 'mime_mismatch' });
  });

  it('rejects animated PNG and WebP before decoding', () => {
    const apng = bytes(48);
    apng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    apng.set([0, 0, 0, 13], 8);
    apng.set([0x49, 0x48, 0x44, 0x52], 12);
    const view = new DataView(apng.buffer);
    view.setUint32(16, 10);
    view.setUint32(20, 10);
    apng.set([0, 0, 0, 8], 33);
    apng.set([0x61, 0x63, 0x54, 0x4c], 37); // acTL
    expect(
      validateTextureFileContent({ buffer: apng.buffer as ArrayBuffer, declaredMime: 'image/png' }),
    ).toMatchObject({ ok: false, code: 'unsupported_format' });

    const animatedWebp = webp(64, 64);
    new Uint8Array(animatedWebp)[20] = 0x02;
    expect(
      validateTextureFileContent({
        buffer: animatedWebp,
        declaredMime: 'image/webp',
      }),
    ).toMatchObject({ ok: false, code: 'unsupported_format' });
  });

  it('rejects unknown content', () => {
    const result = validateTextureFileContent({ buffer: bytes(32).buffer as ArrayBuffer });
    expect(result).toMatchObject({ ok: false, code: 'corrupt' });
  });

  it('rejects files above the 8 MB limit', () => {
    const buffer = new Uint8Array(MAX_TEXTURE_BYTES + 1);
    buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const result = validateTextureFileContent({ buffer: buffer.buffer });
    expect(result).toMatchObject({ ok: false, code: 'too_large' });
  });

  it('rejects dimensions above the per-side and pixel caps', () => {
    expect(
      validateTextureFileContent({
        buffer: png(MAX_TEXTURE_DIMENSION + 1, 10),
        declaredMime: 'image/png',
      }),
    ).toMatchObject({ ok: false, code: 'dimensions_too_large' });

    expect(
      validateTextureFileContent({
        buffer: png(MAX_TEXTURE_DIMENSION, MAX_TEXTURE_DIMENSION),
        declaredMime: 'image/png',
      }),
    ).toMatchObject({ ok: false, code: 'dimensions_too_large' });
    expect(MAX_TEXTURE_DIMENSION * MAX_TEXTURE_DIMENSION).toBeGreaterThan(MAX_TEXTURE_PIXELS);
  });

  it('rejects a header whose dimensions cannot be read', () => {
    const truncated = png(100, 100).slice(0, 16);
    const result = validateTextureFileContent({ buffer: truncated });
    expect(result).toMatchObject({ ok: false, code: 'corrupt' });
  });
});

describe('sniffTextureDimensions', () => {
  it('reads each supported format', () => {
    expect(sniffTextureDimensions(png(640, 480), 'png')).toEqual({ width: 640, height: 480 });
    expect(sniffTextureDimensions(jpeg(300, 150), 'jpeg')).toEqual({ width: 300, height: 150 });
    expect(sniffTextureDimensions(webp(128, 64), 'webp')).toEqual({ width: 128, height: 64 });
  });
});
