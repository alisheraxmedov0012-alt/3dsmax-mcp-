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

function createCanvas(size: number): CanvasLike | null {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    return canvas;
  }
  return null;
}

function fillFromHeight(
  canvas: CanvasLike,
  width: number,
  height: number,
  data: Uint8ClampedArray,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
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

/**
 * Build the procedural detail (map) and normal textures for a material type.
 * Returns `null` when the kind has no texture or no canvas is available.
 */
export function createProceduralTextures(
  kind: TextureKind,
  scale: number,
  size: number = DEFAULT_TEXTURE_SIZE,
): ProceduralTextures | null {
  if (kind === 'none') {
    return null;
  }
  const baseCanvas = createCanvas(size);
  const normalCanvas = createCanvas(size);
  if (!baseCanvas || !normalCanvas) {
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
  fillFromHeight(baseCanvas, size, size, gray);

  const normals = heightToNormal(heights, size, size, 6);
  fillFromHeight(normalCanvas, size, size, normals);

  const map = new THREE.CanvasTexture(baseCanvas as unknown as HTMLCanvasElement);
  const normalMap = new THREE.CanvasTexture(normalCanvas as unknown as HTMLCanvasElement);
  for (const texture of [map, normalMap]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(scale, scale);
    texture.needsUpdate = true;
  }

  return {
    map,
    normalMap,
    dispose: () => {
      map.dispose();
      normalMap.dispose();
    },
  };
}
