/**
 * Phase 4.3B — client-side texture decode and downscale.
 *
 * The original file is never uploaded as-is: it is decoded, downscaled to the
 * configured target, and re-encoded as PNG. That keeps uploads small, strips
 * client-side metadata, and gives the server a predictable raster. The server
 * still re-validates everything.
 */
import { MAX_TEXTURE_BYTES, type TextureFileOk } from './textureFile';

export const TEXTURE_TARGET_DESKTOP = 2048;
export const TEXTURE_TARGET_MOBILE = 1024;
export const TEXTURE_THUMBNAIL_SIZE = 128;

export type TextureNormalizeErrorCode =
  | 'decode_failed'
  | 'canvas_unavailable'
  | 'encode_failed'
  | 'too_large';

export class TextureNormalizeError extends Error {
  readonly code: TextureNormalizeErrorCode;

  constructor(code: TextureNormalizeErrorCode, message: string) {
    super(message);
    this.name = 'TextureNormalizeError';
    this.code = code;
  }
}

export interface NormalizedTextureUpload {
  blob: Blob;
  width: number;
  height: number;
  thumbnailBlob: Blob;
}

/** Desktop imports at 2048 px; narrow/mobile layouts at 1024 px. */
export function defaultTextureTargetSize(): number {
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 768px)').matches
  ) {
    return TEXTURE_TARGET_MOBILE;
  }
  return TEXTURE_TARGET_DESKTOP;
}

function targetDimensions(
  source: Pick<TextureFileOk, 'width' | 'height'>,
  maxDimension: number,
): { width: number; height: number } {
  const longest = Math.max(source.width, source.height);
  const scale = Math.min(1, maxDimension / longest);
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(
          new TextureNormalizeError(
            'encode_failed',
            "Rasmni PNG formatiga aylantirib bo'lmadi.",
          ),
        );
      }
    }, 'image/png');
  });
}

function makeCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
} {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    throw new TextureNormalizeError(
      'canvas_unavailable',
      "Bu qurilmada rasmni qayta ishlash imkoni yo'q.",
    );
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new TextureNormalizeError(
      'canvas_unavailable',
      "Bu qurilmada rasmni qayta ishlash imkoni yo'q.",
    );
  }
  return { canvas, context };
}

async function decode(
  file: Blob,
  width: number,
  height: number,
): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') {
    throw new TextureNormalizeError(
      'decode_failed',
      "Bu qurilmada rasmni dekodlash imkoni yo'q.",
    );
  }
  try {
    return await createImageBitmap(file, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'high',
    });
  } catch {
    // Some engines reject resize options; decode fully and let canvas scale.
    try {
      return await createImageBitmap(file);
    } catch {
      throw new TextureNormalizeError(
        'decode_failed',
        "Rasmni dekodlab bo'lmadi — fayl shikastlangan bo'lishi mumkin.",
      );
    }
  }
}

/**
 * Decode, downscale, PNG-encode and thumbnail one validated texture.
 *
 * `source` is the already-validated header size, so the target is known before
 * decode. The returned blobs are independent of the input and of each other.
 */
export async function normalizeTextureForUpload(
  file: Blob,
  source: Pick<TextureFileOk, 'width' | 'height'>,
  options: { maxDimension?: number } = {},
): Promise<NormalizedTextureUpload> {
  const maxDimension = options.maxDimension ?? defaultTextureTargetSize();
  const target = targetDimensions(source, maxDimension);
  const bitmap = await decode(file, target.width, target.height);

  try {
    const { canvas, context } = makeCanvas(target.width, target.height);
    context.drawImage(bitmap, 0, 0, target.width, target.height);
    const blob = await canvasToBlob(canvas);
    if (blob.size > MAX_TEXTURE_BYTES) {
      throw new TextureNormalizeError(
        'too_large',
        'Qayta ishlangan rasm 8 MB chegarasidan katta. Kichikroq rasm tanlang.',
      );
    }

    const thumbSize = TEXTURE_THUMBNAIL_SIZE;
    const scale = Math.min(1, thumbSize / Math.max(target.width, target.height));
    const thumbWidth = Math.max(1, Math.round(target.width * scale));
    const thumbHeight = Math.max(1, Math.round(target.height * scale));
    const thumb = makeCanvas(thumbWidth, thumbHeight);
    thumb.context.drawImage(canvas, 0, 0, thumbWidth, thumbHeight);
    const thumbnailBlob = await canvasToBlob(thumb.canvas);

    return {
      blob,
      width: target.width,
      height: target.height,
      thumbnailBlob,
    };
  } finally {
    bitmap.close();
  }
}
