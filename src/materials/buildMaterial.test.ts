import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPbrMaterial } from './buildMaterial';
import { DEFAULT_PBR_MATERIAL } from './types';

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
    const { material } = buildPbrMaterial('#a9744f', {
      materialId: 'wood-oak',
      textureScale: 2,
      normalStrength: 0.5,
    });
    expect(material.map).not.toBeNull();
    expect(material.normalMap).not.toBeNull();
    expect(material.normalScale.x).toBeCloseTo(0.5, 5);
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
});
