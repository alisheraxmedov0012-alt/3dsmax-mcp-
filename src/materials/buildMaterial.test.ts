import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTextureResolution, buildMaterialFromAsset, buildPbrMaterial } from './buildMaterial';
import { MATERIAL_PRESETS } from './presets';
import { getMaterialAsset, materialAssetFromPreset } from './library';
import { serializeMaterialAsset } from './asset';
import { DEFAULT_TEXTURE_SIZE, cachedTextureCount } from './textures';
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

describe('buildMaterialFromAsset', () => {
  it('matches the legacy builder for an object-coloured default asset', () => {
    const legacy = buildPbrMaterial('#a9744f');
    const built = buildMaterialFromAsset('#a9744f', getMaterialAsset('default'));
    try {
      expect(built.material.color.getHexString()).toBe(
        legacy.material.color.getHexString(),
      );
      expect(built.material.metalness).toBe(legacy.material.metalness);
      expect(built.material.roughness).toBe(legacy.material.roughness);
      expect(built.material.opacity).toBe(legacy.material.opacity);
      expect(built.material.transparent).toBe(legacy.material.transparent);
      expect(built.material.map).toBeNull();
      expect(built.material.normalMap).toBeNull();
      expect(built.missingTextures).toEqual([]);
    } finally {
      legacy.dispose();
      built.dispose();
    }
  });

  it('honours a fixed base colour and PBR channels', () => {
    const built = buildMaterialFromAsset('#000000', getMaterialAsset('wood-oak'));
    try {
      expect(built.material.color.getHexString()).toBe('a9744f');
      expect(built.material.metalness).toBeCloseTo(0, 5);
      expect(built.material.roughness).toBeCloseTo(0.65, 5);
    } finally {
      built.dispose();
    }
  });

  it('uses the object colour when the policy is "object"', () => {
    const built = buildMaterialFromAsset('#123456', getMaterialAsset('default'));
    try {
      expect(built.material.color.getHexString()).toBe('123456');
    } finally {
      built.dispose();
    }
  });

  it('attaches maps with role-based colour spaces and normal scale', () => {
    stubCanvas();
    const built = buildMaterialFromAsset('#111111', getMaterialAsset('wood-oak'));
    try {
      expect(built.material.map).toBeInstanceOf(THREE.CanvasTexture);
      expect(built.material.normalMap).toBeInstanceOf(THREE.CanvasTexture);
      expect(built.material.map?.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(built.material.normalMap?.colorSpace).toBe(THREE.NoColorSpace);
      expect(built.material.normalScale.x).toBeCloseTo(0.3, 5);
      expect(built.material.map?.repeat.x).toBe(1);
      expect(built.missingTextures).toEqual([]);
    } finally {
      built.dispose();
    }
  });

  it('keeps the preview and export texture sizes the same as the legacy path', () => {
    stubCanvas();
    const preview = buildMaterialFromAsset('#111111', getMaterialAsset('fabric-linen'));
    const large = buildMaterialFromAsset('#111111', getMaterialAsset('fabric-linen'), {
      textureSize: 512,
    });
    try {
      expect(mapSize(preview.material.map).width).toBe(DEFAULT_TEXTURE_SIZE);
      expect(mapSize(large.material.map).width).toBe(512);
      expect(preview.material.map?.repeat.x).toBe(2);
    } finally {
      preview.dispose();
      large.dispose();
    }
  });

  it('shares textures and disposes them only after the last user', () => {
    stubCanvas();
    const asset = getMaterialAsset('fabric-linen');
    const first = buildMaterialFromAsset('#111111', asset);
    const second = buildMaterialFromAsset('#222222', asset);
    const map = first.material.map as THREE.Texture;
    const disposed = vi.fn();
    map.addEventListener('dispose', disposed);

    expect(second.material.map).toBe(map);

    first.dispose();
    expect(disposed).not.toHaveBeenCalled();
    second.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(cachedTextureCount()).toBe(0);
  });

  it('tolerates double dispose without releasing someone else\u2019s texture', () => {
    stubCanvas();
    const asset = getMaterialAsset('leather-brown');
    const first = buildMaterialFromAsset('#111111', asset);
    const second = buildMaterialFromAsset('#222222', asset);
    const materialDispose = vi.spyOn(first.material, 'dispose');

    first.dispose();
    first.dispose();
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(second.material.map).toBeInstanceOf(THREE.Texture);

    second.dispose();
    expect(cachedTextureCount()).toBe(0);
  });

  it('reports a missing bitmap map instead of painting something else', () => {
    const asset = {
      ...getMaterialAsset('wood-oak'),
      maps: {
        baseColor: {
          id: 'textures:missing',
          version: 1,
          role: 'baseColor' as const,
          colorSpace: 'srgb' as const,
          wrap: 'repeat' as const,
        },
      },
    };
    const built = buildMaterialFromAsset('#111111', asset);
    try {
      expect(built.missingTextures).toEqual(['baseColor']);
      expect(built.material.map).toBeNull();
      expect(built.material.normalMap).toBeNull();
      expect(built.material.color.getHexString()).toBe('a9744f');
    } finally {
      built.dispose();
      built.dispose();
    }
  });

  it('enforces colour space from the role even when a resolver disagrees', () => {
    const baseTexture = new THREE.Texture();
    const normalTexture = new THREE.Texture();
    baseTexture.colorSpace = THREE.NoColorSpace;
    normalTexture.colorSpace = THREE.SRGBColorSpace;
    const built = buildMaterialFromAsset('#ffffff', getMaterialAsset('wood-oak'), {
      resolveTexture: (ref) => ({
        texture: ref.role === 'baseColor' ? baseTexture : normalTexture,
        dispose: () => undefined,
      }),
    });
    try {
      expect(baseTexture.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(normalTexture.colorSpace).toBe(THREE.NoColorSpace);
      expect(normalTexture.wrapS).toBe(THREE.RepeatWrapping);
    } finally {
      built.dispose();
    }
  });

  it('keeps every preset\u2019s legacy channels and texture presence', () => {
    stubCanvas();
    for (const preset of MATERIAL_PRESETS) {
      const legacy = buildPbrMaterial('#336699', { materialId: preset.id });
      const built = buildMaterialFromAsset('#336699', materialAssetFromPreset(preset));
      try {
        expect(built.material.metalness).toBe(legacy.material.metalness);
        expect(built.material.roughness).toBe(legacy.material.roughness);
        expect(built.material.opacity).toBe(legacy.material.opacity);
        expect(built.material.transparent).toBe(legacy.material.transparent);
        expect(Boolean(built.material.map)).toBe(Boolean(legacy.material.map));
        expect(Boolean(built.material.normalMap)).toBe(Boolean(legacy.material.normalMap));
        if (legacy.material.normalMap) {
          expect(built.material.normalScale.x).toBeCloseTo(legacy.material.normalScale.x, 5);
        }
      } finally {
        legacy.dispose();
        built.dispose();
      }
    }
  });

  it('never writes runtime state back into the serializable asset', () => {
    stubCanvas();
    const asset = getMaterialAsset('wood-oak');
    const before = serializeMaterialAsset(asset);
    const built = buildMaterialFromAsset('#111111', asset);
    try {
      expect(serializeMaterialAsset(asset)).toBe(before);
    } finally {
      built.dispose();
    }
  });
});
