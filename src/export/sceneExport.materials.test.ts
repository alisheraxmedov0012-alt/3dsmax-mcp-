// @vitest-environment jsdom
/**
 * A2.1 — the texture must survive the GLB export, not just the viewport.
 *
 * The exporter embeds a `CanvasTexture` by reading the canvas back through
 * `toBlob`. jsdom has no canvas backend, so this suite supplies the drawing calls
 * and a PNG data URL exactly as a browser would; the export pipeline itself is the
 * real one (`exportSceneToGlb` → `buildExportScene` → `buildFurniture`).
 *
 * Before this stage no test asserted that a texture reached the file, so the
 * "textures are preserved on export" claim in `buildMaterial.ts` was unverified.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { exportSceneToGlb } from '../export/sceneExport';
import {
  FURNITURE_TYPES,
  createFurnitureParams,
  type FurnitureType,
} from '../geometry/furniture/types';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  type SceneData,
  type SceneObject,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { getMaterialPreset } from '../materials/presets';

const ONE_PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

function installCanvasStub(): () => void {
  const original = document.createElement.bind(document);
  const patched = (tag: string, opts?: unknown): HTMLElement => {
    const element = original(tag, opts as never) as HTMLElement;
    if (tag !== 'canvas') {
      return element;
    }
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
              if (property === 'canvas') {
                return canvas;
              }
              return () => undefined;
            },
          },
        ),
      toDataURL: () => ONE_PIXEL_PNG,
      toBlob: (callback: (blob: Blob | null) => void) => {
        const binary = atob(ONE_PIXEL_PNG.split(',')[1]);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        callback(new Blob([bytes], { type: 'image/png' }));
      },
    });
    return canvas;
  };
  document.createElement = patched as typeof document.createElement;
  return () => {
    document.createElement = original;
  };
}

interface GltfJson {
  images?: Array<{ mimeType?: string; bufferView?: number }>;
  textures?: Array<{ source?: number }>;
  materials?: Array<{
    name?: string;
    alphaMode?: string;
    pbrMetallicRoughness?: {
      baseColorTexture?: { index: number };
      metallicFactor?: number;
      roughnessFactor?: number;
    };
    normalTexture?: { index: number };
  }>;
  bufferViews?: unknown[];
}

/** Read the JSON chunk of a binary glTF container. */
function parseGlbJson(buffer: ArrayBuffer): GltfJson {
  const view = new DataView(buffer);
  const jsonLength = view.getUint32(12, true);
  const json = new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength));
  return JSON.parse(json) as GltfJson;
}

/**
 * A scene object using a preset.
 *
 * `ObjectMaterial` requires explicit metalness/roughness, and an explicit channel
 * overrides the preset, so the values are taken *from* the preset. Passing fixed
 * numbers here would silently test those numbers instead of the preset.
 */
function objectFor(type: FurnitureType, materialId: string): SceneObject {
  const preset = getMaterialPreset(materialId);
  return {
    ...createFurnitureSceneObject(type, `${type}-1`),
    params: createFurnitureParams(type),
    material: {
      metalness: preset.metalness,
      roughness: preset.roughness,
      materialId,
    },
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

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

describe('A2.1 — GLB export embeds the texture for every furniture type', () => {
  it('writes both the detail map and the normal map into the file', async () => {
    restore = installCanvasStub();
    const exports = await Promise.all(
      FURNITURE_TYPES.map((type) =>
        exportSceneToGlb(sceneOf(objectFor(type, 'wood-oak')), { includeRoom: false }),
      ),
    );
    for (const [index, type] of FURNITURE_TYPES.entries()) {
      const json = parseGlbJson(exports[index]);

      // Two bitmaps: the grayscale detail map and the tangent-space normal map.
      expect(json.images, `${type} images`).toBeDefined();
      expect(json.images!.length, `${type} images`).toBe(2);
      expect(json.textures, `${type} textures`).toBeDefined();
      expect(json.textures!.length, `${type} textures`).toBe(2);

      // Embedded, not referenced: every image points at a bufferView inside the
      // .glb and carries a MIME type.
      for (const image of json.images!) {
        expect(image.mimeType, `${type} mime`).toBe('image/png');
        expect(typeof image.bufferView, `${type} bufferView`).toBe('number');
      }
      expect(json.bufferViews!.length, `${type} bufferViews`).toBeGreaterThan(0);
    }
  });

  it('points the material at those textures', async () => {
    restore = installCanvasStub();
    const glb = await exportSceneToGlb(sceneOf(objectFor('wardrobe', 'wood-oak')), {
      includeRoom: false,
    });
    const json = parseGlbJson(glb);
    const material = (json.materials ?? []).find((entry) => entry.name === 'wardrobe-material');
    expect(material, 'wardrobe material present').toBeDefined();
    expect(material!.pbrMetallicRoughness?.baseColorTexture?.index).toBeTypeOf('number');
    expect(material!.normalTexture?.index).toBeTypeOf('number');
    // wood-oak preset: metalness 0, roughness 0.65.
    expect(material!.pbrMetallicRoughness?.metallicFactor).toBeCloseTo(0, 5);
    expect(material!.pbrMetallicRoughness?.roughnessFactor).toBeCloseTo(0.65, 5);
  });

  it('keeps the textured material per furniture type', async () => {
    restore = installCanvasStub();
    const exports = await Promise.all(
      FURNITURE_TYPES.map((type) =>
        exportSceneToGlb(sceneOf(objectFor(type, 'metal-steel')), { includeRoom: false }),
      ),
    );
    for (const [index, type] of FURNITURE_TYPES.entries()) {
      const json = parseGlbJson(exports[index]);
      const named = (json.materials ?? []).find((entry) => entry.name === `${type}-material`);
      expect(named, `${type} material`).toBeDefined();
      expect(named!.pbrMetallicRoughness?.metallicFactor, type).toBeCloseTo(0.95, 4);
      expect(named!.pbrMetallicRoughness?.baseColorTexture?.index, type).toBeTypeOf('number');
    }
  });

  it('exports glass with alpha blending and no invented texture', async () => {
    restore = installCanvasStub();
    const glb = await exportSceneToGlb(sceneOf(objectFor('table', 'glass-clear')), {
      includeRoom: false,
    });
    const json = parseGlbJson(glb);
    const material = (json.materials ?? []).find((entry) => entry.name === 'table-material');
    expect(material?.alphaMode).toBe('BLEND');
    // Glass has no procedural pattern, so nothing is embedded for it.
    expect(json.images).toBeUndefined();
  });

  it('exports the default preset with no images, as before', async () => {
    const glb = await exportSceneToGlb(sceneOf(objectFor('shelf', 'default')), {
      includeRoom: false,
    });
    const json = parseGlbJson(glb);
    expect(json.images).toBeUndefined();
    expect(json.materials?.length ?? 0).toBeGreaterThan(0);
  });

  it('still emits a valid glTF container', async () => {
    restore = installCanvasStub();
    const glb = await exportSceneToGlb(sceneOf(objectFor('bed', 'wood-oak')), {
      includeRoom: false,
    });
    // glTF binary magic.
    expect(new DataView(glb).getUint32(0, true)).toBe(0x46546c67);
    expect(glb.byteLength).toBeGreaterThan(1000);
  });

  it('lets an explicit channel override the preset, as the resolver documents', async () => {
    restore = installCanvasStub();
    const preset = getMaterialPreset('metal-steel');
    const object: SceneObject = {
      ...createFurnitureSceneObject('table', 't1'),
      params: createFurnitureParams('table'),
      // Preset says 0.95 metal, but the object stores 0.2 explicitly.
      material: { metalness: 0.2, roughness: preset.roughness, materialId: 'metal-steel' },
    };
    const glb = await exportSceneToGlb(sceneOf(object), { includeRoom: false });
    const json = parseGlbJson(glb);
    const material = (json.materials ?? []).find((entry) => entry.name === 'table-material');
    expect(material!.pbrMetallicRoughness?.metallicFactor).toBeCloseTo(0.2, 4);
    // The texture still comes from the preset.
    expect(material!.pbrMetallicRoughness?.baseColorTexture?.index).toBeTypeOf('number');
  });

  it('does not mutate the scene it exports', async () => {
    restore = installCanvasStub();
    const scene = sceneOf(objectFor('dresser', 'fabric-linen'));
    const before = JSON.stringify(scene);
    await exportSceneToGlb(scene, { includeRoom: false });
    expect(JSON.stringify(scene)).toBe(before);
  });
});
