// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportSceneToGlb } from './sceneExport';
import type { TextureProvider } from '../materials/textureRegistry';
import type { TextureAssetRef } from '../materials/asset';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  type SceneData,
  type SceneObject,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';

const REF: TextureAssetRef = {
  id: 'tex-12345678',
  version: 1,
  role: 'baseColor',
  colorSpace: 'srgb',
  wrap: 'repeat',
};

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

interface GltfJson {
  images?: Array<{ mimeType?: string; bufferView?: number; uri?: string }>;
  textures?: Array<{ source?: number }>;
  materials?: Array<{
    name?: string;
    pbrMetallicRoughness?: { baseColorTexture?: { index: number } };
  }>;
  buffers?: Array<{ uri?: string }>;
}

function parseGlbJson(buffer: ArrayBuffer): GltfJson {
  const view = new DataView(buffer);
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)),
  ) as GltfJson;
}

function objectWithTexture(): SceneObject {
  return createFurnitureSceneObject('table', 'obj-1', {
    material: { metalness: 0, roughness: 0.5, maps: { baseColor: REF } },
  });
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
  readonly acquire = vi.fn(async () => this.texture);
  readonly release = vi.fn();

  constructor(private readonly texture: THREE.Texture) {}
}

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

describe('GLB export with a baseColor bitmap', () => {
  it('embeds the bitmap and points the material at it', async () => {
    restore = installCanvasStub();
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const provider = new FakeProvider(new THREE.CanvasTexture(canvas));

    const glb = await exportSceneToGlb(sceneOf(objectWithTexture()), {
      includeRoom: false,
      textureProvider: provider,
    });
    const json = parseGlbJson(glb);

    expect(provider.acquire).toHaveBeenCalledTimes(1);
    expect(provider.acquire).toHaveBeenCalledWith(REF, { repeat: 1 });
    expect(provider.release).toHaveBeenCalledTimes(1);
    expect(json.images).toHaveLength(1);
    expect(json.images?.[0].mimeType).toBe('image/png');
    expect(typeof json.images?.[0].bufferView).toBe('number');
    expect(json.images?.[0].uri).toBeUndefined();
    expect(json.textures).toHaveLength(1);
    const material = json.materials?.find((entry) => entry.name === 'table-material');
    expect(material?.pbrMetallicRoughness?.baseColorTexture?.index).toBeTypeOf('number');
  });

  it('does not let the 512px procedural retarget replace the bitmap', async () => {
    restore = installCanvasStub();
    const canvas = document.createElement('canvas');
    const provider = new FakeProvider(new THREE.CanvasTexture(canvas));
    const glb = await exportSceneToGlb(sceneOf(objectWithTexture()), {
      includeRoom: false,
      textureSize: 512,
      textureProvider: provider,
    });
    const json = parseGlbJson(glb);
    expect(provider.acquire).toHaveBeenCalledTimes(1);
    expect(json.images).toHaveLength(1);
  });

  it('fails clearly when the texture cannot be loaded', async () => {
    restore = installCanvasStub();
    const provider: TextureProvider = {
      acquire: vi.fn(async () => {
        throw new Error('missing texture');
      }),
      release: vi.fn(),
    };
    await expect(
      exportSceneToGlb(sceneOf(objectWithTexture()), {
        includeRoom: false,
        textureProvider: provider,
      }),
    ).rejects.toThrow(/teksturasi yuklanmadi/);
    expect(provider.release).not.toHaveBeenCalled();
  });

  it('leaves a textureless export unchanged and never calls the provider', async () => {
    const provider = new FakeProvider(new THREE.CanvasTexture(document.createElement('canvas')));
    const glb = await exportSceneToGlb(
      sceneOf(createFurnitureSceneObject('table', 'obj-1')),
      { includeRoom: false, textureProvider: provider },
    );
    expect(provider.acquire).not.toHaveBeenCalled();
    expect(parseGlbJson(glb).images).toBeUndefined();
  });

  it('does not mutate the scene data used for the export', async () => {
    restore = installCanvasStub();
    const provider = new FakeProvider(new THREE.CanvasTexture(document.createElement('canvas')));
    const scene = sceneOf(objectWithTexture());
    const before = JSON.stringify(scene);
    await exportSceneToGlb(scene, { includeRoom: false, textureProvider: provider });
    expect(JSON.stringify(scene)).toBe(before);
  });
});
