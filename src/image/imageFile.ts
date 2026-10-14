/**
 * W7 image file validation.
 *
 * Security-relevant rules: the decision is based on the **actual file content**
 * (magic bytes), not on the filename, the browser-reported MIME type or anything
 * the user typed. Those are only used as a cross-check and are never trusted.
 *
 * Kept DOM-free and Three.js-free so it is fully unit-testable in Node. The
 * browser decode step lives in `referenceImage.ts` (guarded by feature
 * detection) and only runs after these checks pass.
 */

/** Formats this build can decode and analyse. */
export type ImageFormat = 'png' | 'jpeg' | 'webp';

export const SUPPORTED_IMAGE_MIME: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
];

export const IMAGE_FORMAT_LABELS: Record<ImageFormat, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
};

/** Limits. Decoding a huge image is expensive, so both bounds are capped. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_IMAGE_DIMENSION = 8192; // px, per side
export const MAX_IMAGE_PIXELS = 40_000_000; // 40 MP

export type ImageRejectionCode =
  | 'empty'
  | 'too_large'
  | 'unsupported_format'
  | 'corrupt'
  | 'dimensions_too_large'
  | 'decode_failed'
  | 'mime_mismatch';

export interface ImageValidationOk {
  ok: true;
  format: ImageFormat;
  bytes: number;
}

export interface ImageValidationError {
  ok: false;
  code: ImageRejectionCode;
  message: string;
}

export type ImageValidationResult = ImageValidationOk | ImageValidationError;

export const IMAGE_ERROR_MESSAGES: Record<ImageRejectionCode, string> = {
  empty: "Fayl bo'sh yoki o'qib bo'lmadi.",
  too_large: `Fayl hajmi juda katta (maksimum ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB).`,
  unsupported_format: "Faqat PNG, JPEG yoki WebP rasmlari qo'llab-quvvatlanadi.",
  corrupt: "Fayl rasmiy formatga mos emas yoki buzilgan.",
  dimensions_too_large: `Rasm o'lchami juda katta (har tomon ${MAX_IMAGE_DIMENSION} px, ${MAX_IMAGE_PIXELS / 1_000_000} MP gacha).`,
  decode_failed: "Rasmni dekodlab bo'lmadi — fayl shikastlangan bo'lishi mumkin.",
  mime_mismatch: "Fayl turi e'lon qilingan turga mos kelmadi.",
};

function isPng(view: DataView): boolean {
  // 89 50 4E 47 0D 0A 1A 0A
  return (
    view.byteLength >= 8 &&
    view.getUint8(0) === 0x89 &&
    view.getUint8(1) === 0x50 &&
    view.getUint8(2) === 0x4e &&
    view.getUint8(3) === 0x47 &&
    view.getUint8(4) === 0x0d &&
    view.getUint8(5) === 0x0a &&
    view.getUint8(6) === 0x1a &&
    view.getUint8(7) === 0x0a
  );
}

function isJpeg(view: DataView): boolean {
  // FF D8 FF
  return (
    view.byteLength >= 3 &&
    view.getUint8(0) === 0xff &&
    view.getUint8(1) === 0xd8 &&
    view.getUint8(2) === 0xff
  );
}

function isWebp(view: DataView): boolean {
  // "RIFF" .... "WEBP"
  if (view.byteLength < 12) {
    return false;
  }
  const riff =
    view.getUint8(0) === 0x52 && // R
    view.getUint8(1) === 0x49 && // I
    view.getUint8(2) === 0x46 && // F
    view.getUint8(3) === 0x46; // F
  const webp =
    view.getUint8(8) === 0x57 && // W
    view.getUint8(9) === 0x45 && // E
    view.getUint8(10) === 0x42 && // B
    view.getUint8(11) === 0x50; // P
  return riff && webp;
}

/**
 * Detect the real image format from the file's magic bytes. Returns null when
 * the content is not a supported image (regardless of filename/MIME).
 */
export function sniffImageFormat(buffer: ArrayBuffer): ImageFormat | null {
  if (buffer.byteLength === 0) {
    return null;
  }
  const view = new DataView(buffer);
  if (isPng(view)) {
    return 'png';
  }
  if (isJpeg(view)) {
    return 'jpeg';
  }
  if (isWebp(view)) {
    return 'webp';
  }
  return null;
}

export interface ValidateImageInput {
  /** Raw file bytes. */
  buffer: ArrayBuffer;
  /** Optional browser-reported MIME type (cross-check only, never trusted). */
  declaredMime?: string | null;
}

/**
 * Validate an uploaded image from its bytes. Order: size → content format →
 * optional MIME cross-check. Filename is deliberately not a parameter.
 */
export function validateImageContent(input: ValidateImageInput): ImageValidationResult {
  const { buffer, declaredMime } = input;
  if (!buffer || buffer.byteLength === 0) {
    return { ok: false, code: 'empty', message: IMAGE_ERROR_MESSAGES.empty };
  }
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, code: 'too_large', message: IMAGE_ERROR_MESSAGES.too_large };
  }

  const format = sniffImageFormat(buffer);
  if (!format) {
    return {
      ok: false,
      code: 'corrupt',
      message: IMAGE_ERROR_MESSAGES.corrupt,
    };
  }

  // The declared MIME, when present, must agree with the real content. This
  // catches a mislabelled file without ever trusting the declaration.
  if (declaredMime && SUPPORTED_IMAGE_MIME.includes(declaredMime)) {
    const expected: Record<ImageFormat, string[]> = {
      png: ['image/png'],
      jpeg: ['image/jpeg'],
      webp: ['image/webp'],
    };
    if (!expected[format].includes(declaredMime)) {
      return {
        ok: false,
        code: 'mime_mismatch',
        message: IMAGE_ERROR_MESSAGES.mime_mismatch,
      };
    }
  } else if (declaredMime && !SUPPORTED_IMAGE_MIME.includes(declaredMime)) {
    return {
      ok: false,
      code: 'unsupported_format',
      message: IMAGE_ERROR_MESSAGES.unsupported_format,
    };
  }

  return { ok: true, format, bytes: buffer.byteLength };
}

export interface DimensionValidationOk {
  ok: true;
  width: number;
  height: number;
}

export type DimensionValidationResult = DimensionValidationOk | ImageValidationError;

/** Validates a decoded image's pixel dimensions. */
export function validateImageDimensions(width: number, height: number): DimensionValidationResult {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { ok: false, code: 'decode_failed', message: IMAGE_ERROR_MESSAGES.decode_failed };
  }
  if (
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    return {
      ok: false,
      code: 'dimensions_too_large',
      message: IMAGE_ERROR_MESSAGES.dimensions_too_large,
    };
  }
  return { ok: true, width, height };
}
