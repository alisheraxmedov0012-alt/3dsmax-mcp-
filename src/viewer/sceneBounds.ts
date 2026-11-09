/**
 * Phase 9A.2.7 — world-space bounds for viewer framing.
 *
 * The viewer must frame the legacy room, any number of opt-in rooms and the
 * furniture together. These helpers stay pure (a Three.js object in, plain
 * numbers out) so the framing rules are testable without a WebGL context.
 */
import * as THREE from 'three';
import type { BoundsBox } from '../render/framing';

/** Bounds of one object, or null when it is empty or excluded by visibility. */
export function objectBounds(
  object: THREE.Object3D,
  includeInvisible = false,
): BoundsBox | null {
  if (!includeInvisible && !object.visible) {
    return null;
  }
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) {
    return null;
  }
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
  };
}

/** Smallest box covering every valid input; null when nothing contributes. */
export function mergeBounds(
  bounds: readonly (BoundsBox | null | undefined)[],
): BoundsBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let found = false;

  for (const entry of bounds) {
    if (!entry) {
      continue;
    }
    if (
      !Number.isFinite(entry.min.x) ||
      !Number.isFinite(entry.min.y) ||
      !Number.isFinite(entry.min.z) ||
      !Number.isFinite(entry.max.x) ||
      !Number.isFinite(entry.max.y) ||
      !Number.isFinite(entry.max.z) ||
      entry.max.x < entry.min.x ||
      entry.max.y < entry.min.y ||
      entry.max.z < entry.min.z
    ) {
      continue;
    }
    minX = Math.min(minX, entry.min.x);
    minY = Math.min(minY, entry.min.y);
    minZ = Math.min(minZ, entry.min.z);
    maxX = Math.max(maxX, entry.max.x);
    maxY = Math.max(maxY, entry.max.y);
    maxZ = Math.max(maxZ, entry.max.z);
    found = true;
  }

  return found
    ? {
        min: { x: minX, y: minY, z: minZ },
        max: { x: maxX, y: maxY, z: maxZ },
      }
    : null;
}
