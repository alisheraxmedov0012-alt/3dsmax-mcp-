/**
 * Small thumbnail cache for the material library.
 *
 * Thumbnails are derived from authenticated texture bytes and downscaled before
 * they reach an object URL, so the grid never decodes a full 2048 px image just
 * to show a 32 px swatch. The cache is session-local; clearing it revokes
 * nothing because the component owns its object URLs.
 */
import { fetchTextureContent } from '../api/textureApi';
import { TEXTURE_THUMBNAIL_SIZE } from './textureNormalize';

const cache = new Map<string, Promise<Blob>>();

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('thumbnail encode failed'));
    }, 'image/png');
  });
}

async function createThumbnail(id: string): Promise<Blob> {
  const content = await fetchTextureContent(id);
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return content;
  }
  const bitmap = await createImageBitmap(content);
  try {
    const scale = Math.min(
      1,
      TEXTURE_THUMBNAIL_SIZE / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return content;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    return await canvasToBlob(canvas);
  } finally {
    bitmap.close();
  }
}

export function loadTextureThumbnail(id: string): Promise<Blob> {
  const existing = cache.get(id);
  if (existing) {
    return existing;
  }
  const promise = createThumbnail(id);
  cache.set(id, promise);
  // Do not cache a failed request: a later retry should be allowed.
  promise.catch(() => {
    if (cache.get(id) === promise) {
      cache.delete(id);
    }
  });
  return promise;
}

/** Test/HMR helper: drop all cached thumbnails. */
export function clearTextureThumbnailCache(): void {
  cache.clear();
}
