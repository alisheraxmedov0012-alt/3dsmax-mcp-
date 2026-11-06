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
import { textureKindFor, type TextureKind } from './types';

export { textureKindFor };
export type { TextureKind };

export const DEFAULT_TEXTURE_SIZE = 128;

/**
 * Upper bound on distinct texture sets kept in the shared cache.
 *
 * Entries are ref-counted and removed as soon as their last user disposes them,
 * so a live cache normally stays tiny. The cap only matters when many distinct
 * `textureScale` values are alive at once (a slider produces arbitrarily many).
 * Once the cap is reached, new sets are still generated but are not shared: they
 * are disposed by their owner instead of growing the cache without limit. This
 * deliberately does not evict in-use entries, and preview/export resolution is
 * unchanged. At 512 px a set is about 2 MiB, so the cap bounds cached bitmaps to
 * roughly 64 MiB (preview sets are about 128 KiB each).
 */
export const MAX_CACHED_TEXTURE_SETS = 32;

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

/** Deterministic multi-octave value noise in 0..1. */
function fbm(x: number, y: number, octaves: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let normalizer = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += smoothNoise(x * frequency, y * frequency) * amplitude;
    normalizer += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return normalizer === 0 ? 0 : sum / normalizer;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

interface OakSample {
  readonly height: number;
  readonly ring: number;
  readonly fiber: number;
  readonly broad: number;
  readonly pore: number;
}

/**
 * Oak height/colour field. The grain runs along U (the long axis of the desk):
 * fibres change quickly across V and slowly along U, and the growth rings are
 * noise-warped bands across V. Deliberately no plain sine wave, so the result
 * does not read as a repeating procedural stripe.
 */
function oakSample(u: number, v: number): OakSample {
  const broad = fbm(u * 1.7, v * 7.5, 3);
  const fiber = fbm(u * 3.2, v * 120, 3);
  const fine = smoothNoise(u * 420, v * 900);
  const ring = 0.5 + 0.5 * Math.sin((v * 17 + broad * 2.6) * Math.PI * 2);
  const pore = fine > 0.78 ? (fine - 0.78) / 0.22 : 0;
  const height = 0.5 + 0.16 * (fiber - 0.5) + 0.1 * (ring - 0.5) - 0.18 * pore;
  return { height, ring, fiber, broad, pore };
}

interface SatinSample {
  readonly height: number;
  readonly fine: number;
  readonly micro: number;
}

/** Fine satin-metal field: no large-scale pattern, only micro roughness. */
function satinSample(u: number, v: number): SatinSample {
  const fine = fbm(u * 5, v * 220, 3);
  const micro = smoothNoise(u * 800, v * 800);
  const height = 0.5 + 0.06 * (fine - 0.5) + 0.04 * (micro - 0.5);
  return { height, fine, micro };
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
    case 'oak':
      return oakSample(u, v).height;
    case 'satin-metal':
      return satinSample(u, v).height;
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

/** Canvas sources kept for the external-texture export, not for rendering. */
export interface ProceduralTextureSources {
  readonly baseColor: HTMLCanvasElement;
  readonly normal: HTMLCanvasElement;
  readonly orm: HTMLCanvasElement;
}

export interface ProceduralTextures {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  /**
   * Packed occlusion/roughness/metalness texture (glTF ORM convention). Using
   * one texture for both `roughnessMap` and `metalnessMap` lets GLTFExporter
   * emit a shared metallicRoughness image instead of one per material.
   */
  ormMap?: THREE.CanvasTexture;
  /** Present for the premium 2K generators; used to write external PNGs. */
  sources?: ProceduralTextureSources;
  dispose: () => void;
}

type CanvasLike = {
  width: number;
  height: number;
  getContext: (id: '2d') => CanvasRenderingContext2D | null;
};

interface BuiltTextures {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  ormMap?: THREE.CanvasTexture;
  sources?: ProceduralTextureSources;
}

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

function configureTexture(
  texture: THREE.CanvasTexture,
  scale: number,
  colorSpace: THREE.ColorSpace,
): THREE.CanvasTexture {
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(scale, scale);
  texture.needsUpdate = true;
  return texture;
}

function buildStandardTextures(
  kind: TextureKind,
  scale: number,
  size: number,
): BuiltTextures | null {
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

  const map = configureTexture(
    new THREE.CanvasTexture(base.canvas as unknown as HTMLCanvasElement),
    scale,
    THREE.SRGBColorSpace,
  );
  const normalMap = configureTexture(
    new THREE.CanvasTexture(normal.canvas as unknown as HTMLCanvasElement),
    scale,
    THREE.NoColorSpace,
  );
  return { map, normalMap };
}

function buildPremiumTextures(
  kind: 'oak' | 'satin-metal',
  scale: number,
  size: number,
): BuiltTextures | null {
  const base = createCanvas(size);
  const normal = createCanvas(size);
  const orm = createCanvas(size);
  if (!base || !normal || !orm) {
    return null;
  }

  const heights = new Float32Array(size * size);
  const baseRgb = new Uint8ClampedArray(size * size * 3);
  const ormRgb = new Uint8ClampedArray(size * size * 3);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const index = y * size + x;
      const dst = index * 3;
      let roughness: number;
      let metalness: number;
      if (kind === 'oak') {
        const sample = oakSample(u, v);
        heights[index] = sample.height;
        const t = clamp01(
          0.32 +
            0.34 * sample.ring +
            0.2 * sample.fiber +
            0.08 * sample.broad -
            0.25 * sample.pore,
        );
        baseRgb[dst] = clampByte(128 + 72 * t + 4 * sample.ring);
        baseRgb[dst + 1] = clampByte(84 + 66 * t);
        baseRgb[dst + 2] = clampByte(46 + 48 * t);
        roughness = clamp01(
          0.52 +
            0.06 * (0.5 - sample.fiber) +
            0.03 * (0.5 - sample.ring) +
            0.03 * sample.pore,
        );
        // Oak is a dielectric; keep metalness at zero in the ORM blue channel.
        metalness = 0;
      } else {
        const sample = satinSample(u, v);
        heights[index] = sample.height;
        const value = 24 + 6 * sample.fine + 2 * sample.micro;
        baseRgb[dst] = clampByte(value - 2);
        baseRgb[dst + 1] = clampByte(value);
        baseRgb[dst + 2] = clampByte(value + 4);
        roughness = Math.max(
          0.3,
          Math.min(
            0.44,
            0.34 + 0.07 * (sample.fine - 0.5) + 0.03 * (sample.micro - 0.5),
          ),
        );
        metalness = Math.max(0, Math.min(1, 0.94 + 0.06 * sample.fine));
      }
      // glTF ORM: R = occlusion, G = roughness, B = metalness. Occlusion is not
      // authored for this procedural set, so R stays 0 and aoIntensity is 1.
      ormRgb[dst] = 0;
      ormRgb[dst + 1] = clampByte(roughness * 255);
      ormRgb[dst + 2] = clampByte(metalness * 255);
    }
  }

  fillFromHeight(base.ctx, size, size, baseRgb);
  fillFromHeight(
    normal.ctx,
    size,
    size,
    heightToNormal(heights, size, size, kind === 'oak' ? 2.4 : 0.8),
  );
  fillFromHeight(orm.ctx, size, size, ormRgb);

  const map = configureTexture(
    new THREE.CanvasTexture(base.canvas as unknown as HTMLCanvasElement),
    scale,
    THREE.SRGBColorSpace,
  );
  const normalMap = configureTexture(
    new THREE.CanvasTexture(normal.canvas as unknown as HTMLCanvasElement),
    scale,
    THREE.NoColorSpace,
  );
  const ormMap = configureTexture(
    new THREE.CanvasTexture(orm.canvas as unknown as HTMLCanvasElement),
    scale,
    THREE.NoColorSpace,
  );

  return {
    map,
    normalMap,
    ormMap,
    sources: {
      baseColor: base.canvas as unknown as HTMLCanvasElement,
      normal: normal.canvas as unknown as HTMLCanvasElement,
      orm: orm.canvas as unknown as HTMLCanvasElement,
    },
  };
}

interface CachedTextures extends BuiltTextures {
  /** How many live materials are using these GPU textures right now. */
  refs: number;
}

const textureCache = new Map<string, CachedTextures>();

function disposeTextures(textures: BuiltTextures): void {
  textures.map.dispose();
  textures.normalMap.dispose();
  textures.ormMap?.dispose();
}

function releaseCached(key: string): void {
  const entry = textureCache.get(key);
  if (!entry) {
    return;
  }
  entry.refs -= 1;
  if (entry.refs > 0) {
    return;
  }
  disposeTextures(entry);
  textureCache.delete(key);
}

function handleFor(
  key: string,
  built: BuiltTextures,
  cached: boolean,
): ProceduralTextures {
  let released = false;
  return {
    map: built.map,
    normalMap: built.normalMap,
    ...(built.ormMap ? { ormMap: built.ormMap } : {}),
    ...(built.sources ? { sources: built.sources } : {}),
    dispose: () => {
      if (released) {
        return;
      }
      released = true;
      if (cached) {
        releaseCached(key);
      } else {
        disposeTextures(built);
      }
    },
  };
}

/**
 * Build (or reuse) the procedural detail maps for a material type.
 *
 * Standard kinds keep the historical 128/512 grayscale+normal pair. The premium
 * `oak` and `satin-metal` kinds generate BaseColor, Normal, Roughness and
 * Metalness at the requested size (2048 for the desk product) and expose their
 * canvases for the external PNG export.
 *
 * Every non-null result must be disposed exactly once; `dispose` is idempotent
 * per returned handle and reference-counted across handles.
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
    return handleFor(key, cached, true);
  }

  const built =
    kind === 'oak' || kind === 'satin-metal'
      ? buildPremiumTextures(kind, scale, size)
      : buildStandardTextures(kind, scale, size);
  if (!built) {
    return null;
  }

  if (textureCache.size >= MAX_CACHED_TEXTURE_SETS) {
    return handleFor(key, built, false);
  }

  textureCache.set(key, { ...built, refs: 1 });
  return handleFor(key, built, true);
}

/** Number of texture sets currently held in the cache. Exposed for tests. */
export function cachedTextureCount(): number {
  return textureCache.size;
}
