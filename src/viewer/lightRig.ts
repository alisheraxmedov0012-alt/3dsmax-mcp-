/**
 * Phase 5.4 — place the three-light studio rig around the active bounds.
 *
 * Preset positions remain the source of directions. The target and distances
 * are adapted to the selected product (or the room when nothing is selected), so
 * a small piece does not get a room-sized light rig and a large piece is not
 * left with lights inside its bounds.
 */
import { boundsRadius, safeBounds, type BoundsBox, type Vec3Like } from '../render/framing';
import type { LightingPresetPositions } from '../render/renderPresets';
import { computeShadowFit } from './shadowFit';

export interface LightRig {
  target: Vec3Like;
  key: Vec3Like;
  fill: Vec3Like;
  rim: Vec3Like;
}

const FALLBACK_DIRECTION: Vec3Like = { x: 0, y: 1, z: 0 };
const MIN_LIGHT_DISTANCE = 500;

function normalizeDirection(direction: Vec3Like): Vec3Like {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (!Number.isFinite(length) || length <= 1e-9) {
    return FALLBACK_DIRECTION;
  }
  return { x: direction.x / length, y: direction.y / length, z: direction.z / length };
}

function place(
  target: Vec3Like,
  direction: readonly [number, number, number],
  radius: number,
): Vec3Like {
  const unit = normalizeDirection({ x: direction[0], y: direction[1], z: direction[2] });
  const distance = Math.max(
    Math.hypot(direction[0], direction[1], direction[2]),
    radius * 2.5,
    MIN_LIGHT_DISTANCE,
  );
  return {
    x: target.x + unit.x * distance,
    y: target.y + unit.y * distance,
    z: target.z + unit.z * distance,
  };
}

export function computeLightRig(
  bounds: BoundsBox | null | undefined,
  positions: LightingPresetPositions,
): LightRig {
  const box = safeBounds(bounds);
  const radius = boundsRadius(box);
  // The key position and target use the same fitting rule as the shadow camera.
  const keyFit = computeShadowFit(
    bounds,
    { x: positions.key[0], y: positions.key[1], z: positions.key[2] },
    {
      preferredDistance: Math.hypot(positions.key[0], positions.key[1], positions.key[2]),
    },
  );

  return {
    target: keyFit.target,
    key: keyFit.position,
    fill: place(keyFit.target, positions.fill, radius),
    rim: place(keyFit.target, positions.rim, radius),
  };
}
