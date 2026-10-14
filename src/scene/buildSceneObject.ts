import * as THREE from 'three';
import { buildTable } from '../geometry/buildTable';
import type { SceneObject } from './types';

const DEG_TO_RAD = Math.PI / 180;

export interface BuiltSceneObject {
  group: THREE.Group;
  dispose: () => void;
}

/**
 * Applies an object's transform (position, rotation, scale) to a Three.js
 * group. Rotation is stored in degrees in the scene model and converted to
 * radians here. Kept separate so transforms can be updated without rebuilding
 * geometry.
 */
export function applyObjectTransform(group: THREE.Object3D, object: SceneObject): void {
  group.position.set(object.position.x, object.position.y, object.position.z);
  group.rotation.set(
    object.rotation.x * DEG_TO_RAD,
    object.rotation.y * DEG_TO_RAD,
    object.rotation.z * DEG_TO_RAD,
  );
  group.scale.set(object.scale.x, object.scale.y, object.scale.z);
  group.visible = object.visible;
}

/**
 * Builds the Three.js representation of a scene object from its parameters.
 * Only the table type exists in Stage 5; unknown types throw so a bad scene is
 * surfaced rather than silently rendered as nothing.
 */
export function buildSceneObject(object: SceneObject): BuiltSceneObject {
  if (object.type !== 'table') {
    throw new Error(`Qo'llab-quvvatlanmaydigan obyekt turi: ${object.type}`);
  }

  const built = buildTable(object.params, object.material);
  built.group.name = `object:${object.id}`;
  built.group.userData.sceneObjectId = object.id;

  applyObjectTransform(built.group, object);

  return built;
}
