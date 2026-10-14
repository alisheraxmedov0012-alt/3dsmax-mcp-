import { describe, expect, it } from 'vitest';
import {
  IMAGE_ERROR_MESSAGES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  sniffImageFormat,
  validateImageContent,
  validateImageDimensions,
} from './imageFile';

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

/** Minimal valid magic-byte headers (content sniffing only checks the header). */
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0, 0, 0];
const WEBP_HEADER = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

describe('sniffImageFormat', () => {
  it('detects png, jpeg and webp from magic bytes', () => {
    expect(sniffImageFormat(bytes(...PNG_HEADER))).toBe('png');
    expect(sniffImageFormat(bytes(...JPEG_HEADER))).toBe('jpeg');
    expect(sniffImageFormat(bytes(...WEBP_HEADER))).toBe('webp');
  });

  it('returns null for non-image content', () => {
    expect(sniffImageFormat(bytes(0x25, 0x50, 0x44, 0x46))).toBeNull(); // "%PDF"
    expect(sniffImageFormat(bytes(0x47, 0x49, 0x46))).toBeNull(); // "GIF"
    expect(sniffImageFormat(new ArrayBuffer(0))).toBeNull();
  });
});

describe('validateImageContent', () => {
  it('accepts a real image and reports its format', () => {
    const result = validateImageContent({ buffer: bytes(...PNG_HEADER) });
    expect(result).toEqual({ ok: true, format: 'png', bytes: PNG_HEADER.length });
  });

  it('rejects an empty buffer', () => {
    const result = validateImageContent({ buffer: new ArrayBuffer(0) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('empty');
  });

  it('rejects an oversized file before inspecting content', () => {
    const buffer = new ArrayBuffer(MAX_IMAGE_BYTES + 1);
    new Uint8Array(buffer).set(PNG_HEADER);
    const result = validateImageContent({ buffer });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('too_large');
  });

  it('rejects content that is not a supported image', () => {
    const result = validateImageContent({ buffer: bytes(0x00, 0x01, 0x02, 0x03) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('corrupt');
  });

  it('never trusts the declared MIME: real content wins', () => {
    // Declares PNG but the bytes are JPEG -> mismatch is rejected.
    const mismatch = validateImageContent({
      buffer: bytes(...JPEG_HEADER),
      declaredMime: 'image/png',
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.code).toBe('mime_mismatch');

    // A used-in-the-wild "image/pjpeg" declaration is not trusted either.
    const wrong = validateImageContent({
      buffer: bytes(...JPEG_HEADER),
      declaredMime: 'application/pdf',
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.code).toBe('unsupported_format');
  });

  it('has a user-facing message for every rejection', () => {
    for (const message of Object.values(IMAGE_ERROR_MESSAGES)) {
      expect(message.length).toBeGreaterThan(0);
    }
  });
});

describe('validateImageDimensions', () => {
  it('accepts sane dimensions', () => {
    expect(validateImageDimensions(1920, 1080)).toEqual({ ok: true, width: 1920, height: 1080 });
  });

  it('rejects zero, negative or non-finite dimensions', () => {
    for (const [w, h] of [
      [0, 100],
      [100, 0],
      [-10, 100],
      [Number.NaN, 100],
      [100, Number.POSITIVE_INFINITY],
    ]) {
      const result = validateImageDimensions(w, h);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('decode_failed');
    }
  });

  it('rejects dimensions above the caps', () => {
    const tooWide = validateImageDimensions(MAX_IMAGE_DIMENSION + 1, 10);
    expect(tooWide.ok).toBe(false);
    if (!tooWide.ok) expect(tooWide.code).toBe('dimensions_too_large');

    const tooManyPixels = validateImageDimensions(8000, 8000);
    expect(tooManyPixels.ok).toBe(false);
    if (!tooManyPixels.ok) expect(tooManyPixels.code).toBe('dimensions_too_large');
    expect(8000 * 8000).toBeGreaterThan(MAX_IMAGE_PIXELS);
  });
});
