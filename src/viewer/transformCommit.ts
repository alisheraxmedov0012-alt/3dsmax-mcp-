/**
 * Phase 9A.2.9 — convert a live gizmo transform into a scene-data patch.
 *
 * The gizmo mutates the Three.js group directly during a drag, so visual
 * feedback is immediate and no geometry is rebuilt. On pointer release the
 * group is converted to canonical scene units and dispatched once.
 */
import type * as THREE from 'three';
import { OBJECT_LIMITS, type Vec3 } from '../scene/types';
import {
  clampTransformScale,
  normalizeRotationDegrees,
} from '../scene/transformLimits';

export interface TransformPatch {
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly scale: Vec3;
}

function rounded(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Read a group's transform in scene units: cm, degrees (0–360), unitless scale. */
export function transformPatchFromObject(object: THREE.Object3D): TransformPatch {
  const scale = clampTransformScale({
    x: object.scale.x,
    y: object.scale.y,
    z: object.scale.z,
  });
  return {
    position: {
      x: rounded(object.position.x),
      y: rounded(object.position.y),
      z: rounded(object.position.z),
    },
    rotation: {
      x: rounded(normalizeRotationDegrees((object.rotation.x * 180) / Math.PI)),
      y: rounded(normalizeRotationDegrees((object.rotation.y * 180) / Math.PI)),
      z: rounded(normalizeRotationDegrees((object.rotation.z * 180) / Math.PI)),
    },
    scale: {
      x: rounded(scale.x),
      y: rounded(scale.y),
      z: rounded(scale.z),
    },
  };
}

/**
 * Keep a live gizmo scale inside the stored limits. TransformControls can be
 * dragged through zero; blocking that during the drag avoids a degenerate
 * matrix and a snapped visual when the drag ends.
 */
export function constrainGizmoScale(object: THREE.Object3D): boolean {
  const scale = clampTransformScale({
    x: object.scale.x,
    y: object.scale.y,
    z: object.scale.z,
  });
  const changed =
    scale.x !== object.scale.x || scale.y !== object.scale.y || scale.z !== object.scale.z;
  if (changed) {
    object.scale.set(scale.x, scale.y, scale.z);
    object.updateMatrixWorld(true);
  }
  return changed;
}

export const TRANSFORM_LIMITS = OBJECT_LIMITS;
