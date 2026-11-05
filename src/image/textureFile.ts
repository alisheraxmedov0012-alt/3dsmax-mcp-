/**
 * Phase 4.3B — client-side texture validation.
 *
 * Validation happens before decoding so a huge/crafted image cannot allocate a
 * bitmap in the tab. It mirrors the server limits, but the server remains the
 * authority; this is a UX and resource guard, not a replacement.
 */
import {
  validateImageContent,
  type ImageFormat,
  type ImageRejectionCode,
} from './imageFile';

export const MAX_TEXTURE_BYTES = 8 * 1024 * 1024;
export const MAX_TEXTURE_DIMENSION = 4096;
export const MAX_TEXTURE_PIXELS = 16_000_000;

export interface TextureFileOk {
  ok: true;
  format: ImageFormat;
  width: number;
  height: number;
  bytes: number;
}

export interface TextureFileError {
  ok: false;
  code: ImageRejectionCode;
  message: string;
}

export type TextureFileResult = TextureFileOk | TextureFileError;

interface Dimensions {
  width: number;
  height: number;
}

function invalidDimensions(): TextureFileError {
  return {
    ok: false,
    code: 'dimensions_too_large',
    message: `Rasm ${MAX_TEXTURE_DIMENSION}px va ${
      MAX_TEXTURE_PIXELS / 1_000_000
    } MP chegarasidan katta.`,
  };
}

function corruptHeader(): TextureFileError {
  return {
    ok: false,
    code: 'corrupt',
    message: "Rasm sarlavhasidan o'lchamni o'qib bo'lmadi.",
  };
}

function pngDimensions(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 24) return null;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((value, index) => bytes[index] === value)) return null;
  if (String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function jpegDimensions(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = bytes[offset + 1];
    while (marker === 0xff) {
      offset += 1;
      marker = bytes[offset + 1];
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      return null; // reached image data without a frame header
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return null;
    const isFrameHeader =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isFrameHeader) {
      if (offset + 9 > bytes.length) return null;
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}

function u24(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function webpDimensions(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 16) return null;
  if (
    String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' ||
    String.fromCharCode(...bytes.slice(8, 12)) !== 'WEBP'
  ) {
    return null;
  }
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === 'VP8X') {
    if (bytes.length < 30) return null;
    return { width: u24(bytes, 24) + 1, height: u24(bytes, 27) + 1 };
  }
  if (chunk === 'VP8 ') {
    if (bytes.length < 30) return null;
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
    const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunk === 'VP8L') {
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null;
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }
  return null;
}

/** Read dimensions from the file header without decoding pixels. */
export function sniffTextureDimensions(
  buffer: ArrayBuffer,
  format: ImageFormat,
): Dimensions | null {
  const bytes = new Uint8Array(buffer);
  switch (format) {
    case 'png':
      return pngDimensions(bytes);
    case 'jpeg':
      return jpegDimensions(bytes);
    case 'webp':
      return webpDimensions(bytes);
    default:
      return null;
  }
}

function webpIsAnimated(bytes: Uint8Array): boolean {
  // VP8X canvas header: the animation flag is bit 1 of the feature byte.
  return (
    bytes.length >= 21 &&
    String.fromCharCode(...bytes.slice(12, 16)) === 'VP8X' &&
    (bytes[20] & 0x02) !== 0
  );
}

function pngIsAnimated(bytes: Uint8Array): boolean {
  // Walk real PNG chunks rather than searching the compressed data: an `acTL`
  // chunk before IDAT marks an APNG.
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length =
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (type === 'acTL') {
      return true;
    }
    if (type === 'IDAT' || type === 'IEND' || length < 0) {
      return false;
    }
    offset += 12 + length;
  }
  return false;
}

/** Validate size, real content, MIME agreement and header dimensions. */
export function validateTextureFileContent(input: {
  buffer: ArrayBuffer;
  declaredMime?: string | null;
}): TextureFileResult {
  const bytes = new Uint8Array(input.buffer);
  const head = String.fromCharCode(...bytes.slice(0, 4));
  if (head === '<svg' || head === 'GIF8') {
    return {
      ok: false,
      code: 'unsupported_format',
      message: "SVG va GIF tekstura sifatida qabul qilinmaydi. PNG, JPEG yoki WebP tanlang.",
    };
  }

  const basic = validateImageContent(input);
  if (!basic.ok) {
    return basic;
  }
  if (basic.bytes > MAX_TEXTURE_BYTES) {
    return {
      ok: false,
      code: 'too_large',
      message: `Fayl hajmi juda katta (maksimum ${MAX_TEXTURE_BYTES / (1024 * 1024)} MB).`,
    };
  }

  if (
    (basic.format === 'webp' && webpIsAnimated(bytes)) ||
    (basic.format === 'png' && pngIsAnimated(bytes))
  ) {
    return {
      ok: false,
      code: 'unsupported_format',
      message: 'Animatsiyalangan PNG/WebP tekstura sifatida qabul qilinmaydi.',
    };
  }

  const dimensions = sniffTextureDimensions(input.buffer, basic.format);
  if (!dimensions) {
    return corruptHeader();
  }
  if (
    dimensions.width > MAX_TEXTURE_DIMENSION ||
    dimensions.height > MAX_TEXTURE_DIMENSION ||
    dimensions.width * dimensions.height > MAX_TEXTURE_PIXELS
  ) {
    return invalidDimensions();
  }

  return {
    ok: true,
    format: basic.format,
    width: dimensions.width,
    height: dimensions.height,
    bytes: basic.bytes,
  };
}
