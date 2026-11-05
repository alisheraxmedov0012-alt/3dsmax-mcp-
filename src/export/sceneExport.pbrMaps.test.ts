// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportSceneToGlb } from './sceneExport';
import type { TextureProvider } from '../materials/textureRegistry';
import type { TextureAssetRef, TextureMapRole } from '../materials/asset';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  type SceneData,
  type SceneObject,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';

interface GltfJson {
  extensionsUsed?: string[];
  images?: Array<{ mimeType?: string; bufferView?: number; uri?: string }>;
  textures?: Array<{ source?: number }>;
  meshes?: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>;
  materials?: Array<{
    name?: string;
    extensions?: {
      KHR_materials_emissive_strength?: { emissiveStrength?: number };
    };
    normalTexture?: { index: number; scale?: number; texCoord?: number };
    occlusionTexture?: { index: number; texCoord?: number; strength?: number };
    emissiveTexture?: { index: number; texCoord?: number };
    emissiveFactor?: number[];
    pbrMetallicRoughness?: {
      baseColorTexture?: { index: number };
      baseColorFactor?: number[];
      metallicRoughnessTexture?: { index: number; texCoord?: number };
      metallicFactor?: number;
      roughnessFactor?: number;
    };
  }>;
}

const ONE_PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

function installCanvasStub(): () => void {
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
      toBlob: (callback: (blob: Blob | null) => void) => {
        const binary = atob(ONE_PIXEL_PNG.split(',')[1]);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        callback(new Blob([bytes], { type: 'image/png' }));
      },
    });
    return canvas;
  }) as typeof document.createElement;
  return () => {
    document.createElement = original;
  };
}

function parseGlbJson(buffer: ArrayBuffer): GltfJson {
  const view = new DataView(buffer);
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)),
  ) as GltfJson;
}

function ref(role: TextureMapRole): TextureAssetRef {
  return {
    id: `tex-${role.toLowerCase()}`,
    version: 1,
    role,
    colorSpace: role === 'emissive' || role === 'baseColor' ? 'srgb' : 'linear',
    wrap: 'repeat',
  };
}

function sceneOf(object: SceneObject): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects: [object],
    settings: createDefaultSettings(),
  };
}

class FakeProvider implements TextureProvider {
  readonly acquire = vi.fn(async (acquiredRef: TextureAssetRef) => {
    const texture = new THREE.CanvasTexture(document.createElement('canvas'));
    texture.name = acquiredRef.role;
    return texture;
  });
  readonly release = vi.fn();
}

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

function materialOf(json: GltfJson) {
  const material = json.materials?.find((entry) => entry.name === 'table-material');
  expect(material).toBeTruthy();
  return material as NonNullable<GltfJson['materials']>[number];
}

describe('GLB export with advanced PBR maps', () => {
  it('embeds normal, metallic-roughness, occlusion and emissive textures', async () => {
    restore = installCanvasStub();
    const provider = new FakeProvider();
    const object = createFurnitureSceneObject('table', 'obj-1', {
      material: {
        metalness: 0.3,
        roughness: 0.4,
        normalStrength: 0.6,
        emissiveIntensity: 2,
        emissiveColor: '#3366ff',
        aoIntensity: 0.4,
        baseColor: '#808080',
        maps: {
          normal: ref('normal'),
          roughness: ref('roughness'),
          metalness: ref('metalness'),
          ao: ref('ao'),
          emissive: ref('emissive'),
        },
      },
    });

    const glb = await exportSceneToGlb(sceneOf(object), {
      includeRoom: false,
      textureProvider: provider,
    });
    const json = parseGlbJson(glb);
    const material = materialOf(json);

    expect(provider.acquire).toHaveBeenCalledTimes(5);
    expect(provider.release).toHaveBeenCalledTimes(5);

    expect(material.normalTexture?.index).toBeTypeOf('number');
    expect(material.normalTexture?.scale).toBeCloseTo(0.6);
    expect(material.normalTexture?.texCoord).toBe(0);
    expect(material.pbrMetallicRoughness?.metallicRoughnessTexture?.index).toBeTypeOf(
      'number',
    );
    expect(material.pbrMetallicRoughness?.metallicFactor).toBeCloseTo(0.3);
    expect(material.pbrMetallicRoughness?.roughnessFactor).toBeCloseTo(0.4);
    expect(material.occlusionTexture?.index).toBeTypeOf('number');
    expect(material.occlusionTexture?.texCoord).toBe(0);
    expect(material.occlusionTexture?.strength).toBeCloseTo(0.4);
    expect(material.emissiveTexture?.index).toBeTypeOf('number');
    const expectedEmissive = new THREE.Color('#3366ff').toArray();
    expect(material.emissiveFactor).toHaveLength(3);
    material.emissiveFactor?.forEach((value, index) => {
      expect(value).toBeCloseTo(expectedEmissive[index], 5);
    });
    expect(material.extensions?.KHR_materials_emissive_strength?.emissiveStrength).toBe(2);
    expect(json.extensionsUsed).toContain('KHR_materials_emissive_strength');

    const expectedBase = new THREE.Color('#808080').toArray();
    material.pbrMetallicRoughness?.baseColorFactor?.slice(0, 3).forEach((value, index) => {
      expect(value).toBeCloseTo(expectedBase[index], 5);
    });

    // AO uses the primary UV attribute produced by Phase 4.4; no uv1 is needed.
    const attributes = json.meshes?.[0]?.primitives[0]?.attributes;
    expect(attributes?.TEXCOORD_0).toBeTypeOf('number');
    expect(attributes?.TEXCOORD_1).toBeUndefined();

    // Roughness and metalness are separate uploads but glTF merges them into a
    // single metallic-roughness image, so four images are embedded: normal,
    // merged metallic-roughness, occlusion and emissive.
    expect(json.images).toHaveLength(4);
    for (const image of json.images ?? []) {
      expect(image.mimeType).toBe('image/png');
      expect(typeof image.bufferView).toBe('number');
      expect(image.uri).toBeUndefined();
    }
  });

  it('exports a packed ORM image through the shared occlusion + metallic-roughness texture', async () => {
    restore = installCanvasStub();
    const provider = new FakeProvider();
    const object = createFurnitureSceneObject('table', 'obj-1', {
      material: { metalness: 0.5, roughness: 0.5, maps: { orm: ref('orm') } },
    });

    const glb = await exportSceneToGlb(sceneOf(object), {
      includeRoom: false,
      textureProvider: provider,
    });
    const json = parseGlbJson(glb);
    const material = materialOf(json);

    expect(provider.acquire).toHaveBeenCalledTimes(1);
    expect(json.images).toHaveLength(1);
    // glTF R=occlusion, G=roughness, B=metalness: one image serves both slots.
    expect(material.occlusionTexture?.index).toBe(
      material.pbrMetallicRoughness?.metallicRoughnessTexture?.index,
    );
  });

  it('lets a dedicated roughness map override the ORM green channel', async () => {
    restore = installCanvasStub();
    const provider = new FakeProvider();
    const object = createFurnitureSceneObject('table', 'obj-1', {
      material: {
        metalness: 0.5,
        roughness: 0.5,
        maps: { orm: ref('orm'), roughness: ref('roughness') },
      },
    });

    const glb = await exportSceneToGlb(sceneOf(object), {
      includeRoom: false,
      textureProvider: provider,
    });
    const material = materialOf(parseGlbJson(glb));

    expect(material.occlusionTexture?.index).toBeTypeOf('number');
    expect(material.pbrMetallicRoughness?.metallicRoughnessTexture?.index).toBeTypeOf(
      'number',
    );
    // A dedicated roughness map forces the exporter to build a merged
    // metallic-roughness image, so it is not the ORM source index.
    expect(material.pbrMetallicRoughness?.metallicRoughnessTexture?.index).not.toBe(
      material.occlusionTexture?.index,
    );
  });

  it('fails clearly when one map cannot load and releases the rest', async () => {
    restore = installCanvasStub();
    const provider: TextureProvider = {
      acquire: vi.fn(async (acquiredRef: TextureAssetRef) => {
        if (acquiredRef.role === 'emissive') {
          throw new Error('missing texture');
        }
        return new THREE.CanvasTexture(document.createElement('canvas'));
      }),
      release: vi.fn(),
    };
    const object = createFurnitureSceneObject('table', 'obj-1', {
      material: {
        metalness: 0,
        roughness: 0.5,
        maps: { normal: ref('normal'), emissive: ref('emissive') },
      },
    });

    await expect(
      exportSceneToGlb(sceneOf(object), { includeRoom: false, textureProvider: provider }),
    ).rejects.toThrow(/Emissive teksturasi \(tex-emissive@1\) yuklanmadi/);
    expect(provider.release).toHaveBeenCalledTimes(1);
  });

  it('does not mutate the scene data used for the export', async () => {
    restore = installCanvasStub();
    const provider = new FakeProvider();
    const scene = sceneOf(
      createFurnitureSceneObject('table', 'obj-1', {
        material: {
          metalness: 0,
          roughness: 0.5,
          maps: { normal: ref('normal'), roughness: ref('roughness') },
        },
      }),
    );
    const before = JSON.stringify(scene);
    await exportSceneToGlb(scene, { includeRoom: false, textureProvider: provider });
    expect(JSON.stringify(scene)).toBe(before);
  });
});
