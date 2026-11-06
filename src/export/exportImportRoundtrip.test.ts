/**
 * Phase 6.3 — the export and import halves meet.
 *
 * Every other test checks one direction: the exporters are verified against the
 * bytes they write, and the importers against the files they read. This file
 * closes the loop for the formats we both write and read, because that is what a
 * buyer actually does — take the package, open it in another tool, and expect the
 * object names, hierarchy and size to still be there.
 */
import * as THREE from 'three';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportSceneToFormat } from './sceneFileExport';
import { buildExportScene, exportSceneToGlb } from './sceneExport';
import { installBrowserShims } from '../import/__fixtures__/nodeShims';
import { prepareImport } from '../import/parseModel';
import { importFailure } from '../import/importErrors';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  createTableSceneObject,
  type SceneData,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';

const META = { name: 'Yotoqxona', furnitureType: 'wardrobe', units: 'cm' as const };


/** Base64 of a buffer, without relying on Node's `Buffer` typings. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

class TestFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    blob
      .arrayBuffer()
      .then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      })
      .catch((error) => this.onerror?.(error));
  }

  readAsDataURL(blob: Blob): void {
    blob
      .arrayBuffer()
      .then((buffer) => {
        const base64 = toBase64(new Uint8Array(buffer));
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${base64}`;
        this.onloadend?.();
      })
      .catch((error) => this.onerror?.(error));
  }
}

beforeAll(() => {
  vi.stubGlobal('FileReader', TestFileReader);
  installBrowserShims();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
});

/** Two pieces, deliberately sharing the same display name. */
function makeScene(): SceneData {
  const table = createTableSceneObject('t1', { name: 'Stol' });
  const wardrobe = createFurnitureSceneObject('wardrobe', 'w1', { name: 'Stol' });
  wardrobe.position = { x: 120, y: 0, z: 0 };
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects: [table, wardrobe],
    settings: createDefaultSettings(),
  };
}

/**
 * Node names of the exported object groups, as they come back from the importer.
 *
 * `GLTFLoader` sanitises node names for property-binding paths, so the exporter's
 * `object:t1` arrives as `objectt1`. The id and the order survive; the separator
 * does not. The human-readable name travels in `extras` instead (see below).
 */
function objectNames(root: THREE.Object3D): string[] {
  const names: string[] = [];
  root.traverse((node) => {
    if (node.name.startsWith('object')) {
      names.push(node.name);
    }
  });
  return names;
}

function displayNames(root: THREE.Object3D): string[] {
  const names: string[] = [];
  root.traverse((node) => {
    const value = node.userData?.displayName;
    if (typeof value === 'string' && value !== '') {
      names.push(value);
    }
  });
  return names;
}

function meshNames(root: THREE.Object3D): string[] {
  const names: string[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) {
      names.push(mesh.name);
    }
  });
  return names;
}

/** Size of the exported scene in centimetres, i.e. before the metre conversion. */
function exportedSizeCm(scene: SceneData): THREE.Vector3 {
  const exported = buildExportScene(scene, { includeRoom: false });
  try {
    return new THREE.Box3().setFromObject(exported.scene).getSize(new THREE.Vector3());
  } finally {
    exported.dispose();
  }
}

describe('export → import round trip', () => {
  it('keeps the object identity and its order through a GLB', async () => {
    const glb = await exportSceneToGlb(makeScene(), { includeRoom: false });
    const { parsed } = await prepareImport([{ name: 'scene.glb', bytes: glb }]);
    try {
      // The ids survive (the ':' separator is sanitised by GLTFLoader) and so does
      // the order the objects had in the scene.
      expect(objectNames(parsed.root)).toEqual(['objectt1', 'objectw1']);
      // The human-readable name travels in node `extras`.
      expect(displayNames(parsed.root)).toEqual(['Stol', 'Stol']);
      // Part names are the ones the GLB naming pass produced, and stay unique.
      const names = meshNames(parsed.root);
      expect(names.length).toBeGreaterThan(0);
      expect(new Set(names).size).toBe(names.length);
    } finally {
      parsed.dispose();
    }
  });

  it('keeps the object identity and its order through a textual .gltf', async () => {
    const artifact = await exportSceneToFormat('gltf', makeScene(), META, {
      includeRoom: false,
    });
    const text = await artifact.blob.text();
    const bytes = new TextEncoder().encode(text).buffer as ArrayBuffer;

    const { parsed, report } = await prepareImport([{ name: 'scene.gltf', bytes }]);
    try {
      expect(report.references.missing).toEqual([]);
      expect(objectNames(parsed.root)).toEqual(['objectt1', 'objectw1']);
      expect(displayNames(parsed.root)).toEqual(['Stol', 'Stol']);
    } finally {
      parsed.dispose();
    }
  });

  it('restores the original size in centimetres after a metre-based round trip', async () => {
    const scene = makeScene();
    const expected = exportedSizeCm(scene);
    const glb = await exportSceneToGlb(scene, { includeRoom: false });

    const { parsed } = await prepareImport([{ name: 'scene.glb', bytes: glb }]);
    try {
      // Exported in metres, imported back into centimetres: the envelope must be
      // the one the editor shows, not 100× or 1/100× of it.
      const size = new THREE.Box3().setFromObject(parsed.root).getSize(new THREE.Vector3());
      expect(size.x).toBeCloseTo(expected.x, 1);
      expect(size.y).toBeCloseTo(expected.y, 1);
      expect(size.z).toBeCloseTo(expected.z, 1);
    } finally {
      parsed.dispose();
    }
  });

  it('keeps part names through an OBJ export', async () => {
    const artifact = await exportSceneToFormat('obj', makeScene(), META, {
      includeRoom: false,
    });
    const text = await artifact.blob.text();
    // OBJ has no node/group metadata: three's OBJExporter writes `o` per mesh, so
    // the part names are what carries over, not the object id.
    expect(text).toMatch(/^o table-top$/m);

    const bytes = new TextEncoder().encode(text).buffer as ArrayBuffer;
    const { parsed } = await prepareImport([{ name: 'scene.obj', bytes }]);
    try {
      expect(parsed.root.getObjectByName('table-top')).toBeTruthy();
      expect(parsed.meta.triangles).toBeGreaterThan(0);
    } finally {
      parsed.dispose();
    }
  });

  it('never emits duplicate mesh names, even when two objects share a display name', async () => {
    const glb = await exportSceneToGlb(makeScene(), { includeRoom: false });
    const { parsed } = await prepareImport([{ name: 'scene.glb', bytes: glb }]);
    try {
      const names = meshNames(parsed.root);
      expect(new Set(names).size).toBe(names.length);
      // Two objects named "Stol" stay distinguishable by id, not by display name.
      expect(objectNames(parsed.root)).toEqual(['objectt1', 'objectw1']);
      expect(displayNames(parsed.root)).toEqual(['Stol', 'Stol']);
    } finally {
      parsed.dispose();
    }
  });
});

describe('export → import rejection path', () => {
  it('refuses to import a truncated export instead of half-loading it', async () => {
    const glb = await exportSceneToGlb(makeScene(), { includeRoom: false });
    const truncated = glb.slice(0, Math.floor(glb.byteLength / 3));
    await expect(prepareImport([{ name: 'broken.glb', bytes: truncated }])).rejects.toMatchObject({
      code: expect.any(String),
    });
  });
});

describe('round trip fixture sanity', () => {
  it('has a real importer error type for the rejection assertions', () => {
    // Guards the test above: if the import layer stopped throwing typed errors,
    // the `code` matcher would silently pass on any error shape.
    expect(importFailure('malformed').code).toBe('malformed');
  });
});
