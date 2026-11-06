/**
 * Phase 6.1-B — rasterize a Three.js texture to PNG for OBJ/MTL sidecars.
 *
 * GLB embeds its images, but OBJ/MTL reference external files. Procedural
 * textures are CanvasTextures; uploaded textures hold ImageBitmaps from the
 * authenticated endpoint. Both are rasterized through a temporary 2D canvas so
 * the package contains real PNG bytes rather than a sampler description.
 */
import type * as THREE from 'three';
import { isPng } from './pngSize';

export type TexturePngEncoder = (texture: THREE.Texture) => Promise<Uint8Array>;

interface CanvasLike {
  width: number;
  height: number;
  toBlob?: (callback: (blob: Blob | null) => void, type?: string) => void;
}

function isCanvasLike(value: unknown): value is CanvasLike {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as CanvasLike;
  return (
    typeof candidate.width === 'number' &&
    typeof candidate.height === 'number' &&
    typeof candidate.toBlob === 'function'
  );
}

function canvasToPng(canvas: CanvasLike): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob?.((blob) => {
      if (!blob) {
        reject(new Error("Tekstura PNG qilib kodlanmadi."));
        return;
      }
      blob
        .arrayBuffer()
        .then((buffer) => {
          const bytes = new Uint8Array(buffer);
          if (!isPng(bytes)) {
            reject(new Error("Tekstura natijasi haqiqiy PNG emas."));
            return;
          }
          resolve(bytes);
        })
        .catch(reject);
    }, 'image/png');
  });
}

/** Rasterize one texture. Throws rather than returning a placeholder. */
export const encodeTexturePng: TexturePngEncoder = async (texture) => {
  const image = texture.image as unknown;
  if (isCanvasLike(image)) {
    return canvasToPng(image);
  }
  if (typeof document === 'undefined') {
    throw new Error("Bu muhitda teksturani PNG qilib kodlash imkoni yo'q.");
  }
  const width = Number((image as { width?: unknown } | null)?.width);
  const height = Number((image as { height?: unknown } | null)?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Tekstura o'lchami o'qilmadi.");
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2D kontekst tekstura uchun mavjud emas.');
  }
  if (typeof ImageData !== 'undefined' && image instanceof ImageData) {
    context.putImageData(image, 0, 0);
  } else {
    context.drawImage(image as CanvasImageSource, 0, 0);
  }
  return canvasToPng(canvas);
};
