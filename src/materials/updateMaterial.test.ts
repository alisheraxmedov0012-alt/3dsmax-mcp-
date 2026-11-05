// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPbrMaterial } from './buildMaterial';
import { applyMaterialSettings, updateObjectMaterials } from './updateMaterial';
import { getProceduralState } from './buildMaterial';
import { setSlotMaterialInfo } from './materialRuntimeMetadata';
import type { ObjectMaterial } from '../scene/types';

const ONE_PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

let restoreCanvas: (() => void) | null = null;

function installCanvasStub(): void {
  if (restoreCanvas) {
    return;
  }
  const original = document.createElement.bind(document);
  document.createElement = ((tag: string, opts?: unknown) => {
    const element = original(tag, opts as never) as HTMLElement;
    if (tag !== 'canvas') return element;
    const canvas = element as HTMLCanvasElement;
    Object.assign(canvas, {
      getContext: () =>
        new Proxy(
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
              if (property === 'canvas') return canvas;
              return () => undefined;
            },
          },
        ),
      toDataURL: () => ONE_PIXEL_PNG,
    });
    return canvas;
  }) as typeof document.createElement;
  restoreCanvas = () => {
    document.createElement = original;
  };
}

function target(material: Partial<ObjectMaterial>, color = '#a9744f') {
  return { material: material as ObjectMaterial, params: { color } };
}

afterEach(() => {
  restoreCanvas?.();
  restoreCanvas = null;
  vi.restoreAllMocks();
});

describe('updateObjectMaterials', () => {
  it('updates scalars in place without replacing material or geometry', () => {
    installCanvasStub();
    const built = buildPbrMaterial('#a9744f', { materialId: 'wood-oak' });
    const material = built.material;
    const geometry = new THREE.BoxGeometry(10, 10, 10);
    const mesh = new THREE.Mesh(geometry, material);
    const group = new THREE.Group();
    group.add(mesh);
    const materialId = material.uuid;
    const geometryId = geometry.uuid;
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');

    const updated = updateObjectMaterials(group, {
      material: {
        materialId: 'wood-oak',
        metalness: 0.9,
        roughness: 0.1,
        normalStrength: 1.2,
        emissiveIntensity: 2,
        aoIntensity: 0.4,
      },
      params: { color: '#112233' },
    });

    expect(updated).toBe(1);
    expect(material.uuid).toBe(materialId);
    expect(geometry.uuid).toBe(geometryId);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
    expect(material.metalness).toBe(0.9);
    expect(material.roughness).toBe(0.1);
    expect(material.normalScale.x).toBe(1.2);
    expect(material.emissiveIntensity).toBe(2);
    expect(material.aoMapIntensity).toBe(0.4);
    expect(material.color.getHexString()).toBe('112233');
    built.dispose();
  });

  it('does not request a shader recompile for scalar-only updates', () => {
    installCanvasStub();
    const built = buildPbrMaterial('#a9744f', { materialId: 'wood-oak' });
    built.material.needsUpdate = false;
    const version = built.material.version;

    applyMaterialSettings(built.material, target({ metalness: 0.4, roughness: 0.4 }));

    expect(built.material.version).toBe(version);
    built.dispose();
  });

  it('uses the slot preset and slot colour until an object override exists', () => {
    installCanvasStub();
    const built = buildPbrMaterial('#a9744f', { materialId: 'wood-oak' });
    setSlotMaterialInfo(built.material, {
      presetId: 'wood-oak',
      color: '#a9744f',
      scope: 'slot',
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), built.material);
    const group = new THREE.Group();
    group.add(mesh);

    updateObjectMaterials(group, target({}, '#ff0000'));
    expect(built.material.color.getHexString()).toBe('a9744f');
    expect(built.material.roughness).toBeCloseTo(0.65);

    updateObjectMaterials(group, target({ materialId: 'metal-steel', baseColor: '#00ff00' }, '#ff0000'));
    expect(built.material.color.getHexString()).toBe('00ff00');
    expect(built.material.metalness).toBeCloseTo(0.95);

    updateObjectMaterials(group, target({}, '#ff0000'));
    expect(built.material.color.getHexString()).toBe('a9744f');
    expect(built.material.roughness).toBeCloseTo(0.65);
    built.dispose();
  });

  it('follows params.color for a legacy material with stored slot metadata', () => {
    installCanvasStub();
    const built = buildPbrMaterial('#a9744f', { materialId: 'wood-oak' });
    setSlotMaterialInfo(built.material, { presetId: 'wood-oak', color: '#a9744f' });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), built.material);
    const group = new THREE.Group();
    group.add(mesh);

    updateObjectMaterials(group, target({ materialId: 'wood-oak' }, '#00ff00'));
    expect(built.material.color.getHexString()).toBe('00ff00');
    built.dispose();
  });

  it('restores procedural maps when a bitmap is removed', () => {
    installCanvasStub();
    const built = buildPbrMaterial('#a9744f', { materialId: 'wood-oak' });
    const material = built.material;
    const bitmap = new THREE.Texture();
    material.map = bitmap;
    material.normalMap = bitmap;
    material.color.set('#ffffff');

    const changed = applyMaterialSettings(material, target({ materialId: 'wood-oak' }, '#a9744f'));

    expect(material.map).not.toBe(bitmap);
    expect(material.normalMap).not.toBe(bitmap);
    expect(material.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(material.normalMap).toBeInstanceOf(THREE.CanvasTexture);
    expect(material.color.getHexString()).toBe('a9744f');
    expect(changed).toBe(true);
    built.dispose();
  });

  it('clears dedicated data maps when their references are removed', () => {
    installCanvasStub();
    const built = buildPbrMaterial('#ffffff', { materialId: 'default' });
    const material = built.material;
    const bitmap = new THREE.Texture();
    material.roughnessMap = bitmap;
    material.metalnessMap = bitmap;
    material.aoMap = bitmap;
    material.emissiveMap = bitmap;

    applyMaterialSettings(material, target({ materialId: 'default' }, '#ffffff'));

    expect(material.roughnessMap).toBeNull();
    expect(material.metalnessMap).toBeNull();
    expect(material.aoMap).toBeNull();
    expect(material.emissiveMap).toBeNull();
    expect(material.emissive.getHexString()).toBe('000000');
    built.dispose();
  });

  it('keeps ORM channels when no dedicated map overrides them', () => {
    installCanvasStub();
    const built = buildPbrMaterial('#ffffff', { materialId: 'default' });
    const material = built.material;
    const orm = new THREE.Texture();
    material.roughnessMap = orm;
    material.metalnessMap = orm;
    material.aoMap = orm;

    applyMaterialSettings(
      material,
      target(
        {
          materialId: 'default',
          maps: {
            orm: {
              id: 'tex-orm',
              version: 1,
              role: 'orm',
              colorSpace: 'linear',
              wrap: 'repeat',
            },
          },
        },
        '#ffffff',
      ),
    );

    expect(material.roughnessMap).toBe(orm);
    expect(material.metalnessMap).toBe(orm);
    expect(material.aoMap).toBe(orm);
    built.dispose();
  });

  it('regenerates procedural maps when the preset or texture scale changes', () => {
    installCanvasStub();
    const built = buildPbrMaterial('#a9744f', { materialId: 'wood-oak', textureScale: 1 });
    const material = built.material;
    const firstMap = material.map;

    applyMaterialSettings(material, target({ materialId: 'wood-oak', textureScale: 2 }));

    expect(material.map).not.toBe(firstMap);
    expect(material.map).not.toBeNull();
    expect(getProceduralState(material)?.scale).toBe(2);

    applyMaterialSettings(material, target({ materialId: 'glass-clear', textureScale: 2 }));
    expect(material.map).toBeNull();
    expect(material.normalMap).toBeNull();
    expect(getProceduralState(material)?.kind).toBe('none');
    built.dispose();
  });

  it('applies emissive colour and AO intensity to the live material', () => {
    installCanvasStub();
    const built = buildPbrMaterial('#ffffff', { materialId: 'default' });
    const material = built.material;
    material.emissiveMap = new THREE.Texture();
    material.aoMap = new THREE.Texture();

    applyMaterialSettings(
      material,
      target({
        materialId: 'default',
        emissiveColor: '#3366ff',
        emissiveIntensity: 1.5,
        aoIntensity: 0.3,
        maps: {
          emissive: {
            id: 'tex-emissive',
            version: 1,
            role: 'emissive',
            colorSpace: 'srgb',
            wrap: 'repeat',
          },
          ao: {
            id: 'tex-ao',
            version: 1,
            role: 'ao',
            colorSpace: 'linear',
            wrap: 'repeat',
          },
        },
      }),
    );

    expect(material.emissive.getHexString()).toBe('3366ff');
    expect(material.emissiveIntensity).toBe(1.5);
    expect(material.aoMapIntensity).toBe(0.3);
    built.dispose();
  });

  it('keeps one material and one geometry across a slider drag', () => {
    installCanvasStub();
    const built = buildPbrMaterial('#a9744f', { materialId: 'wood-oak' });
    const geometry = new THREE.BoxGeometry(10, 10, 10);
    const mesh = new THREE.Mesh(geometry, built.material);
    const group = new THREE.Group();
    group.add(mesh);
    const materialId = built.material.uuid;
    const geometryId = geometry.uuid;
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const map = built.material.map;

    for (let step = 0; step < 40; step += 1) {
      updateObjectMaterials(group, target({ materialId: 'wood-oak', roughness: step / 40 }));
    }

    expect(built.material.uuid).toBe(materialId);
    expect(geometry.uuid).toBe(geometryId);
    expect(built.material.map).toBe(map);
    expect(geometryDispose).not.toHaveBeenCalled();
    built.dispose();
  });

  it('is idempotent for an unchanged material model', () => {
    installCanvasStub();
    const built = buildPbrMaterial('#a9744f', { materialId: 'wood-oak' });
    const material = built.material;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    const group = new THREE.Group();
    group.add(mesh);
    const model = target({ materialId: 'wood-oak', metalness: 0.1, roughness: 0.5 });

    updateObjectMaterials(group, model);
    material.needsUpdate = false;
    const map = material.map;
    const version = material.version;
    updateObjectMaterials(group, model);

    expect(material.map).toBe(map);
    expect(material.version).toBe(version);
    built.dispose();
  });
});
