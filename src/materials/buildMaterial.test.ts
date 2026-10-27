import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTextureResolution, buildPbrMaterial } from './buildMaterial';
import { DEFAULT_TEXTURE_SIZE } from './textures';
import { DEFAULT_PBR_MATERIAL } from './types';

function stubCanvas() {
  const createImageData = (w: number, h: number) => ({
    width: w,
    height: h,
    data: new Uint8ClampedArray(w * h * 4),
  });
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ createImageData, putImageData: () => undefined }),
    }),
  });
}

function mapSize(texture: THREE.Texture | null): { width: number; height: number } {
  const image = texture?.image as { width?: number; height?: number } | undefined;
  return { width: image?.width ?? 0, height: image?.height ?? 0 };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildPbrMaterial', () => {
  it('builds a MeshStandardMaterial with the base colour and defaults', () => {
    const { material } = buildPbrMaterial('#a9744f');
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(material.color.getHexString()).toBe('a9744f');
    expect(material.metalness).toBeCloseTo(DEFAULT_PBR_MATERIAL.metalness, 5);
    expect(material.roughness).toBeCloseTo(DEFAULT_PBR_MATERIAL.roughness, 5);
    expect(material.opacity).toBe(1);
    expect(material.transparent).toBe(false);
  });

  it('applies a preset (glass) as a transparent material', () => {
    const { material } = buildPbrMaterial('#bfe3ea', { materialId: 'glass-clear' });
    expect(material.opacity).toBeCloseTo(0.3, 5);
    expect(material.transparent).toBe(true);
  });

  it('clamps invalid numeric values so they cannot reach the renderer', () => {
    const { material } = buildPbrMaterial('#a9744f', {
      metalness: Number.NaN,
      roughness: 9,
      opacity: -5,
      textureScale: Number.POSITIVE_INFINITY,
    });
    expect(material.metalness).toBeCloseTo(DEFAULT_PBR_MATERIAL.metalness, 5);
    expect(material.roughness).toBe(1);
    expect(material.opacity).toBe(0.1);
  });

  it('falls back to a plain material when texture generation is unavailable', () => {
    // No canvas stub here: Node has no canvas, so no map/normalMap is attached.
    const { material } = buildPbrMaterial('#a9744f', { materialId: 'wood-oak' });
    expect(material.map).toBeNull();
    expect(material.normalMap).toBeNull();
  });

  it('attaches procedural textures when a canvas is available', () => {
    stubCanvas();
    const built = buildPbrMaterial('#a9744f', {
      materialId: 'wood-oak',
      textureScale: 2,
      normalStrength: 0.5,
    });
    const { material } = built;
    expect(material.map).not.toBeNull();
    expect(material.normalMap).not.toBeNull();
    expect(material.normalScale.x).toBeCloseTo(0.5, 5);
    built.dispose();
  });

  it('disposes the material and its textures', () => {
    stubCanvas();
    const built = buildPbrMaterial('#a9744f', { materialId: 'fabric-linen' });
    const mapDispose = vi.spyOn(built.material.map as THREE.Texture, 'dispose');
    const materialDispose = vi.spyOn(built.material, 'dispose');
    built.dispose();
    expect(mapDispose).toHaveBeenCalled();
    expect(materialDispose).toHaveBeenCalled();
  });

  it('keeps 128x128 as the default for both maps', () => {
    stubCanvas();
    const built = buildPbrMaterial('#a9744f', { materialId: 'wood-oak', textureScale: 2 });

    expect(DEFAULT_TEXTURE_SIZE).toBe(128);
    expect(mapSize(built.material.map)).toEqual({ width: 128, height: 128 });
    expect(mapSize(built.material.normalMap)).toEqual({ width: 128, height: 128 });
    built.dispose();
  });

  it('generates both maps at an explicit 512x512', () => {
    stubCanvas();
    const built = buildPbrMaterial(
      '#a9744f',
      { materialId: 'wood-oak', textureScale: 2, normalStrength: 0.5 },
      { textureSize: 512 },
    );

    expect(mapSize(built.material.map)).toEqual({ width: 512, height: 512 });
    expect(mapSize(built.material.normalMap)).toEqual({ width: 512, height: 512 });
    // Texture scale and normal strength are still the preset/object values.
    expect(built.material.map?.repeat.x).toBe(2);
    expect(built.material.normalScale.x).toBeCloseTo(0.5, 5);
    built.dispose();
  });

  it('keeps 128 and 512 cache entries separate and disposable independently', () => {
    stubCanvas();
    const preview = buildPbrMaterial('#a9744f', { materialId: 'wood-oak', textureScale: 2 });
    const large = buildPbrMaterial('#a9744f', { materialId: 'wood-oak', textureScale: 2 }, {
      textureSize: 512,
    });

    expect(preview.material.map).not.toBe(large.material.map);
    expect(mapSize(preview.material.map).width).toBe(128);
    expect(mapSize(large.material.map).width).toBe(512);

    const previewMapDispose = vi.spyOn(preview.material.map as THREE.Texture, 'dispose');
    large.dispose();
    expect(previewMapDispose).not.toHaveBeenCalled();
    expect(mapSize(preview.material.map).width).toBe(128);

    preview.dispose();
    expect(previewMapDispose).toHaveBeenCalled();
  });

  it('retargets maps without changing any other material property', () => {
    stubCanvas();
    const built = buildPbrMaterial('#a9744f', {
      materialId: 'wood-oak',
      textureScale: 2,
      normalStrength: 0.75,
    });
    built.material.name = 'dresser-material';
    built.material.side = THREE.DoubleSide;
    const before = {
      color: built.material.color.getHexString(),
      metalness: built.material.metalness,
      roughness: built.material.roughness,
      opacity: built.material.opacity,
      transparent: built.material.transparent,
      normalScale: built.material.normalScale.clone(),
      side: built.material.side,
      name: built.material.name,
    };

    const disposeLarge = applyTextureResolution(built.material, {
      materialId: 'wood-oak',
      textureScale: 2,
    }, 512);

    expect(mapSize(built.material.map).width).toBe(512);
    expect(mapSize(built.material.normalMap).width).toBe(512);
    expect(built.material.color.getHexString()).toBe(before.color);
    expect(built.material.metalness).toBe(before.metalness);
    expect(built.material.roughness).toBe(before.roughness);
    expect(built.material.opacity).toBe(before.opacity);
    expect(built.material.transparent).toBe(before.transparent);
    expect(built.material.normalScale.x).toBeCloseTo(before.normalScale.x, 5);
    expect(built.material.normalScale.y).toBeCloseTo(before.normalScale.y, 5);
    expect(built.material.side).toBe(before.side);
    expect(built.material.name).toBe(before.name);

    disposeLarge?.();
    built.dispose();
  });

  it('leaves a textureless preset textureless when retargeting', () => {
    stubCanvas();
    const built = buildPbrMaterial('#bfe3ea', { materialId: 'glass-clear' });

    const dispose = applyTextureResolution(built.material, { materialId: 'glass-clear' }, 512);

    expect(dispose).toBeNull();
    expect(built.material.map).toBeNull();
    expect(built.material.normalMap).toBeNull();
    expect(built.material.transparent).toBe(true);
    built.dispose();
  });
});
