/**
 * Phase 6.2 — image dimensions read from the bytes, before any decode.
 *
 * A 2 MB PNG can describe a 20 000 × 20 000 image, and decoding that costs
 * ~1.6 GB before any size check could run. The header carries the real size, so
 * the import pipeline checks the header first and never asks a decoder to allocate
 * more than the limits allow.
 *
 * Only the two containers an embedded glTF image may use are read: PNG and JPEG.
 * Anything else returns `null` and the caller rejects it.
 */

import {
  MAX_TEXTURE_DIMENSION,
  MAX_TEXTURE_IMAGE_BYTES,
} from './importLimits';

export interface ImageSize {
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** SOF markers carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) do not. */
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) {
    return false;
  }
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function readPngSize(bytes: Uint8Array): ImageSize | null {
  // Signature (8) + IHDR length (4) + "IHDR" (4) + width (4) + height (4).
  if (bytes.length < 24) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(12, false) !== 0x49484452) {
    return null;
  }
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return width > 0 && height > 0 ? { width, height } : null;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function readJpegSize(bytes: Uint8Array): ImageSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;

  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      // Not at a marker: the stream is malformed, so no size can be trusted.
      return null;
    }
    const marker = bytes[offset + 1];
    offset += 2;

    // Padding fill bytes and the standalone markers carry no length field.
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      continue;
    }

    if (offset + 2 > bytes.length) {
      return null;
    }
    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      return null;
    }

    if (JPEG_SOF_MARKERS.has(marker)) {
      // length (2) + precision (1) + height (2) + width (2)
      if (segmentLength < 7) {
        return null;
      }
      const height = view.getUint16(offset + 3, false);
      const width = view.getUint16(offset + 5, false);
      return width > 0 && height > 0 ? { width, height } : null;
    }

    offset += segmentLength;
  }

  return null;
}

/** Dimensions of a PNG or JPEG image, or `null` when the header is unreadable. */
export function readImageSize(bytes: Uint8Array): ImageSize | null {
  if (isPng(bytes)) {
    return readPngSize(bytes);
  }
  if (isJpeg(bytes)) {
    return readJpegSize(bytes);
  }
  return null;
}

/**
 * True when the bytes are a PNG/JPEG that fits the import limits.
 *
 * Shared by the glTF and the OBJ/MTL paths so an embedded map and a selected map
 * are judged by exactly the same rule — and always from the header, before any
 * decoder allocates a pixel buffer.
 */
export function imageWithinImportLimits(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_TEXTURE_IMAGE_BYTES) {
    return false;
  }
  const size = readImageSize(bytes);
  if (!size) {
    return false;
  }
  return size.width <= MAX_TEXTURE_DIMENSION && size.height <= MAX_TEXTURE_DIMENSION;
}

/** Pixel count of an image inside the limits, or `null` when it is unusable. */
export function imagePixelsWithinLimits(bytes: Uint8Array): number | null {
  if (!imageWithinImportLimits(bytes)) {
    return null;
  }
  const size = readImageSize(bytes);
  return size ? size.width * size.height : null;
}
