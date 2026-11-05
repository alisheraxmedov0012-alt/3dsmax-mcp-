/**
 * Phase 5.3 — fit a directional light's orthographic shadow camera to the
 * bounds that actually need shadows. Pure math so small/large/off-centre
 * bounds can be validated without a WebGL context.
 */
import {
  boundsRadius,
  safeBounds,
  type BoundsBox,
  type Vec3Like,
} from '../render/framing';

export interface ShadowFit {
  target: Vec3Like;
  position: Vec3Like;
  /** Half-width/height of the orthographic shadow camera. */
  extent: number;
  near: number;
  far: number;
}

export interface ShadowFitOptions {
  /**
   * The preset light position's distance from the target. Keeping it for a
   * room-sized scene preserves the existing light direction/appearance; tiny
   * selections still get a tight orthographic frustum.
   */
  preferredDistance?: number;
}

const FALLBACK_DIRECTION: Vec3Like = { x: 0.4, y: 0.75, z: 0.5 };
const MIN_EXTENT = 10;
const MIN_LIGHT_DISTANCE = 500;

function normalizeDirection(direction: Vec3Like): Vec3Like {
  const values = [direction.x, direction.y, direction.z];
  if (!values.every((value) => Number.isFinite(value))) {
    return normalizeDirection(FALLBACK_DIRECTION);
  }
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length <= 1e-9) {
    return normalizeDirection(FALLBACK_DIRECTION);
  }
  return { x: direction.x / length, y: direction.y / length, z: direction.z / length };
}

/**
 * Compute a shadow camera around the bounds centre. The orthographic extent
 * contains the bounding sphere with a small margin, while near/far are placed
 * outside the light-to-object distance so the depth range is not excessive.
 */
export function computeShadowFit(
  bounds: BoundsBox | null | undefined,
  lightDirection: Vec3Like,
  options: ShadowFitOptions = {},
): ShadowFit {
  const box = safeBounds(bounds);
  const target = {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
  };
  const radius = boundsRadius(box);
  const extent = Math.max(radius * 1.25, MIN_EXTENT);

  const preferred =
    Number.isFinite(options.preferredDistance) && (options.preferredDistance ?? 0) > 0
      ? (options.preferredDistance as number)
      : 0;
  const distance = Math.max(preferred, radius * 2.5, MIN_LIGHT_DISTANCE);
  const near = Math.max(0.1, distance - radius * 2);
  const far = distance + radius * 2 + 100;
  const unit = normalizeDirection(lightDirection);

  return {
    target,
    position: {
      x: target.x + unit.x * distance,
      y: target.y + unit.y * distance,
      z: target.z + unit.z * distance,
    },
    extent,
    near,
    far,
  };
}
