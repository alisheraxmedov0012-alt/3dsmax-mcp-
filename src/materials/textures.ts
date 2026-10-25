/**
 * Procedural surface detail textures.
 *
 * Textures are generated locally on a canvas from deterministic math — no
 * external image, CDN or paid asset is downloaded, so there is nothing to
 * license and the app works fully offline. When no canvas API is available
 * (unit tests, SSR), {@link createProceduralTextures} returns `null` and the
 * caller falls back to a plain PBR material.
 */
import * as THREE from 'three';
import type { MaterialType } from './types';

export type TextureKind = 'none' | 'wood' | 'brushed' | 'fabric' | 'grain';

export const DEFAULT_TEXTURE_SIZE = 128;

/** Which procedural pattern belongs to a material type. */
export function textureKindFor(type: MaterialType): TextureKind {
  switch (type) {
    case 'wood':
      return 'wood';
    case 'metal':
      return 'brushed';
    case 'fabric':
      return 'fabric';
    case 'leather':
      return 'grain';
    default:
      return 'none';
  }
}

function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Deterministic bilinear value noise in 0..1. */
function smoothNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

/**
 * Height field value in 0..1 for a normalized coordinate (u, v). Pure and
 * deterministic so it can be unit-tested without a canvas.
 */
export function patternHeight(kind: TextureKind, u: number, v: number): number {
  switch (kind) {
    case 'wood': {
      const wobble = smoothNoise(u * 4, v * 4) * 1.5;
      return 0.5 + 0.5 * Math.sin((u * 6 + wobble) * Math.PI);
    }
    case 'brushed':
      return smoothNoise(u * 60, v * 3);
    case 'fabric':
      return 0.5 + 0.25 * Math.sin(u * Math.PI * 32) + 0.25 * Math.sin(v * Math.PI * 32);
    case 'grain':
      return 0.6 * smoothNoise(u * 14, v * 14) + 0.4 * smoothNoise(u * 40, v * 40);
    default:
      return 0.5;
  }
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * Convert a height field into a tangent-space normal map (RGB). A flat field
 * yields the neutral normal (128, 128, 255). Pure so it can be unit-tested.
 */
export function heightToNormal(
  heights: Float32Array,
  width: number,
  height: number,
  strength: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 3);
  const sample = (x: number, y: number): number => {
    const cx = Math.min(width - 1, Math.max(0, x));
    const cy = Math.min(height - 1, Math.max(0, y));
    return heights[cy * width + cx];
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = sample(x + 1, y) - sample(x - 1, y);
      const dy = sample(x, y + 1) - sample(x, y - 1);
      // Tangent-space normal; Z points out of the surface.
      const nx = -dx * strength;
      const ny = -dy * strength;
      const nz = 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      const idx = (y * width + x) * 3;
      out[idx] = clampByte(((nx / length) * 0.5 + 0.5) * 255);
      out[idx + 1] = clampByte(((ny / length) * 0.5 + 0.5) * 255);
      out[idx + 2] = clampByte(((nz / length) * 0.5 + 0.5) * 255);
    }
  }
  return out;
}

export interface ProceduralTextures {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  dispose: () => void;
}

type CanvasLike = {
  width: number;
  height: number;
  getContext: (id: '2d') => CanvasRenderingContext2D | null;
};

/**
 * Create a canvas that can actually be painted on.
 *
 * Checking for `document.createElement` alone is not enough. A DOM without a
 * canvas backend (jsdom without the `canvas` package, some embedded webviews)
 * happily returns an element whose `getContext('2d')` is `null`. Drawing onto it
 * silently produces a blank texture, and the failure only surfaces much later
 * when the GLB exporter tries to read the image back and throws. Requiring a real
 * 2D context means such an environment gets the documented "no texture" fallback
 * instead of a broken export.
 */
function createCanvas(size: number): { canvas: CanvasLike; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  return { canvas, ctx };
}

function fillFromHeight(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  data: Uint8ClampedArray,
): void {
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i += 1) {
    const src = i * 3;
    const dst = i * 4;
    image.data[dst] = data[src];
    image.data[dst + 1] = data[src + 1];
    image.data[dst + 2] = data[src + 2];
    image.data[dst + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

interface CachedTextures {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  /** How many live materials are using these GPU textures right now. */
  refs: number;
}

/**
 * Shared textures, keyed by everything that affects their pixels.
 *
 * A material is built per furniture object, and the same object is rebuilt
 * several times per interaction (viewport, BOM, validation, drawing). Generating
 * a 128x128 noise field, a normal map and two canvases each time is both CPU work
 * and a fresh GPU upload for identical pixels, so textures are shared.
 *
 * Sharing is safe because the key contains every input that changes the result:
 * the pattern kind, the UV repeat, and the bitmap size. Materials still own their
 * colour and PBR channels, which are per-object.
 *
 * Disposal is reference-counted: a material releasing the textures only frees the
 * GPU resources once the last material that uses them has gone. Releasing on the
 * first dispose would break every other object sharing the same preset.
 */
const textureCache = new Map<string, CachedTextures>();

function releaseCached(key: string): void {
  const entry = textureCache.get(key);
  if (!entry) {
    return;
  }
  entry.refs -= 1;
  if (entry.refs > 0) {
    return;
  }
  entry.map.dispose();
  entry.normalMap.dispose();
  textureCache.delete(key);
}

function buildTextures(
  kind: TextureKind,
  scale: number,
  size: number,
): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } | null {
  const base = createCanvas(size);
  const normal = createCanvas(size);
  if (!base || !normal) {
    return null;
  }

  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      heights[y * size + x] = patternHeight(kind, x / size, y / size);
    }
  }

  // Detail map: grayscale heights modulate the base colour.
  const gray = new Uint8ClampedArray(size * size * 3);
  for (let i = 0; i < size * size; i += 1) {
    const value = clampByte(heights[i] * 255);
    gray[i * 3] = value;
    gray[i * 3 + 1] = value;
    gray[i * 3 + 2] = value;
  }
  fillFromHeight(base.ctx, size, size, gray);

  const normals = heightToNormal(heights, size, size, 6);
  fillFromHeight(normal.ctx, size, size, normals);

  const map = new THREE.CanvasTexture(base.canvas as unknown as HTMLCanvasElement);
  const normalMap = new THREE.CanvasTexture(normal.canvas as unknown as HTMLCanvasElement);
  for (const texture of [map, normalMap]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(scale, scale);
    texture.needsUpdate = true;
  }
  return { map, normalMap };
}

/**
 * Build (or reuse) the procedural detail (map) and normal textures for a material
 * type. Returns `null` when the kind has no texture or no usable canvas backend is
 * available, which is the documented fallback: the material then renders with its
 * PBR channels and no detail map.
 *
 * Every non-null result must be disposed exactly once; `dispose` is idempotent per
 * returned handle and reference-counted across handles.
 */
export function createProceduralTextures(
  kind: TextureKind,
  scale: number,
  size: number = DEFAULT_TEXTURE_SIZE,
): ProceduralTextures | null {
  if (kind === 'none') {
    return null;
  }

  const key = `${kind}|${scale}|${size}`;
  const cached = textureCache.get(key);
  if (cached) {
    cached.refs += 1;
    let released = false;
    return {
      map: cached.map,
      normalMap: cached.normalMap,
      dispose: () => {
        if (released) {
          return;
        }
        released = true;
        releaseCached(key);
      },
    };
  }

  const built = buildTextures(kind, scale, size);
  if (!built) {
    return null;
  }
  textureCache.set(key, { ...built, refs: 1 });

  let released = false;
  return {
    map: built.map,
    normalMap: built.normalMap,
    dispose: () => {
      if (released) {
        return;
      }
      released = true;
      releaseCached(key);
    },
  };
}

/** Number of texture sets currently held in the cache. Exposed for tests. */
export function cachedTextureCount(): number {
  return textureCache.size;
}
