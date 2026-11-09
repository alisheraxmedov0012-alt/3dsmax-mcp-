/**
 * Shared transform normalisation for stored scene transforms.
 *
 * Scene objects and opt-in rooms use the same position/rotation/scale limits.
 * Rotation is stored in degrees in the inclusive 0–360 range, so a gizmo's
 * negative angles are normalized instead of being clamped to zero.
 */
import { OBJECT_LIMITS, type Vec3 } from './types';

export function clampTransformValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

/** Normalize any finite angle into [0, 360). */
export function normalizeRotationDegrees(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const normalized = ((value % 360) + 360) % 360;
  // Avoid storing 360.00000000000006 for values just below a full turn.
  return normalized >= 360 ? 0 : normalized;
}

export function normalizeRoomRotation(rotation: Vec3): Vec3 {
  return {
    x: normalizeRotationDegrees(rotation.x),
    y: normalizeRotationDegrees(rotation.y),
    z: normalizeRotationDegrees(rotation.z),
  };
}

export function clampTransformScale(scale: Vec3): Vec3 {
  return {
    x: clampTransformValue(scale.x, OBJECT_LIMITS.scale.min, OBJECT_LIMITS.scale.max),
    y: clampTransformValue(scale.y, OBJECT_LIMITS.scale.min, OBJECT_LIMITS.scale.max),
    z: clampTransformValue(scale.z, OBJECT_LIMITS.scale.min, OBJECT_LIMITS.scale.max),
  };
}
