import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_CACHED_TEXTURE_SETS,
  cachedTextureCount,
  createProceduralTextures,
  heightToNormal,
  patternHeight,
  textureKindFor,
} from './textures';

/** Minimal canvas stub so the generation path runs without a real browser. */
function stubCanvas() {
  const createImageData = (w: number, h: number) => ({
    width: w,
    height: h,
    data: new Uint8ClampedArray(w * h * 4),
  });
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ createImageData, putImageData: () => undefined }),
  };
  vi.stubGlobal('document', { createElement: () => canvas });
  return canvas;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('textureKindFor', () => {
  it('maps material types to procedural patterns', () => {
    expect(textureKindFor('wood')).toBe('wood');
    expect(textureKindFor('metal')).toBe('brushed');
    expect(textureKindFor('fabric')).toBe('fabric');
    expect(textureKindFor('leather')).toBe('grain');
    expect(textureKindFor('glass')).toBe('none');
    expect(textureKindFor('plastic')).toBe('none');
    expect(textureKindFor('painted')).toBe('none');
  });
});

describe('patternHeight', () => {
  it('is deterministic and stays within 0..1', () => {
    for (const kind of ['wood', 'brushed', 'fabric', 'grain', 'none'] as const) {
      for (let i = 0; i < 20; i += 1) {
        const u = i / 20;
        const v = (i * 7) / 20 % 1;
        const a = patternHeight(kind, u, v);
        const b = patternHeight(kind, u, v);
        expect(a).toBe(b);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('heightToNormal', () => {
  it('produces the neutral normal for a flat field', () => {
    const size = 8;
    const flat = new Float32Array(size * size).fill(0.5);
    const normals = heightToNormal(flat, size, size, 6);
    expect(normals.length).toBe(size * size * 3);
    for (let i = 0; i < size * size; i += 1) {
      expect(normals[i * 3]).toBe(128);
      expect(normals[i * 3 + 1]).toBe(128);
      expect(normals[i * 3 + 2]).toBe(255);
    }
  });

  it('tilts the normal where the height changes', () => {
    const size = 3;
    const heights = new Float32Array(size * size);
    // A vertical ramp along X.
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        heights[y * size + x] = x / (size - 1);
      }
    }
    const normals = heightToNormal(heights, size, size, 6);
    const centre = (1 * size + 1) * 3;
    // X normal deviates from the neutral 128 while Z stays positive.
    expect(normals[centre]).not.toBe(128);
    expect(normals[centre + 2]).toBeGreaterThan(128);
  });
});

describe('createProceduralTextures', () => {
  it('returns null when no canvas API is available (fallback)', () => {
    expect(createProceduralTextures('wood', 2)).toBeNull();
  });

  it('returns null for a pattern-less kind', () => {
    stubCanvas();
    expect(createProceduralTextures('none', 1)).toBeNull();
  });

  it('builds map and normal textures with the requested repeat', () => {
    stubCanvas();
    const textures = createProceduralTextures('fabric', 2.5);
    expect(textures).not.toBeNull();
    expect(textures?.map).toBeDefined();
    expect(textures?.normalMap).toBeDefined();
    expect(textures?.map.repeat.x).toBe(2.5);
    expect(textures?.map.repeat.y).toBe(2.5);
    expect(textures?.map.wrapS).toBe(1000); // THREE.RepeatWrapping
    textures?.dispose();
  });

  it('samples the base map in sRGB and the normal map as data', () => {
    stubCanvas();
    const textures = createProceduralTextures('wood', 1);
    expect(textures).not.toBeNull();
    expect(textures?.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(textures?.normalMap.colorSpace).toBe(THREE.NoColorSpace);
    textures?.dispose();
  });
});

describe('shared texture cache bounds', () => {
  it('caps growth without evicting sets that are still in use', () => {
    stubCanvas();
    expect(cachedTextureCount()).toBe(0);

    type Handle = NonNullable<ReturnType<typeof createProceduralTextures>>;
    const handles: Handle[] = [];
    for (let i = 0; i < MAX_CACHED_TEXTURE_SETS; i += 1) {
      handles.push(createProceduralTextures('wood', 0.25 + i * 0.05) as Handle);
    }
    expect(cachedTextureCount()).toBe(MAX_CACHED_TEXTURE_SETS);

    // A new, distinct set beyond the cap is still usable but is not cached.
    const extra = createProceduralTextures('wood', 9) as Handle;
    const disposed = vi.fn();
    extra.map.addEventListener('dispose', disposed);
    expect(cachedTextureCount()).toBe(MAX_CACHED_TEXTURE_SETS);

    extra.dispose();
    extra.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(cachedTextureCount()).toBe(MAX_CACHED_TEXTURE_SETS);

    // Releasing a cached set frees a slot, so sharing resumes for new sets.
    handles.pop()?.dispose();
    expect(cachedTextureCount()).toBe(MAX_CACHED_TEXTURE_SETS - 1);
    const shared = createProceduralTextures('wood', 9.5) as Handle;
    expect(cachedTextureCount()).toBe(MAX_CACHED_TEXTURE_SETS);
    handles.push(shared);

    handles.forEach((handle) => handle.dispose());
    expect(cachedTextureCount()).toBe(0);
  });
});
