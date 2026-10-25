// @vitest-environment jsdom
/**
 * A2.1 — every furniture type picks up the W4 PBR material and its procedural
 * texture.
 *
 * Before this change only the legacy table builder called `buildPbrMaterial`; the
 * seven `PartBuilder`-based types constructed a bare `MeshStandardMaterial`, so a
 * wardrobe or a sofa could never show a texture no matter which preset the user
 * chose. These tests pin the wiring, the sharing, and the fallback.
 *
 * The canvas stand-in below is the one piece of environment this suite has to
 * fabricate: jsdom has no canvas backend, so `getContext('2d')` returns null and
 * no real bitmap can be produced. The stub supplies the drawing calls and a PNG
 * data URL, which is exactly what a browser provides. The product code under test
 * is untouched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { buildFurniture } from '../geometry/furniture/buildFurniture';
import {
  FURNITURE_TYPES,
  createFurnitureParams,
  type FurnitureType,
  type FurnitureParams,
} from '../geometry/furniture/types';
import { measurePartBoxes } from '../manufacturing/partBoxes';
import { buildPbrMaterial } from './buildMaterial';
import { cachedTextureCount } from './textures';
import { MATERIAL_PRESETS } from './presets';

/** A 1x1 opaque PNG, used as the bitmap a real canvas would produce. */
const ONE_PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

type StubOptions = { noContext?: boolean };

/**
 * Replace `document.createElement('canvas')` with a canvas that behaves like a
 * browser one: it can be drawn on and can produce a PNG.
 */
function installCanvasStub(options: StubOptions = {}): () => void {
  const original = document.createElement.bind(document);
  const patched = (tag: string, opts?: unknown): HTMLElement => {
    const element = original(tag, opts as never) as HTMLElement;
    if (tag !== 'canvas') {
      return element;
    }
    const canvas = element as HTMLCanvasElement;
    const stub = {
      getContext: () =>
        options.noContext
          ? null
          : new Proxy(
              {},
              {
                get: (_target, property) => {
                  if (property === 'createImageData' || property === 'getImageData') {
                    return (width: number, height: number) => ({
                      data: new Uint8ClampedArray(width * height * 4).fill(180),
                      width,
                      height,
                    });
                  }
                  if (property === 'canvas') {
                    return canvas;
                  }
                  return () => undefined;
                },
              },
            ),
      toDataURL: () => ONE_PIXEL_PNG,
      toBlob: (callback: (blob: Blob | null) => void) => {
        const base64 = ONE_PIXEL_PNG.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        callback(new Blob([bytes], { type: 'image/png' }));
      },
    };
    Object.assign(canvas, stub);
    return canvas;
  };
  document.createElement = patched as typeof document.createElement;
  return () => {
    document.createElement = original;
  };
}

function meshesOf(group: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh === true) {
      meshes.push(child as THREE.Mesh);
    }
  });
  return meshes;
}

function build(type: FurnitureType, params?: Partial<FurnitureParams>, materialId = 'wood-oak') {
  const base: FurnitureParams = { ...createFurnitureParams(type), ...params } as FurnitureParams;
  return buildFurniture(type, base, { materialId });
}

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

describe('A2.1 — every furniture type gets the PBR material', () => {
  it('attaches one PBR material with a texture to each type', () => {
    restore = installCanvasStub();
    for (const type of FURNITURE_TYPES) {
      const built = build(type);
      try {
        const meshes = meshesOf(built.group);
        expect(meshes.length, type).toBeGreaterThan(0);

        // One material per object: every part shares it, so a piece never
        // allocates a material per mesh.
        const materials = new Set(meshes.map((mesh) => mesh.material));
        expect(materials.size, type).toBe(1);

        const material = meshes[0].material as THREE.MeshStandardMaterial;
        expect(material.isMeshStandardMaterial, type).toBe(true);
        expect(material.map, `${type} map`).toBeInstanceOf(THREE.Texture);
        expect(material.normalMap, `${type} normalMap`).toBeInstanceOf(THREE.Texture);
        expect(material.normalScale.x).toBeGreaterThan(0);
      } finally {
        built.dispose();
      }
    }
  });

  it('names the material after the furniture group', () => {
    restore = installCanvasStub();
    const built = build('wardrobe');
    try {
      expect((meshesOf(built.group)[0].material as THREE.Material).name).toBe('wardrobe-material');
    } finally {
      built.dispose();
    }
  });

  it('keeps the object colour as the albedo, not the preset colour', () => {
    restore = installCanvasStub();
    const params = { ...createFurnitureParams('shelf'), color: '#123456' } as FurnitureParams;
    const built = buildFurniture('shelf', params, { materialId: 'wood-oak' });
    try {
      const material = meshesOf(built.group)[0].material as THREE.MeshStandardMaterial;
      // The wood preset suggests #a9744f, but the object's own colour wins.
      expect(material.color.getHexString()).toBe('123456');
    } finally {
      built.dispose();
    }
  });

  it('applies preset PBR channels per type', () => {
    restore = installCanvasStub();
    for (const type of FURNITURE_TYPES) {
      const built = build(type, undefined, 'metal-steel');
      try {
        const material = meshesOf(built.group)[0].material as THREE.MeshStandardMaterial;
        expect(material.metalness, type).toBeCloseTo(0.95, 5);
        expect(material.roughness, type).toBeCloseTo(0.3, 5);
        // A metal preset is textured (brushed), so the map must be present.
        expect(material.map, `${type} metal map`).toBeInstanceOf(THREE.Texture);
      } finally {
        built.dispose();
      }
    }
  });

  it('leaves a texture-less preset without a map', () => {
    restore = installCanvasStub();
    for (const type of FURNITURE_TYPES) {
      const built = build(type, undefined, 'default');
      try {
        const material = meshesOf(built.group)[0].material as THREE.MeshStandardMaterial;
        expect(material.map, type).toBeNull();
        expect(material.normalMap, type).toBeNull();
      } finally {
        built.dispose();
      }
    }
  });

  it('keeps glass transparent and every other preset opaque', () => {
    restore = installCanvasStub();
    for (const type of FURNITURE_TYPES) {
      const glass = build(type, undefined, 'glass-clear');
      try {
        const material = meshesOf(glass.group)[0].material as THREE.MeshStandardMaterial;
        expect(material.transparent, type).toBe(true);
        expect(material.opacity).toBeCloseTo(0.3, 5);
      } finally {
        glass.dispose();
      }

      const wood = build(type, undefined, 'wood-oak');
      try {
        const material = meshesOf(wood.group)[0].material as THREE.MeshStandardMaterial;
        expect(material.transparent, type).toBe(false);
        expect(material.opacity).toBe(1);
      } finally {
        wood.dispose();
      }
    }
  });
});

describe('A2.1 — textures are shared, not re-generated per object', () => {
  it('reuses one texture set for the same preset and scale', () => {
    restore = installCanvasStub();
    const first = buildPbrMaterial('#a9744f', { materialId: 'wood-oak' });
    const second = buildPbrMaterial('#336699', { materialId: 'wood-oak' });
    try {
      // Different objects, different colours — but the same bitmap.
      expect(second.material.map).toBe(first.material.map);
      expect(second.material.normalMap).toBe(first.material.normalMap);
      expect(second.material.color.getHexString()).not.toBe(
        first.material.color.getHexString(),
      );
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it('keeps the textures alive until the last user releases them', () => {
    restore = installCanvasStub();
    const first = buildPbrMaterial('#111111', { materialId: 'wood-oak' });
    const map = first.material.map as THREE.Texture;
    const disposed = vi.fn();
    map.addEventListener('dispose', disposed);

    const second = buildPbrMaterial('#222222', { materialId: 'wood-oak' });
    first.dispose();
    // Still one live user, so the shared bitmap must not be released.
    expect(disposed).not.toHaveBeenCalled();

    second.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(cachedTextureCount()).toBe(0);
  });

  it('generates a separate set when the texture scale differs', () => {
    restore = installCanvasStub();
    const base = buildPbrMaterial('#a9744f', { materialId: 'wood-oak' });
    const scaled = buildPbrMaterial('#a9744f', { materialId: 'wood-oak', textureScale: 4 });
    try {
      expect(scaled.material.map).not.toBe(base.material.map);
      expect((scaled.material.map as THREE.Texture).repeat.x).toBe(4);
    } finally {
      base.dispose();
      scaled.dispose();
    }
  });

  it('tolerates a double dispose without freeing someone else\'s texture', () => {
    restore = installCanvasStub();
    const first = buildPbrMaterial('#111111', { materialId: 'fabric-linen' });
    const second = buildPbrMaterial('#222222', { materialId: 'fabric-linen' });
    first.dispose();
    first.dispose();
    // The second holder still owns a usable texture.
    expect(second.material.map).toBeInstanceOf(THREE.Texture);
    second.dispose();
    expect(cachedTextureCount()).toBe(0);
  });

  it('does not allocate textures for the untextured default preset', () => {
    restore = installCanvasStub();
    const before = cachedTextureCount();
    const built = buildPbrMaterial('#a9744f', { materialId: 'default' });
    try {
      expect(built.material.map).toBeNull();
      expect(cachedTextureCount()).toBe(before);
    } finally {
      built.dispose();
    }
  });
});

describe('A2.1 — safe fallback without a canvas backend', () => {
  it('still builds a valid material when no 2D context is available', () => {
    restore = installCanvasStub({ noContext: true });
    for (const type of FURNITURE_TYPES) {
      const built = build(type);
      try {
        const meshes = meshesOf(built.group);
        expect(meshes.length, type).toBeGreaterThan(0);
        const material = meshes[0].material as THREE.MeshStandardMaterial;
        // Documented fallback: PBR channels render, detail map is absent.
        expect(material.map, type).toBeNull();
        expect(material.metalness).toBeCloseTo(0, 5);
        expect(material.roughness).toBeCloseTo(0.65, 5);
      } finally {
        built.dispose();
      }
    }
  });

  it('builds every type without a document at all', () => {
    // No stub installed: jsdom is present, but the point is that nothing throws
    // when texture creation is impossible.
    for (const type of FURNITURE_TYPES) {
      const built = build(type);
      try {
        expect(meshesOf(built.group).length, type).toBeGreaterThan(0);
      } finally {
        built.dispose();
      }
    }
  });
});

describe('A2.1 — unknown presets fall back safely', () => {
  it('renders with the default preset when the id is not in the catalogue', () => {
    restore = installCanvasStub();
    const built = buildFurniture('table', createFurnitureParams('table'), {
      materialId: 'does-not-exist',
    });
    try {
      const material = meshesOf(built.group)[0].material as THREE.MeshStandardMaterial;
      expect(material.map).toBeNull();
      expect(material.metalness).toBeCloseTo(0.05, 5);
      expect(material.roughness).toBeCloseTo(0.6, 5);
    } finally {
      built.dispose();
    }
  });

  it('covers every preset in the catalogue without throwing', () => {
    restore = installCanvasStub();
    for (const type of FURNITURE_TYPES) {
      for (const preset of MATERIAL_PRESETS) {
        const built = build(type, undefined, preset.id);
        try {
          const material = meshesOf(built.group)[0].material as THREE.MeshStandardMaterial;
          expect(material.isMeshStandardMaterial, `${type}/${preset.id}`).toBe(true);
        } finally {
          built.dispose();
        }
      }
    }
    expect(cachedTextureCount()).toBe(0);
  });
});

describe('A2.1 — geometry is untouched by the material change', () => {
  it('produces identical part boxes with and without a texture', () => {
    restore = installCanvasStub();
    for (const type of FURNITURE_TYPES) {
      const params = createFurnitureParams(type);

      const plain = buildFurniture(type, params);
      const plainBoxes = measurePartBoxes(plain.group);
      plain.dispose();

      const textured = buildFurniture(type, params, { materialId: 'wood-oak' });
      const texturedBoxes = measurePartBoxes(textured.group);
      textured.dispose();

      expect(texturedBoxes, type).toEqual(plainBoxes);
    }
  });
});
