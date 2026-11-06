/**
 * Phase 6.2.1 — the exporters must include imported geometry.
 *
 * The import pipeline is exercised end to end at the store boundary: a parsed
 * model is registered, a scene object references it, and every shipped exporter is
 * asked for a file. The counts below come from the exported bytes, not from the
 * scene we think we exported.
 */
import * as THREE from 'three';
import { unzipSync } from 'fflate';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { exportSceneToFormat } from './sceneFileExport';
import { buildExportScene } from './sceneExport';
import { summarizeGlb } from './glbSummary';
import {
  SCENE_SCHEMA_VERSION,
  createImportedSceneObject,
  type ImportedModelMeta,
  type SceneData,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { importedModelStore } from '../import/importedModelStore';
import { disposeImportedModel } from '../import/importedModelStore';

const META = { name: 'Stul', furnitureType: 'imported', units: 'cm' as const };

class TestFileReader {
  result: ArrayBuffer | null = null;
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
}

function meta(overrides: Partial<ImportedModelMeta> = {}): ImportedModelMeta {
  return {
    format: 'glb',
    fileName: 'stul.glb',
    sourceBytes: 512,
    meshes: 1,
    triangles: 12,
    materials: 1,
    textures: 0,
    sourceHash: 'd'.repeat(64),
    boundsCm: { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 2, z: 1 } },
    ...overrides,
  };
}

/** A 2 × 4 × 2 cm box: 24 vertices, 12 triangles. */
function registerBox(id: string): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(2, 4, 2);
  const root = new THREE.Group();
  root.name = 'ImportedRoot';
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#886644' }));
  mesh.name = 'Seat';
  root.add(mesh);
  importedModelStore.register(id, { root, dispose: () => disposeImportedModel(root) });
  return geometry;
}

function importedScene(id = 'imp-1'): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
    objects: [createImportedSceneObject(id, meta())],
    settings: createDefaultSettings(),
  };
}

beforeAll(() => {
  vi.stubGlobal('FileReader', TestFileReader);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  importedModelStore.clear();
});

describe('buildExportScene — imported objects', () => {
  it('includes the imported mesh and its transform', () => {
    registerBox('imp-1');
    const scene = importedScene();
    scene.objects[0].position = { x: 100, y: 0, z: -50 };

    const exported = buildExportScene(scene, { includeRoom: false });
    try {
      const meshes: THREE.Mesh[] = [];
      exported.scene.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) {
          meshes.push(node as THREE.Mesh);
        }
      });
      expect(meshes).toHaveLength(1);
      const world = meshes[0].getWorldPosition(new THREE.Vector3());
      expect(world.x).toBeCloseTo(100);
      expect(world.z).toBeCloseTo(-50);
    } finally {
      exported.dispose();
    }

    // The export shares the registered geometry, so it must still be alive.
    expect(importedModelStore.has('imp-1')).toBe(true);
  });

  it('can be built twice from the same registered model', () => {
    registerBox('imp-1');
    for (let pass = 0; pass < 2; pass += 1) {
      const exported = buildExportScene(importedScene(), { includeRoom: false });
      let meshes = 0;
      exported.scene.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) {
          meshes += 1;
        }
      });
      expect(meshes).toBe(1);
      exported.dispose();
    }
  });
});

describe('exportSceneToFormat — imported geometry in every format', () => {
  it('writes the imported mesh into the GLB', async () => {
    registerBox('imp-1');
    const artifact = await exportSceneToFormat('glb', importedScene(), META, {
      includeRoom: false,
    });
    const summary = summarizeGlb(await artifact.blob.arrayBuffer());
    expect(summary.ok).toBe(true);
    if (!summary.ok) {
      return;
    }
    expect(summary.summary.meshes).toBe(1);
    expect(summary.summary.triangles).toBe(12);
  });

  it('writes the imported mesh into the OBJ', async () => {
    registerBox('imp-1');
    const artifact = await exportSceneToFormat('obj', importedScene(), META, {
      includeRoom: false,
    });
    const text = await artifact.blob.text();
    const vertices = text.split('\n').filter((line) => line.startsWith('v '));
    const faces = text.split('\n').filter((line) => line.startsWith('f '));
    expect(vertices).toHaveLength(24);
    expect(faces).toHaveLength(12);
  });

  it('writes the imported mesh into the STL', async () => {
    registerBox('imp-1');
    const artifact = await exportSceneToFormat('stl', importedScene(), META, {
      includeRoom: false,
    });
    const view = new DataView(await artifact.blob.arrayBuffer());
    expect(view.getUint32(80, true)).toBe(12);
  });

  it('writes the imported mesh into the 3MF', async () => {
    registerBox('imp-1');
    const artifact = await exportSceneToFormat('3mf', importedScene(), META, {
      includeRoom: false,
    });
    const entries = Object.keys(unzipSync(new Uint8Array(await artifact.blob.arrayBuffer())));
    expect(entries).toContain('3D/3dmodel.model');
  });

  it('exports an imported object alone when the print scope selects it', async () => {
    registerBox('imp-1');
    const artifact = await exportSceneToFormat('stl', importedScene(), META, {
      includeRoom: false,
      onlyObjectId: 'imp-1',
    });
    const view = new DataView(await artifact.blob.arrayBuffer());
    expect(view.getUint32(80, true)).toBe(12);
  });

  it('rejects an empty export when the imported model is not registered', async () => {
    // No registerBox: the object exists in the scene but has no geometry.
    await expect(
      exportSceneToFormat('obj', importedScene(), META, { includeRoom: false }),
    ).rejects.toThrow();
  });
});
