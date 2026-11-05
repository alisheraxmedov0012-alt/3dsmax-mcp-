/**
 * Phase 4.3B — bitmap texture runtime cache.
 *
 * The scene stores only `TextureAssetRef`s. This registry turns a ref into a
 * `THREE.Texture` through the authenticated content endpoint, shares concurrent
 * requests, and reference-counts the result so one texture can safely be used by
 * several objects without being disposed under them.
 *
 * Bytes are fetched as a Blob and decoded with `createImageBitmap`; no `<img>`
 * or cross-origin URL is used, which keeps the canvas clean for GLB export.
 */
import * as THREE from 'three';
import { ApiRequestError } from '../api/client';
import { fetchTextureContent } from '../api/textureApi';
import { type TextureAssetRef } from './asset';
import { PBR_LIMITS } from './types';

export type TextureLoadErrorCode =
  | 'not_found'
  | 'unauthorized'
  | 'network'
  | 'decode'
  | 'unsupported'
  | 'server';

export class TextureLoadError extends Error {
  readonly code: TextureLoadErrorCode;

  constructor(code: TextureLoadErrorCode, message: string) {
    super(message);
    this.name = 'TextureLoadError';
    this.code = code;
  }
}

export interface TextureAcquireOptions {
  /** UV repeat multiplier; stored per cache entry because it affects sampling. */
  repeat?: number;
}

export interface TextureProvider {
  acquire(ref: TextureAssetRef, options?: TextureAcquireOptions): Promise<THREE.Texture>;
  release(ref: TextureAssetRef, options?: TextureAcquireOptions): void;
}

interface Entry {
  refs: number;
  promise: Promise<{ texture: THREE.Texture; bitmap: ImageBitmap }>;
  texture?: THREE.Texture;
  bitmap?: ImageBitmap;
}

function clampRepeat(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1;
  }
  return Math.min(Math.max(value, PBR_LIMITS.textureScale.min), PBR_LIMITS.textureScale.max);
}

function cacheKey(ref: TextureAssetRef, repeat: number): string {
  return `${ref.id}@${ref.version}|${repeat}`;
}

function loadError(error: unknown): TextureLoadError {
  if (error instanceof TextureLoadError) {
    return error;
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 404) {
      return new TextureLoadError('not_found', 'Tekstura serverda topilmadi.');
    }
    if (error.status === 401 || error.status === 403) {
      return new TextureLoadError(
        'unauthorized',
        "Teksturani olish uchun tizimga kiring yoki ruxsatni tekshiring.",
      );
    }
    if (error.status === 0) {
      return new TextureLoadError('network', error.message);
    }
    return new TextureLoadError('server', error.message);
  }
  return new TextureLoadError('server', "Teksturani yuklab bo'lmadi.");
}

export class TextureRegistry implements TextureProvider {
  private readonly entries = new Map<string, Entry>();
  private readonly loader: (id: string) => Promise<Blob>;

  constructor(loader: (id: string) => Promise<Blob> = fetchTextureContent) {
    this.loader = loader;
  }

  private async create(ref: TextureAssetRef, repeat: number): Promise<{
    texture: THREE.Texture;
    bitmap: ImageBitmap;
  }> {
    let blob: Blob;
    try {
      blob = await this.loader(ref.id);
    } catch (error) {
      throw loadError(error);
    }
    if (typeof createImageBitmap !== 'function') {
      throw new TextureLoadError(
        'unsupported',
        "Bu qurilmada teksturani dekodlash imkoni yo'q.",
      );
    }
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      throw new TextureLoadError(
        'decode',
        "Tekstura rasmini dekodlab bo'lmadi.",
      );
    }

    const texture = new THREE.Texture(bitmap);
    texture.colorSpace =
      ref.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    const wrap = ref.wrap === 'clamp' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    texture.wrapS = wrap;
    texture.wrapT = wrap;
    texture.repeat.set(repeat, repeat);
    texture.needsUpdate = true;
    texture.name = `texture:${ref.id}`;
    return { texture, bitmap };
  }

  /** Acquire one reference. Concurrent callers share a single fetch/decode. */
  async acquire(
    ref: TextureAssetRef,
    options: TextureAcquireOptions = {},
  ): Promise<THREE.Texture> {
    const repeat = clampRepeat(options.repeat);
    const key = cacheKey(ref, repeat);
    let entry = this.entries.get(key);
    if (!entry) {
      const created: Entry = { refs: 0, promise: this.create(ref, repeat) };
      created.promise.then(
        ({ texture, bitmap }) => {
          created.texture = texture;
          created.bitmap = bitmap;
          if (created.refs <= 0 && this.entries.get(key) !== created) {
            texture.dispose();
            bitmap.close();
          }
        },
        () => {
          if (created.refs <= 0 && this.entries.get(key) === created) {
            this.entries.delete(key);
          }
        },
      );
      this.entries.set(key, created);
      entry = created;
    }

    // Count the caller before awaiting so a release from another caller cannot
    // drop the entry to zero while this acquire is still pending.
    entry.refs += 1;
    try {
      const { texture } = await entry.promise;
      return texture;
    } catch (error) {
      entry.refs -= 1;
      if (entry.refs <= 0 && this.entries.get(key) === entry) {
        this.entries.delete(key);
      }
      throw error;
    }
  }

  /** Release one reference; the last release frees GPU/CPU texture memory. */
  release(ref: TextureAssetRef, options: TextureAcquireOptions = {}): void {
    const repeat = clampRepeat(options.repeat);
    const key = cacheKey(ref, repeat);
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }
    entry.refs -= 1;
    if (entry.refs > 0) {
      return;
    }
    this.entries.delete(key);
    entry.texture?.dispose();
    entry.bitmap?.close();
  }

  /** Number of live cache entries. Exposed for tests/diagnostics. */
  size(): number {
    return this.entries.size;
  }

  /** Drop every entry (tests/HMR). Only call when no consumer still uses them. */
  clear(): void {
    for (const entry of this.entries.values()) {
      entry.texture?.dispose();
      entry.bitmap?.close();
    }
    this.entries.clear();
  }
}

export const textureRegistry = new TextureRegistry();
