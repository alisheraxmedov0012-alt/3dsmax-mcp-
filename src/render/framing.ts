/**
 * W5 camera framing: computes a camera placement that frames a *selected
 * object's* bounding box (not only the room), adapting to the render aspect
 * ratio. Pure math + defensive validation, so it is testable without a WebGL
 * context and can never produce NaN camera coordinates.
 *
 * The existing room-based framing (`viewer/cameraFraming.ts`) is kept and used
 * as the fallback when nothing is selected or the selection has no valid bounds.
 */
import type { CameraPreset } from '../scene/sceneSettings';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface BoundsBox {
  min: Vec3Like;
  max: Vec3Like;
}

export interface Framing {
  position: Vec3Like;
  target: Vec3Like;
}

/** Vertical field of view used by the viewer camera (degrees). */
export const FRAMING_FOV_DEG = 45;

/** Padding factor so the object does not touch the frame edges. */
const FRAMING_MARGIN = 1.25;

/** Fallback box (cm) used when the selection has no usable bounds. */
const FALLBACK_HALF_EXTENT = 60;

/**
 * Direction from the target towards the camera per preset (unit-ish vectors).
 * `product` is a slightly elevated perspective view; `iso` is the classic
 * three-quarter view; `front`/`side`/`top` are the orthographic-style views.
 */
const PRESET_DIRECTIONS: Record<CameraPreset, Vec3Like> = {
  product: { x: 0.85, y: 0.32, z: 1.25 },
  iso: { x: 1, y: 0.85, z: 1 },
  front: { x: 0, y: 0.08, z: 1 },
  side: { x: 1, y: 0.08, z: 0 },
  top: { x: 0, y: 1, z: 0.02 },
};

function isFiniteVec3(v: Vec3Like | undefined): v is Vec3Like {
  return (
    v !== undefined &&
    Number.isFinite(v.x) &&
    Number.isFinite(v.y) &&
    Number.isFinite(v.z)
  );
}

/** True when the box has finite corners and a positive, finite extent. */
export function isValidBounds(bounds: BoundsBox | null | undefined): bounds is BoundsBox {
  if (!bounds || !isFiniteVec3(bounds.min) || !isFiniteVec3(bounds.max)) {
    return false;
  }
  const size = {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z,
  };
  const diagonal = Math.hypot(size.x, size.y, size.z);
  return Number.isFinite(diagonal) && diagonal > 1e-3;
}

/** Returns a safe, finite box: the input when valid, otherwise a fallback cube. */
export function safeBounds(bounds: BoundsBox | null | undefined): BoundsBox {
  if (isValidBounds(bounds)) {
    return bounds;
  }
  return {
    min: { x: -FALLBACK_HALF_EXTENT, y: 0, z: -FALLBACK_HALF_EXTENT },
    max: { x: FALLBACK_HALF_EXTENT, y: FALLBACK_HALF_EXTENT * 2, z: FALLBACK_HALF_EXTENT },
  };
}

/**
 * Compute the camera framing for a bounding box and preset at a given aspect
 * ratio. The distance fits both the vertical and the horizontal field of view,
 * so a portrait render never crops the object. Never returns NaN.
 */
export function computeObjectFraming(
  bounds: BoundsBox | null | undefined,
  preset: CameraPreset,
  aspect: number,
): Framing {
  const box = safeBounds(bounds);
  const target: Vec3Like = {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
  };
  const size = {
    x: box.max.x - box.min.x,
    y: box.max.y - box.min.y,
    z: box.max.z - box.min.z,
  };
  // Use the half-diagonal as a rotation-invariant bounding radius.
  const radius = Math.max(Math.hypot(size.x, size.y, size.z) / 2, 1);

  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const fovV = (FRAMING_FOV_DEG * Math.PI) / 180;
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * safeAspect);
  // Distance needed so the sphere of `radius` fits both axes.
  const distanceV = (radius / Math.sin(fovV / 2)) * FRAMING_MARGIN;
  const distanceH = (radius / Math.sin(fovH / 2)) * FRAMING_MARGIN;
  const distance = Math.max(distanceV, distanceH);

  const direction = PRESET_DIRECTIONS[preset] ?? PRESET_DIRECTIONS.iso;
  const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
  const unit = { x: direction.x / length, y: direction.y / length, z: direction.z / length };

  return {
    position: {
      x: target.x + unit.x * distance,
      y: target.y + unit.y * distance,
      z: target.z + unit.z * distance,
    },
    target,
  };
}
