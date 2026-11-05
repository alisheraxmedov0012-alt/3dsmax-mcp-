import { describe, expect, it } from 'vitest';
import {
  buildSceneObject,
  sceneObjectBuildKey,
  sceneObjectGeometryKey,
} from './buildSceneObject';
import {
  createFurnitureSceneObject,
  createUniversalSceneObject,
  type SceneObject,
} from './types';
import { updateFurnitureSpec } from './configurator';
import { updateObjectMaterials } from '../materials/updateMaterial';

describe('Phase 4.6 geometry identity', () => {
  it('ignores material and colour changes', () => {
    const legacy = createFurnitureSceneObject('table', 'g1');
    const repainted: SceneObject = {
      ...legacy,
      params: { ...legacy.params, color: '#123456' },
    };
    const rematerialised: SceneObject = {
      ...legacy,
      material: { ...legacy.material, metalness: 1, roughness: 0, baseColor: '#ffffff' },
    };

    expect(sceneObjectGeometryKey(repainted)).toBe(sceneObjectGeometryKey(legacy));
    expect(sceneObjectGeometryKey(rematerialised)).toBe(sceneObjectGeometryKey(legacy));
    // The full key still changes, which existing callers rely on.
    expect(sceneObjectBuildKey(rematerialised)).not.toBe(sceneObjectBuildKey(legacy));
  });

  it('changes when a furniture dimension changes', () => {
    const legacy = createFurnitureSceneObject('table', 'g2');
    const wider: SceneObject = {
      ...legacy,
      params: { ...legacy.params, widthCm: legacy.params.widthCm + 20 },
    };
    expect(sceneObjectGeometryKey(wider)).not.toBe(sceneObjectGeometryKey(legacy));
  });

  it('changes when a universal spec changes', () => {
    const object = createUniversalSceneObject('desk.computer', 'g3');
    if (!object.spec) throw new Error('missing spec');
    const updated = updateFurnitureSpec('desk.computer', object.spec, { width: 180 });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    const after: SceneObject = { ...object, spec: updated.spec };
    expect(sceneObjectGeometryKey(after)).not.toBe(sceneObjectGeometryKey(object));
  });

  it('keeps the same geometry objects through a material-only refresh', () => {
    const object = createUniversalSceneObject('desk.computer', 'g4');
    const built = buildSceneObject(object);
    const geometries: string[] = [];
    built.group.traverse((node) => {
      const mesh = node as { isMesh?: boolean; geometry?: { uuid: string } };
      if (mesh.isMesh && mesh.geometry) {
        geometries.push(mesh.geometry.uuid);
      }
    });
    expect(geometries.length).toBeGreaterThan(0);
    const before = JSON.stringify(geometries);

    // A material-only change must not require a rebuild according to the key.
    const rematerialised: SceneObject = {
      ...object,
      material: { ...object.material, metalness: 0.9, roughness: 0.2 },
    };
    expect(sceneObjectGeometryKey(rematerialised)).toBe(sceneObjectGeometryKey(object));

    updateObjectMaterials(built.group, rematerialised);
    const after: string[] = [];
    built.group.traverse((node) => {
      const mesh = node as { isMesh?: boolean; geometry?: { uuid: string } };
      if (mesh.isMesh && mesh.geometry) {
        after.push(mesh.geometry.uuid);
      }
    });
    expect(JSON.stringify(after)).toBe(before);
    built.dispose();
  });
});
