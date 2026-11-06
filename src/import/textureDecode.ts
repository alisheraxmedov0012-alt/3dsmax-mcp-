/**
 * Phase 6.2.3 — turning selected image bytes into a Three.js texture.
 *
 * Kept behind a small interface so the material conversion can be tested without a
 * decoder: the browser implementation uses `createImageBitmap`, which no Node test
 * environment has, and injecting a stub for *only* that step keeps every other
 * line of the import path real.
 *
 * The decoder never sees a URL: bytes come from the user's selection, so no
 * `TextureLoader`, no `src` attribute and no network lookup is involved.
 */
import * as THREE from 'three';
import { importFailure } from './importErrors';

export type TextureDecoder = (
  bytes: Uint8Array,
  options: { readonly srgb: boolean },
) => Promise<THREE.Texture>;

/** Browser decoder: blob → ImageBitmap → texture. */
export async function decodeTextureInBrowser(
  bytes: Uint8Array,
  options: { readonly srgb: boolean },
): Promise<THREE.Texture> {
  if (typeof createImageBitmap !== 'function') {
    throw importFailure('failed', 'Bu brauzer rasm dekodlashni qo‘llab-quvvatlamaydi.');
  }
  const blob = new Blob([bytes as unknown as BlobPart]);
  const bitmap = await createImageBitmap(blob);
  const texture = new THREE.Texture(bitmap);
  texture.colorSpace = options.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

export interface TextureResolution {
  readonly textures: ReadonlyMap<string, THREE.Texture>;
  readonly warnings: readonly string[];
}

/**
 * Resolves and decodes the textures a material set references.
 *
 * A texture that cannot be found or decoded is skipped with a warning: the model
 * still imports with its factor colours, and the user is told exactly which map is
 * missing rather than shown a silent white surface.
 */
export async function resolveTextures(
  paths: readonly string[],
  bytesOf: (path: string) => Uint8Array | undefined,
  decode: TextureDecoder,
  srgb: boolean,
): Promise<TextureResolution> {
  const textures = new Map<string, THREE.Texture>();
  const warnings: string[] = [];

  for (const path of paths) {
    if (textures.has(path)) {
      continue;
    }
    const bytes = bytesOf(path);
    if (!bytes) {
      warnings.push(`"${path}" teksturasi topilmadi — material rangsiz qoldirildi.`);
      continue;
    }
    try {
      // Sequential on purpose: decoding every map at once multiplies the peak
      // memory of an import, which is exactly what the texture budgets guard.
      // eslint-disable-next-line no-await-in-loop
      textures.set(path, await decode(bytes, { srgb }));
    } catch {
      warnings.push(`"${path}" teksturasi o‘qilmadi — material rangsiz qoldirildi.`);
    }
  }

  return { textures, warnings };
}
