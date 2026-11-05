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

export interface FramingOptions {
  /** Padding factor; defaults to the historical 1.25. */
  margin?: number;
  /** Optional focus point, e.g. a selected part centre. */
  target?: Vec3Like;
}

export interface Framing {
  position: Vec3Like;
  target: Vec3Like;
  /** Safe near/far planes for a camera at this framing. */
  near: number;
  far: number;
  /** Distance from the camera to the framing target (cm). */
  distance: number;
  /** Half-diagonal of the framed bounds (cm). */
  radius: number;
}

/** Vertical field of view used by the viewer camera (degrees). */
export const FRAMING_FOV_DEG = 45;

/** Default planes used when framing a room rather than a selected object. */
export const DEFAULT_CAMERA_NEAR = 1;
export const DEFAULT_CAMERA_FAR = 20000;
const MIN_CAMERA_NEAR = 0.001;

/** Existing orbit limits; object framing may widen/lower them safely. */
export const DEFAULT_ORBIT_MIN_DISTANCE = 40;
export const DEFAULT_ORBIT_MAX_DISTANCE = 6000;
export const MIN_ORBIT_DISTANCE = 1;

/** Padding factor so the object does not touch the frame edges. */
const FRAMING_MARGIN = 1.25;

/** Fallback box (cm) used when the selection has no usable bounds. */
const FALLBACK_HALF_EXTENT = 60;

export interface CameraPlanes {
  near: number;
  far: number;
}

export interface OrbitDistanceLimits {
  minDistance: number;
  maxDistance: number;
}

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

function normalizeDirection(direction: Vec3Like, fallback: Vec3Like): Vec3Like {
  const safe = isFiniteVec3(direction) ? direction : fallback;
  const length = Math.hypot(safe.x, safe.y, safe.z);
  if (length > 1e-9) {
    return { x: safe.x / length, y: safe.y / length, z: safe.z / length };
  }
  const fallbackLength = Math.hypot(fallback.x, fallback.y, fallback.z) || 1;
  return {
    x: fallback.x / fallbackLength,
    y: fallback.y / fallbackLength,
    z: fallback.z / fallbackLength,
  };
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

/** Half-diagonal of a bounds box; the rotation-invariant framing radius. */
export function boundsRadius(bounds: BoundsBox | null | undefined): number {
  const box = safeBounds(bounds);
  const size = {
    x: box.max.x - box.min.x,
    y: box.max.y - box.min.y,
    z: box.max.z - box.min.z,
  };
  return Math.max(Math.hypot(size.x, size.y, size.z) / 2, 1);
}

/**
 * Near/far planes for a framed object sphere.
 *
 * `near` is a small fraction of the target distance (bounded so a huge scene
 * does not push it into the object), while `far` keeps the existing room-scale
 * range so the surrounding room is not clipped when it is visible. When the
 * camera is outside the sphere, `near` is also kept in front of its nearest
 * surface. If the camera is inside the sphere, full containment is impossible;
 * `near` then stays in front of the target so the view remains usable.
 */
export function computeCameraPlanes(distance: number, radius: number): CameraPlanes {
  const safeDistance = Number.isFinite(distance) && distance > 0 ? distance : DEFAULT_CAMERA_FAR;
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 1;

  // Keep the historical near for normal views, but never let it cross the
  // camera position when the camera is very close (e.g. 0.2 cm).
  const baseNear = Math.min(
    Math.max(safeDistance * 0.02, 0.5),
    50,
    safeDistance * 0.9,
  );

  // When the camera is outside the object's bounding sphere, the near plane
  // must stay in front of its nearest surface. If the camera is inside the
  // sphere that is mathematically impossible; keep near in front of the target.
  const surfaceDistance = safeDistance - safeRadius;
  const near =
    surfaceDistance >= 0
      ? Math.min(baseNear, Math.max(MIN_CAMERA_NEAR, surfaceDistance * 0.99))
      : baseNear;

  const far = Math.max(DEFAULT_CAMERA_FAR, safeDistance + safeRadius * 4);
  return { near, far };
}

/**
 * Orbit limits that cannot clamp a legitimate framing distance.
 *
 * Small pieces get a lower minimum so a close product/detail view is possible;
 * very large pieces widen the maximum so OrbitControls cannot pull the camera
 * back inside the object. Rooms keep the historical defaults.
 */
export function computeOrbitDistanceLimits(
  distance: number,
  radius: number,
): OrbitDistanceLimits {
  const safeDistance = Number.isFinite(distance) && distance > 0 ? distance : DEFAULT_ORBIT_MAX_DISTANCE;
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 1;
  const minDistance = Math.min(
    DEFAULT_ORBIT_MIN_DISTANCE,
    Math.max(MIN_ORBIT_DISTANCE, safeRadius * 0.5),
    safeDistance * 0.8,
  );
  const maxDistance = Math.max(DEFAULT_ORBIT_MAX_DISTANCE, safeDistance * 1.5);
  return { minDistance, maxDistance };
}

/** Output aspect for a capture size; invalid sizes fall back to 1:1. */
export function captureAspect(width: number, height: number): number {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return 1;
  }
  return width / height;
}

/**
 * Framing for a specific capture size. The output aspect, not the current
 * viewport aspect, determines the distance so a square or portrait PNG cannot
 * crop a piece that fits on screen.
 */
export function computeCaptureFraming(
  bounds: BoundsBox | null | undefined,
  preset: CameraPreset,
  width: number,
  height: number,
): Framing {
  return computeObjectFraming(bounds, preset, captureAspect(width, height));
}

/**
 * Fit a bounding box at a given aspect ratio from an explicit view direction.
 * This is the shared core of preset framing and of capture framing that keeps
 * the user's current orbit angle while adapting the distance to the output.
 */
export function computeObjectFramingForDirection(
  bounds: BoundsBox | null | undefined,
  direction: Vec3Like,
  aspect: number,
  options: FramingOptions = {},
): Framing {
  const box = safeBounds(bounds);
  const centre: Vec3Like = {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
  };
  const target = options.target && isFiniteVec3(options.target) ? options.target : centre;
  // Use the half-diagonal as a rotation-invariant bounding radius.
  const radius = boundsRadius(box);

  const margin =
    typeof options.margin === 'number' && Number.isFinite(options.margin) && options.margin > 0
      ? options.margin
      : FRAMING_MARGIN;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const fovV = (FRAMING_FOV_DEG * Math.PI) / 180;
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * safeAspect);
  // Distance needed so the sphere of `radius` fits both axes.
  const distanceV = (radius / Math.sin(fovV / 2)) * margin;
  const distanceH = (radius / Math.sin(fovH / 2)) * margin;
  const distance = Math.max(distanceV, distanceH);

  let unit = normalizeDirection(direction, PRESET_DIRECTIONS.iso);
  // A perfectly vertical view makes lookAt's up-vector degenerate. Nudge it
  // sideways like the existing `top` preset does.
  if (Math.abs(unit.y) > 0.999999 && Math.hypot(unit.x, unit.z) < 1e-6) {
    unit = normalizeDirection({ x: unit.x, y: unit.y, z: 0.02 }, PRESET_DIRECTIONS.iso);
  }
  const planes = computeCameraPlanes(distance, radius);

  return {
    position: {
      x: target.x + unit.x * distance,
      y: target.y + unit.y * distance,
      z: target.z + unit.z * distance,
    },
    target,
    ...planes,
    distance,
    radius,
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
  return computeObjectFramingForDirection(
    bounds,
    PRESET_DIRECTIONS[preset] ?? PRESET_DIRECTIONS.iso,
    aspect,
  );
}
