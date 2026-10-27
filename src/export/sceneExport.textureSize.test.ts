// @vitest-environment jsdom
/**
 * A4.3.2 — export-only texture resolution.
 *
 * The export path builds fresh objects, so retargeting maps there must never
 * touch the material a preview holds. These tests use jsdom with a canvas stub
 * that emits a structurally valid PNG at the canvas's current dimensions, which
 * lets the embedded image size be read back from the .glb.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { zlibSync } from 'fflate';
import { buildSceneObject } from '../scene/buildSceneObject';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  type SceneData,
  type SceneObject,
} from '../scene/types';
import { createFurnitureParams } from '../geometry/furniture/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { buildExportScene, exportSceneToGlb } from './sceneExport';
import { ExportError } from './exportTypes';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  const crcInput = new Uint8Array(4 + body.length);
  crcInput.set(out.subarray(4, 8), 0);
  crcInput.set(body, 4);
  view.setUint32(8 + body.length, crc32(crcInput));
  return out;
}

const PNG_CACHE = new Map<string, Uint8Array<ArrayBuffer>>();

function pngBytes(width: number, height: number): Uint8Array<ArrayBuffer> {
  const key = `${width}x${height}`;
  const cached = PNG_CACHE.get(key);
  if (cached) {
    return cached;
  }
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = new Uint8Array((width * 4 + 1) * height);
  const parts = [
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlibSync(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  PNG_CACHE.set(key, png);
  return png;
}

function pngDataUrl(width: number, height: number): string {
  const bytes = pngBytes(width, height);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

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
      toDataURL: () => pngDataUrl(canvas.width, canvas.height),
      toBlob: (callback: (blob: Blob | null) => void) => {
        callback(new Blob([pngBytes(canvas.width, canvas.height)], { type: 'image/png' }));
      },
    });
    return canvas;
  };
  document.createElement = patched as typeof document.createElement;
  return () => {
    document.createElement = original;
  };
}

interface GltfImage {
  mimeType?: string;
  bufferView?: number;
}

interface GltfJson {
  images?: GltfImage[];
  textures?: Array<{ source?: number }>;
  materials?: Array<{
    name?: string;
    alphaMode?: string;
    normalTexture?: { index: number };
    pbrMetallicRoughness?: {
      baseColorTexture?: { index: number; extensions?: unknown };
      metallicFactor?: number;
      roughnessFactor?: number;
    };
  }>;
  bufferViews?: Array<{ byteOffset?: number; byteLength: number }>;
}

function parseGlb(buffer: ArrayBuffer): { json: GltfJson; bin: Uint8Array } {
  const view = new DataView(buffer);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)),
  ) as GltfJson;
  const binStart = 20 + jsonLength + 8;
  return { json, bin: new Uint8Array(buffer, binStart) };
}

function imageSize(json: GltfJson, bin: Uint8Array, index: number): { width: number; height: number } {
  const image = json.images![index];
  const view = json.bufferViews![image.bufferView!];
  const start = view.byteOffset ?? 0;
  const bytes = bin.subarray(start, start + view.byteLength);
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: data.getUint32(16), height: data.getUint32(20) };
}

function goldenDresser(): SceneObject {
  return createFurnitureSceneObject('dresser', 'golden-dresser', {
    name: 'Golden Dresser',
    params: createFurnitureParams('dresser'),
    material: {
      materialId: 'wood-oak',
      metalness: 0.05,
      roughness: 0.6,
      opacity: 1,
      textureScale: 2,
      normalStrength: 1,
    },
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

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

describe('export-only texture resolution', () => {
  it('embeds 128x128 maps when no option is given', async () => {
    restore = installCanvasStub();
    const glb = await exportSceneToGlb(sceneOf(goldenDresser()), { includeRoom: false });
    const { json } = parseGlb(glb);

    expect(json.images).toHaveLength(2);
    expect(imageSize(json, parseGlb(glb).bin, 0)).toEqual({ width: 128, height: 128 });
    expect(imageSize(json, parseGlb(glb).bin, 1)).toEqual({ width: 128, height: 128 });
    expect(json.images!.every((image) => image.mimeType === 'image/png')).toBe(true);
    expect(json.materials?.[0]?.pbrMetallicRoughness?.metallicFactor).toBeCloseTo(0.05, 5);
    expect(json.materials?.[0]?.pbrMetallicRoughness?.roughnessFactor).toBeCloseTo(0.6, 5);
  });

  it('embeds 512x512 maps when textureSize is 512', async () => {
    restore = installCanvasStub();
    const glb = await exportSceneToGlb(sceneOf(goldenDresser()), {
      includeRoom: false,
      textureSize: 512,
    });
    const { json, bin } = parseGlb(glb);

    expect(json.images).toHaveLength(2);
    expect(imageSize(json, bin, 0)).toEqual({ width: 512, height: 512 });
    expect(imageSize(json, bin, 1)).toEqual({ width: 512, height: 512 });
    expect(json.materials?.[0]?.pbrMetallicRoughness?.baseColorTexture?.index).toBe(0);
    expect(json.materials?.[0]?.normalTexture?.index).toBe(1);
  });

  it('keeps the default output byte-identical to an explicit 128 request', async () => {
    restore = installCanvasStub();
    const scene = sceneOf(goldenDresser());
    const byDefault = await exportSceneToGlb(scene, { includeRoom: false });
    const explicit = await exportSceneToGlb(scene, { includeRoom: false, textureSize: 128 });

    expect(new Uint8Array(explicit)).toEqual(new Uint8Array(byDefault));
  });

  it('does not mutate the preview material or its textures', async () => {
    restore = installCanvasStub();
    const object = goldenDresser();
    const preview = buildSceneObject(object);
    let previewMaterial: import('three').MeshStandardMaterial | null = null;
    preview.group.traverse((node) => {
      const mesh = node as import('three').Mesh;
      if (mesh.isMesh && !previewMaterial) {
        previewMaterial = mesh.material as import('three').MeshStandardMaterial;
      }
    });
    const previewMap = previewMaterial!.map!;
    const previewNormal = previewMaterial!.normalMap!;

    const glb = await exportSceneToGlb(sceneOf(object), { includeRoom: false, textureSize: 512 });
    const { json, bin } = parseGlb(glb);

    expect(previewMaterial!.map).toBe(previewMap);
    expect(previewMaterial!.normalMap).toBe(previewNormal);
    expect((previewMap.image as { width: number }).width).toBe(128);
    expect((previewNormal.image as { width: number }).width).toBe(128);
    expect(imageSize(json, bin, 0)).toEqual({ width: 512, height: 512 });
    preview.dispose();
  });

  it('is deterministic at 512', async () => {
    restore = installCanvasStub();
    const scene = sceneOf(goldenDresser());
    const first = await exportSceneToGlb(scene, { includeRoom: false, textureSize: 512 });
    const second = await exportSceneToGlb(scene, { includeRoom: false, textureSize: 512 });

    expect(new Uint8Array(second)).toEqual(new Uint8Array(first));
  });

  it('keeps a textureless preset textureless and transparent at 512', async () => {
    restore = installCanvasStub();
    const glass: SceneObject = {
      ...createFurnitureSceneObject('table', 'glass-table'),
      params: createFurnitureParams('table'),
      material: { materialId: 'glass-clear', metalness: 0, roughness: 0.05, opacity: 0.3 },
    };
    const glb = await exportSceneToGlb(sceneOf(glass), { includeRoom: false, textureSize: 512 });
    const { json } = parseGlb(glb);

    expect(json.images).toBeUndefined();
    expect(json.textures).toBeUndefined();
    expect(json.materials?.[0]?.alphaMode).toBe('BLEND');
    expect(glb.byteLength).toBeGreaterThan(0);
  });

  it('rejects an unsupported texture size', () => {
    restore = installCanvasStub();
    expect(() => buildExportScene(sceneOf(goldenDresser()), { textureSize: 256 as never })).toThrow(
      ExportError,
    );
  });

  it('does not add maps to room materials when the room is exported', async () => {
    restore = installCanvasStub();
    const glb = await exportSceneToGlb(sceneOf(goldenDresser()), {
      includeRoom: true,
      textureSize: 512,
    });
    const { json, bin } = parseGlb(glb);

    // Room materials are plain PBR; only the dresser contributes two maps.
    expect(json.images).toHaveLength(2);
    expect(imageSize(json, bin, 0)).toEqual({ width: 512, height: 512 });
    const mapped = (json.materials ?? []).filter(
      (material) => material.pbrMetallicRoughness?.baseColorTexture !== undefined,
    );
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.name).toBe('dresser-material');
  });

  it('leaves an invisible object untouched, as the exporter skips it', async () => {
    restore = installCanvasStub();
    const object = goldenDresser();
    object.visible = false;
    const glb = await exportSceneToGlb(sceneOf(object), {
      includeRoom: false,
      textureSize: 512,
    });
    const { json } = parseGlb(glb);

    expect(json.images).toBeUndefined();
    expect(json.textures).toBeUndefined();
  });
});
