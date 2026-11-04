import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildExportScene } from '../export/sceneExport';
import { createFurniturePlan, furnitureDefinitions } from '../geometry/universal';
import { FurniturePlanError } from '../geometry/universal/types';
import { buildSceneObject, sceneObjectBuildKey } from './buildSceneObject';
import { updateFurnitureSpec } from './configurator';
import { createDefaultSettings } from './sceneSettings';
import {
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  createUniversalSceneObject,
  type SceneData,
  type SceneObject,
} from './types';

const DEFINITION_IDS = [
  'desk.computer',
  'desk.gaming',
  'table.dining',
  'desk.writing',
  'chair.office',
  'chair.dining',
  'chair.armchair',
  'chair.ergonomic',
  'sofa.standard',
  'cabinet.standard',
  'bed.standard',
  'kitchen.baseCabinet',
  'stand.tv',
] as const;

function countMeshes(root: THREE.Object3D): number {
  let meshes = 0;
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) {
      meshes += 1;
    }
  });
  return meshes;
}

function boundingBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root);
}

/** Minimal 2D canvas so procedural material textures can be generated in Node. */
function stubCanvas(): void {
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(DEFINITION_IDS)('%s scene object', (definitionId) => {
  it('creates a canonical object and builds the plan geometry', () => {
    const definition = furnitureDefinitions.require(definitionId);
    const parsed = definition.parseSpec(definition.defaults);
    expect(parsed.ok).toBe(true);

    const object = createUniversalSceneObject(definitionId, 'u1');
    expect(object.type).toBe(definition.family);
    expect(object.name).toBe(definition.label);
    expect(object.definitionId).toBe(definitionId);
    expect(object.spec).toEqual(parsed.ok ? parsed.spec : {});

    const plan = createFurniturePlan(definitionId, definition.defaults);
    const built = buildSceneObject(object);
    try {
      expect(built.plan?.definitionId).toBe(definitionId);
      expect(built.group.name).toBe('object:u1');
      expect(built.group.userData.sceneObjectId).toBe('u1');
      expect(built.group.userData.definitionId).toBe(definitionId);
      expect(countMeshes(built.group)).toBe(plan.parts.length);

      const box = boundingBox(built.group);
      expect(box.isEmpty()).toBe(false);
      for (const value of [
        box.min.x,
        box.min.y,
        box.min.z,
        box.max.x,
        box.max.y,
        box.max.z,
      ]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(box.min.y).toBeCloseTo(0, 6);
    } finally {
      built.dispose();
    }
  });
});

describe('universal scene object resources and transform', () => {
  it('disposes every geometry and material of the built group', () => {
    const built = buildSceneObject(createUniversalSceneObject('desk.computer', 'u'));
    const meshes: THREE.Mesh[] = [];
    built.group.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        meshes.push(node as THREE.Mesh);
      }
    });
    const geometries = meshes.map((mesh) => mesh.geometry);
    const materials = [...new Set(meshes.map((mesh) => mesh.material as THREE.Material))];
    const geometrySpies = geometries.map((geometry) => vi.spyOn(geometry, 'dispose'));
    const materialSpies = materials.map((material) => vi.spyOn(material, 'dispose'));

    built.dispose();

    expect(built.group.children).toHaveLength(0);
    expect(geometrySpies.every((spy) => spy.mock.calls.length === 1)).toBe(true);
    expect(materialSpies.every((spy) => spy.mock.calls.length === 1)).toBe(true);
  });

  it('applies position, rotation and scale to the universal group', () => {
    const base = buildSceneObject(createUniversalSceneObject('table.dining', 'a'));
    const placed = buildSceneObject(
      createUniversalSceneObject('table.dining', 'b', undefined, {
        position: { x: 100, y: 0, z: -50 },
        rotation: { x: 0, y: 90, z: 0 },
      }),
    );
    const scaled = buildSceneObject(
      createUniversalSceneObject('table.dining', 'c', undefined, {
        scale: { x: 2, y: 2, z: 2 },
      }),
    );
    try {
      expect(placed.group.position.x).toBe(100);
      expect(placed.group.position.z).toBe(-50);
      expect(placed.group.rotation.y).toBeCloseTo(Math.PI / 2, 6);
      expect(scaled.group.scale.x).toBe(2);

      const baseSize = boundingBox(base.group).getSize(new THREE.Vector3());
      const scaledSize = boundingBox(scaled.group).getSize(new THREE.Vector3());
      expect(scaledSize.x).toBeCloseTo(baseSize.x * 2, 4);
      expect(scaledSize.z).toBeCloseTo(baseSize.z * 2, 4);

      // A quarter turn swaps the footprint axes.
      const placedSize = boundingBox(placed.group).getSize(new THREE.Vector3());
      expect(placedSize.x).toBeCloseTo(baseSize.z, 4);
      expect(placedSize.z).toBeCloseTo(baseSize.x, 4);
    } finally {
      base.dispose();
      placed.dispose();
      scaled.dispose();
    }
  });
});

describe('universal scene object material', () => {
  it('applies object channels to every slot and keeps slot colour and preset', () => {
    stubCanvas();
    const definition = furnitureDefinitions.require('desk.computer');
    const object = createUniversalSceneObject('desk.computer', 'm', undefined, {
      material: { metalness: 0.4, roughness: 0.25 },
    });
    const built = buildSceneObject(object);
    try {
      const materials = new Map<string, THREE.MeshStandardMaterial>();
      built.group.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) {
          const material = (node as THREE.Mesh).material as THREE.MeshStandardMaterial;
          materials.set(material.name, material);
        }
      });

      for (const slot of definition.slots) {
        const material = materials.get(`${slot.groupName}-material`);
        expect(material).toBeDefined();
        expect(material?.metalness).toBeCloseTo(0.4, 6);
        expect(material?.roughness).toBeCloseTo(0.25, 6);
        expect(`#${material?.color.getHexString()}`).toBe(slot.color);
      }

      // The tabletop slot is wood-oak: its procedural map must survive, which it
      // would not if an explicit `materialId: undefined` overwrote the preset.
      expect(materials.get('desk-tabletop-group-material')?.map).not.toBeNull();
    } finally {
      built.dispose();
    }
  });
});

describe('universal scene object guards', () => {
  it('rejects an object with only one of definitionId/spec', () => {
    const object = createUniversalSceneObject('desk.computer', 'p');

    const withoutSpec: SceneObject = { ...object };
    delete withoutSpec.spec;
    expect(() => buildSceneObject(withoutSpec)).toThrow(FurniturePlanError);

    const withoutDefinition: SceneObject = { ...object };
    delete withoutDefinition.definitionId;
    expect(() => buildSceneObject(withoutDefinition)).toThrow(FurniturePlanError);
  });

  it('rejects a spec the definition cannot build', () => {
    const object = createUniversalSceneObject('desk.computer', 'q');
    expect(() => buildSceneObject({ ...object, spec: { nope: 1 } })).toThrow(FurniturePlanError);
  });
});

describe('universal objects in a scene', () => {
  it('builds all thirteen definitions through the export scene path', () => {
    const scene: SceneData = {
      schemaVersion: SCENE_SCHEMA_VERSION,
      room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
      objects: DEFINITION_IDS.map((definitionId, index) =>
        createUniversalSceneObject(definitionId, `u${index}`),
      ),
      settings: createDefaultSettings(),
    };

    const built = buildExportScene(scene, { includeRoom: false });
    try {
      const objectGroups = built.scene.children.filter((child) => child.name.startsWith('object:'));
      expect(objectGroups).toHaveLength(DEFINITION_IDS.length);
      expect(objectGroups.every((child) => countMeshes(child) > 0)).toBe(true);
    } finally {
      built.dispose();
    }
  });

  it('keeps legacy objects on the parametric path', () => {
    const legacy = createFurnitureSceneObject('chair', 'legacy');
    const built = buildSceneObject(legacy);
    try {
      expect(built.plan).toBeUndefined();
      expect(built.group.name).toBe('object:legacy');
      expect(built.group.userData.definitionId).toBeUndefined();
      expect(countMeshes(built.group)).toBeGreaterThan(0);
    } finally {
      built.dispose();
    }
  });
});

describe('sceneObjectBuildKey', () => {
  it('changes when the spec changes', () => {
    const object = createUniversalSceneObject('desk.computer', 'k');
    const withoutDrawer = createUniversalSceneObject('desk.computer', 'k', {
      drawerEnabled: false,
    });
    expect(sceneObjectBuildKey(withoutDrawer)).not.toBe(sceneObjectBuildKey(object));
  });

  it('changes when the material changes and is stable for legacy objects', () => {
    const object = createUniversalSceneObject('desk.computer', 'k');
    const repainted: SceneObject = {
      ...object,
      material: { ...object.material, roughness: 0.2 },
    };
    expect(sceneObjectBuildKey(repainted)).not.toBe(sceneObjectBuildKey(object));

    const legacy = createFurnitureSceneObject('table', 'k');
    expect(sceneObjectBuildKey({ ...legacy })).toBe(sceneObjectBuildKey(legacy));
  });
});

describe('spec-driven rebuild', () => {
  it('rebuilds when the spec changes and releases the previous geometry', () => {
    const before = createUniversalSceneObject('desk.computer', 'r1');
    if (!before.spec) throw new Error('missing spec');
    const builtBefore = buildSceneObject(before);
    const meshes: THREE.Mesh[] = [];
    builtBefore.group.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        meshes.push(node as THREE.Mesh);
      }
    });
    const geometrySpies = meshes.map((mesh) => vi.spyOn(mesh.geometry, 'dispose'));
    const beforeWidth = boundingBox(builtBefore.group).getSize(new THREE.Vector3()).x;

    const updated = updateFurnitureSpec('desk.computer', before.spec, { width: 170 });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    const after: SceneObject = { ...before, spec: updated.spec };

    // This is exactly what SceneViewer compares before rebuilding.
    expect(sceneObjectBuildKey(after)).not.toBe(sceneObjectBuildKey(before));

    builtBefore.dispose();
    const builtAfter = buildSceneObject(after);
    try {
      expect(geometrySpies.every((spy) => spy.mock.calls.length === 1)).toBe(true);
      const afterWidth = boundingBox(builtAfter.group).getSize(new THREE.Vector3()).x;
      expect(afterWidth).toBeGreaterThan(beforeWidth);
    } finally {
      builtAfter.dispose();
    }
  });
});
