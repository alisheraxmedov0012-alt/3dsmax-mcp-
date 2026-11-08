import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_CACHED_TEXTURE_SETS,
  cachedTextureCount,
  createProceduralTextures,
  heightToNormal,
  oakSurfaceSample,
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

/** Canvas stub that keeps the pixels written to each canvas. */
function recordingCanvasStub() {
  const createImageData = (w: number, h: number) => ({
    width: w,
    height: h,
    data: new Uint8ClampedArray(w * h * 4),
  });
  const createElement = () => {
    const canvas = {
      width: 0,
      height: 0,
      image: null as ReturnType<typeof createImageData> | null,
      getContext: () => ({
        createImageData,
        putImageData: (image: ReturnType<typeof createImageData>) => {
          canvas.image = image;
        },
      }),
    };
    return canvas;
  };
  vi.stubGlobal('document', { createElement });
}

describe('premium oak surface', () => {
  it('is warm, quiet and free of near-black grain', () => {
    const samples = 64;
    let minR = 255;
    let maxR = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumL = 0;
    let sumL2 = 0;
    for (let y = 0; y < samples; y += 1) {
      for (let x = 0; x < samples; x += 1) {
        const [r, g, b] = oakSurfaceSample((x + 0.5) / samples, (y + 0.5) / samples).color;
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
        sumR += r;
        sumG += g;
        sumB += b;
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        sumL += l;
        sumL2 += l * l;
      }
    }
    const count = samples * samples;
    const meanR = sumR / count;
    const meanG = sumG / count;
    const meanB = sumB / count;
    const meanL = sumL / count;
    const stdL = Math.sqrt(sumL2 / count - meanL * meanL);

    expect(meanR).toBeGreaterThan(meanG);
    expect(meanG).toBeGreaterThan(meanB);
    expect(meanR - meanB).toBeGreaterThan(50);
    expect(meanL).toBeGreaterThan(125);
    expect(meanL).toBeLessThan(155);
    // No painted black stripes: the darkest base colour stays clearly warm.
    expect(minR).toBeGreaterThan(140);
    expect(maxR).toBeLessThan(215);
    // Subtle tone variation, not a high-contrast stripe pattern.
    expect(stdL).toBeGreaterThan(2);
    expect(stdL).toBeLessThan(12);
  });

  it('runs the fibres along U (the desk length)', () => {
    const samples = 64;
    let alongU = 0;
    let acrossV = 0;
    for (let y = 0; y < samples; y += 1) {
      for (let x = 0; x < samples; x += 1) {
        const u = (x + 0.5) / samples;
        const v = (y + 0.5) / samples;
        const height = patternHeight('oak', u, v);
        const nextU = patternHeight('oak', u + 1 / samples, v);
        const nextV = patternHeight('oak', u, v + 1 / samples);
        alongU += Math.abs(nextU - height);
        acrossV += Math.abs(nextV - height);
      }
    }
    expect(acrossV).toBeGreaterThan(alongU * 1.6);
  });

  it('tiles seamlessly on both axes', () => {
    for (let i = 0; i < 16; i += 1) {
      const t = (i + 0.5) / 16;
      expect(patternHeight('oak', 0, t)).toBeCloseTo(patternHeight('oak', 1, t), 10);
      expect(patternHeight('oak', t, 0)).toBeCloseTo(patternHeight('oak', t, 1), 10);
    }
  });

  it('writes a dielectric ORM map and plausible roughness', () => {
    recordingCanvasStub();
    const textures = createProceduralTextures('oak', 0.77, 64);
    expect(textures).not.toBeNull();
    const pixels = textures?.sources?.orm as unknown as {
      image: { data: Uint8ClampedArray } | null;
    };
    expect(pixels.image).not.toBeNull();
    const data = pixels.image?.data ?? new Uint8ClampedArray();
    let roughnessSum = 0;
    for (let i = 0; i < 64 * 64; i += 1) {
      expect(data[i * 4]).toBe(0); // AO is not authored.
      expect(data[i * 4 + 2]).toBe(0); // oak is a dielectric.
      roughnessSum += data[i * 4 + 1];
    }
    const meanRoughness = roughnessSum / (64 * 64) / 255;
    expect(meanRoughness).toBeGreaterThan(0.5);
    expect(meanRoughness).toBeLessThan(0.6);
    textures?.dispose();
  });
});
