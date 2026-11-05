// @vitest-environment jsdom
/**
 * Phase 4.7 — exported GLB inspection ("round-trip QA" at the file level).
 *
 * The project has no general-purpose GLB import pipeline, so this validates the
 * produced container directly: header/chunks, meshes, accessors, materials,
 * textures, embedded images and UV attributes. The Chromium harness
 * (`npm run test:glb`) separately proves that Three's GLTFLoader can parse and
 * render the same export path.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportSceneToGlb } from './sceneExport';
import { ExportError } from './exportTypes';
import { ApiRequestError } from '../api/client';
import { TextureRegistry, type TextureProvider } from '../materials/textureRegistry';
import type { TextureAssetRef, TextureMapRole } from '../materials/asset';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  type SceneData,
  type SceneObject,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';

const ONE_PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let restoreCanvas: (() => void) | null = null;

function installCanvasStub(): void {
  if (restoreCanvas) return;
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
  restoreCanvas = () => {
    document.createElement = original;
  };
}

interface TextureInfo {
  index: number;
  texCoord?: number;
  scale?: number;
  strength?: number;
  extensions?: { KHR_texture_transform?: { scale?: number[]; offset?: number[] } };
}

interface GltfJson {
  asset?: { version?: string };
  extensionsUsed?: string[];
  buffers?: Array<{ uri?: string; byteLength: number }>;
  bufferViews?: Array<{ byteOffset?: number; byteLength: number }>;
  accessors?: Array<{
    bufferView?: number;
    count: number;
    type: string;
    componentType: number;
    min?: number[];
    max?: number[];
  }>;
  images?: Array<{ mimeType?: string; bufferView?: number; uri?: string }>;
  textures?: Array<{ source?: number; extensions?: unknown }>;
  samplers?: Array<{ wrapS?: number; wrapT?: number }>;
  meshes?: Array<{
    name?: string;
    primitives: Array<{
      attributes: Record<string, number>;
      indices?: number;
      material?: number;
    }>;
  }>;
  materials?: Array<{
    name?: string;
    alphaMode?: string;
    normalTexture?: TextureInfo;
    occlusionTexture?: TextureInfo;
    emissiveTexture?: TextureInfo;
    emissiveFactor?: number[];
    extensions?: {
      KHR_materials_emissive_strength?: { emissiveStrength?: number };
    };
    pbrMetallicRoughness?: {
      baseColorFactor?: number[];
      baseColorTexture?: TextureInfo;
      metallicFactor?: number;
      roughnessFactor?: number;
      metallicRoughnessTexture?: TextureInfo;
    };
  }>;
}

interface Glb {
  json: GltfJson;
  bin: Uint8Array;
}

function parseGlb(buffer: ArrayBuffer): Glb {
  const view = new DataView(buffer);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  expect(view.getUint32(4, true)).toBe(2);
  expect(view.getUint32(8, true)).toBe(buffer.byteLength);

  let json: GltfJson | null = null;
  let bin: Uint8Array | null = null;
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const bytes = new Uint8Array(buffer, offset + 8, length);
    if (type === 0x4e4f534a) {
      json = JSON.parse(new TextDecoder().decode(bytes)) as GltfJson;
    } else if (type === 0x004e4942) {
      bin = bytes;
    }
    offset += 8 + length;
  }
  if (!json || !bin) throw new Error('GLB missing JSON or BIN chunk');
  return { json, bin };
}

function ref(role: TextureMapRole, id = `tex-${role}`): TextureAssetRef {
  return {
    id,
    version: 1,
    role,
    colorSpace: role === 'baseColor' || role === 'emissive' ? 'srgb' : 'linear',
    wrap: 'repeat',
  };
}

function sceneOf(...objects: SceneObject[]): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects,
    settings: createDefaultSettings(),
  };
}

/** Models the real registry: one texture per ref + repeat, shared by callers. */
class SharedTextureProvider implements TextureProvider {
  private readonly cache = new Map<string, THREE.Texture>();
  readonly released: Array<TextureAssetRef> = [];

  acquire = vi.fn(async (value: TextureAssetRef, options?: { repeat?: number }) => {
    const repeat = options?.repeat ?? 1;
    const key = `${value.id}@${value.version}|${value.role}|${value.wrap}|${repeat}`;
    let texture = this.cache.get(key);
    if (!texture) {
      texture = new THREE.CanvasTexture(document.createElement('canvas'));
      texture.name = value.role;
      texture.repeat.set(repeat, repeat);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.channel = 0;
      this.cache.set(key, texture);
    }
    return texture;
  });

  release = vi.fn((value: TextureAssetRef) => {
    this.released.push(value);
  });
}

function objectWithAllMaps(): SceneObject {
  return createFurnitureSceneObject('table', 'obj-1', {
    material: {
      metalness: 0.3,
      roughness: 0.4,
      opacity: 0.65,
      textureScale: 2,
      normalStrength: 0.6,
      emissiveIntensity: 2,
      emissiveColor: '#3366ff',
      aoIntensity: 0.4,
      baseColor: '#808080',
      maps: {
        baseColor: ref('baseColor'),
        normal: ref('normal'),
        roughness: ref('roughness'),
        metalness: ref('metalness'),
        ao: ref('ao'),
        emissive: ref('emissive'),
      },
    },
  });
}

function materialOf(json: GltfJson): NonNullable<GltfJson['materials']>[number] {
  const material = json.materials?.find((entry) => entry.name === 'table-material');
  expect(material).toBeTruthy();
  return material as NonNullable<GltfJson['materials']>[number];
}

function assertTextureInfo(
  json: GltfJson,
  info: TextureInfo | undefined,
  label: string,
): asserts info is TextureInfo {
  expect(info, label).toBeTruthy();
  expect(info?.index).toBeGreaterThanOrEqual(0);
  expect(info?.index).toBeLessThan(json.textures?.length ?? 0);
  expect(info?.texCoord ?? 0).toBe(0);
  const transform = info?.extensions?.KHR_texture_transform;
  expect(transform?.scale?.[0], label).toBeCloseTo(2);
  expect(transform?.scale?.[1], label).toBeCloseTo(2);
}

function assertAccessor(
  json: GltfJson,
  index: number | undefined,
  label: string,
  type: string,
  componentTypes: readonly number[] = [5126],
): void {
  expect(index, label).toBeTypeOf('number');
  const accessor = json.accessors?.[index as number];
  expect(accessor, label).toBeTruthy();
  expect(accessor?.type).toBe(type);
  expect(accessor?.count).toBeGreaterThan(0);
  expect(componentTypes).toContain(accessor?.componentType);
  expect(accessor?.bufferView).toBeTypeOf('number');
  expect(json.bufferViews?.[accessor?.bufferView as number]).toBeTruthy();
}

afterEach(() => {
  restoreCanvas?.();
  restoreCanvas = null;
});

describe('GLB round-trip QA', () => {
  it('preserves PBR factors, textures, UVs and embedded images', async () => {
    installCanvasStub();
    const provider = new SharedTextureProvider();
    const scene = sceneOf(objectWithAllMaps());
    const before = JSON.stringify(scene);

    const glb = await exportSceneToGlb(scene, {
      includeRoom: false,
      textureProvider: provider,
    });
    const { json, bin } = parseGlb(glb);

    // Container and embedded resources.
    expect(json.asset?.version).toBe('2.0');
    expect(json.buffers).toHaveLength(1);
    expect(json.buffers?.[0].uri).toBeUndefined();
    expect(json.buffers?.[0].byteLength).toBe(bin.byteLength);
    expect(json.images).toHaveLength(5);
    for (const image of json.images ?? []) {
      expect(image.mimeType).toBe('image/png');
      expect(image.uri).toBeUndefined();
      expect(image.bufferView).toBeTypeOf('number');
      const view = json.bufferViews?.[image.bufferView as number];
      expect(view).toBeTruthy();
      const bytes = bin.subarray(
        view?.byteOffset ?? 0,
        (view?.byteOffset ?? 0) + (view?.byteLength ?? 0),
      );
      expect(Array.from(bytes.subarray(0, 8))).toEqual(PNG_SIGNATURE);
    }
    expect(json.textures).toHaveLength(5);
    for (const texture of json.textures ?? []) {
      expect(texture.source).toBeTypeOf('number');
      expect(texture.source).toBeLessThan(json.images?.length ?? 0);
    }
    expect(json.samplers?.length).toBeGreaterThan(0);
    // GL_REPEAT / GL_CLAMP_TO_EDGE, matching the scene's wrap policy.
    expect(json.samplers?.[0].wrapS).toBe(10497);
    expect(json.samplers?.[0].wrapT).toBe(10497);

    // Geometry and UV integrity.
    expect(json.meshes?.length ?? 0).toBeGreaterThan(0);
    let bboxMin = Infinity;
    for (const mesh of json.meshes ?? []) {
      expect(mesh.name).toBeTruthy();
      expect(mesh.primitives.length).toBeGreaterThan(0);
      for (const primitive of mesh.primitives) {
        assertAccessor(json, primitive.attributes.POSITION, 'POSITION', 'VEC3');
        assertAccessor(json, primitive.attributes.NORMAL, 'NORMAL', 'VEC3');
        assertAccessor(json, primitive.attributes.TEXCOORD_0, 'TEXCOORD_0', 'VEC2');
        expect(primitive.attributes.TEXCOORD_1).toBeUndefined();
        if (primitive.indices !== undefined) {
          assertAccessor(json, primitive.indices, 'indices', 'SCALAR', [5121, 5123, 5125]);
        }
        if (primitive.material !== undefined) {
          expect(primitive.material).toBeLessThan(json.materials?.length ?? 0);
        }
        const position = json.accessors?.[primitive.attributes.POSITION];
        expect(position?.min).toHaveLength(3);
        expect(position?.max).toHaveLength(3);
        for (const value of [...(position?.min ?? []), ...(position?.max ?? [])]) {
          expect(Number.isFinite(value)).toBe(true);
        }
        bboxMin = Math.min(bboxMin, position?.min?.[0] ?? Infinity);
      }
    }
    expect(Number.isFinite(bboxMin)).toBe(true);

    // Material channels.
    const material = materialOf(json);
    expect(material.alphaMode).toBe('BLEND');
    expect(material.pbrMetallicRoughness?.metallicFactor).toBeCloseTo(0.3);
    expect(material.pbrMetallicRoughness?.roughnessFactor).toBeCloseTo(0.4);
    expect(material.pbrMetallicRoughness?.baseColorFactor?.[3]).toBeCloseTo(0.65);
    assertTextureInfo(json, material.pbrMetallicRoughness?.baseColorTexture, 'baseColor');
    assertTextureInfo(json, material.normalTexture, 'normal');
    expect(material.normalTexture?.scale).toBeCloseTo(0.6);
    assertTextureInfo(
      json,
      material.pbrMetallicRoughness?.metallicRoughnessTexture,
      'metallicRoughness',
    );
    assertTextureInfo(json, material.occlusionTexture, 'occlusion');
    expect(material.occlusionTexture?.strength).toBeCloseTo(0.4);
    assertTextureInfo(json, material.emissiveTexture, 'emissive');
    expect(material.emissiveFactor).toHaveLength(3);
    expect(material.extensions?.KHR_materials_emissive_strength?.emissiveStrength).toBe(2);
    expect(json.extensionsUsed).toContain('KHR_materials_emissive_strength');
    expect(json.extensionsUsed).toContain('KHR_texture_transform');

    // No source/runtime data was touched by export.
    expect(JSON.stringify(scene)).toBe(before);
    expect(provider.released).toHaveLength(6);
    const acquiredTextures = await Promise.all(
      provider.acquire.mock.results.map((result) => result.value),
    );
    for (const value of acquiredTextures) {
      expect(value.channel).toBe(0);
      expect(value.repeat.x).toBe(2);
    }
  });

  it('embeds one shared image when several materials use the same texture', async () => {
    installCanvasStub();
    const provider = new SharedTextureProvider();
    const a = createFurnitureSceneObject('table', 'a', {
      material: { metalness: 0, roughness: 0.5, maps: { baseColor: ref('baseColor', 'shared') } },
    });
    const b = createFurnitureSceneObject('table', 'b', {
      material: { metalness: 0, roughness: 0.5, maps: { baseColor: ref('baseColor', 'shared') } },
    });

    const glb = await exportSceneToGlb(sceneOf(a, b), {
      includeRoom: false,
      textureProvider: provider,
    });
    const { json } = parseGlb(glb);

    expect(json.images).toHaveLength(1);
    expect(json.textures).toHaveLength(1);
    expect(json.materials).toHaveLength(2);
    const indices = (json.materials ?? []).map(
      (material) => material.pbrMetallicRoughness?.baseColorTexture?.index,
    );
    expect(indices[0]).toBe(indices[1]);
    expect(indices[0]).toBe(0);
    expect(provider.acquire).toHaveBeenCalledTimes(2);
    expect(provider.released).toHaveLength(2);
  });

  it('exports a packed ORM image as one shared occlusion/metallic-roughness texture', async () => {
    installCanvasStub();
    const provider = new SharedTextureProvider();
    const object = createFurnitureSceneObject('table', 'orm', {
      material: {
        metalness: 0.5,
        roughness: 0.5,
        maps: { orm: ref('orm') },
      },
    });

    const glb = await exportSceneToGlb(sceneOf(object), {
      includeRoom: false,
      textureProvider: provider,
    });
    const { json } = parseGlb(glb);
    const material = materialOf(json);

    expect(json.images).toHaveLength(1);
    expect(material.occlusionTexture?.index).toBe(
      material.pbrMetallicRoughness?.metallicRoughnessTexture?.index,
    );
  });

  it('aborts with a typed error and releases every successful acquisition', async () => {
    installCanvasStub();
    const provider: TextureProvider = {
      acquire: vi.fn(async (value: TextureAssetRef) => {
        if (value.role === 'emissive') {
          throw new Error('asset bytes are corrupt');
        }
        return new THREE.CanvasTexture(document.createElement('canvas'));
      }),
      release: vi.fn(),
    };
    const object = createFurnitureSceneObject('table', 'broken', {
      material: {
        metalness: 0,
        roughness: 0.5,
        maps: {
          baseColor: ref('baseColor'),
          normal: ref('normal'),
          emissive: ref('emissive'),
        },
      },
    });
    const scene = sceneOf(object);
    const before = JSON.stringify(scene);

    await expect(
      exportSceneToGlb(scene, { includeRoom: false, textureProvider: provider }),
    ).rejects.toMatchObject<Partial<ExportError>>({
      code: 'failed',
      message: expect.stringContaining('Emissive teksturasi (tex-emissive@1)'),
    });
    expect(provider.release).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(scene)).toBe(before);
  });

  it('wraps an unreadable texture image in a typed ExportError', async () => {
    installCanvasStub();
    const provider: TextureProvider = {
      acquire: vi.fn(async () => {
        // A texture whose image is not a DOM image/canvas/bitmap: GLTFExporter
        // rejects it. The public API must still report a typed export failure.
        return new THREE.Texture({});
      }),
      release: vi.fn(),
    };
    const object = createFurnitureSceneObject('table', 'bad-image', {
      material: {
        metalness: 0,
        roughness: 0.5,
        maps: { baseColor: ref('baseColor') },
      },
    });

    await expect(
      exportSceneToGlb(sceneOf(object), { includeRoom: false, textureProvider: provider }),
    ).rejects.toMatchObject<Partial<ExportError>>({
      code: 'failed',
      message: expect.stringContaining("GLB faylini yozib bo'lmadi"),
    });
    expect(provider.release).toHaveBeenCalledTimes(1);
  });

  it('fails a real registry miss and leaves no cached texture behind', async () => {
    installCanvasStub();
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 2, height: 2, close })),
    );
    const registry = new TextureRegistry(async (id: string) => {
      if (id === 'tex-missing') {
        throw new ApiRequestError('texture_not_found', 'missing', 404);
      }
      return new Blob(['png'], { type: 'image/png' });
    });
    const object = createFurnitureSceneObject('table', 'registry-miss', {
      material: {
        metalness: 0,
        roughness: 0.5,
        maps: {
          baseColor: ref('baseColor', 'tex-ok'),
          normal: ref('normal', 'tex-missing'),
        },
      },
    });

    await expect(
      exportSceneToGlb(sceneOf(object), { includeRoom: false, textureProvider: registry }),
    ).rejects.toMatchObject<Partial<ExportError>>({
      code: 'failed',
      message: expect.stringContaining('Normal teksturasi (tex-missing@1)'),
    });
    expect(registry.size()).toBe(0);
    expect(close).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
