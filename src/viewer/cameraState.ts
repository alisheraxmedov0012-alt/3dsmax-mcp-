/**
 * Phase 5.1 — camera/OrbitControls state helpers.
 *
 * The viewer mutates one shared camera while capturing a still. These helpers
 * keep that mutation reversible: every capture snapshots the full camera and
 * orbit state, and restores it even when the capture fails. They are pure
 * structural code (no WebGL), so the restore contract is unit-testable.
 */

export interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraLike {
  position: MutableVec3;
  up: MutableVec3;
  fov: number;
  aspect: number;
  near: number;
  far: number;
  zoom: number;
  updateProjectionMatrix: () => void;
  lookAt?: (x: number, y: number, z: number) => void;
}

export interface OrbitControlsLike {
  target: MutableVec3;
  minDistance: number;
  maxDistance: number;
  update: () => void;
}

export interface FramingLike {
  position: MutableVec3;
  target: MutableVec3;
  near?: number;
  far?: number;
}

export interface CameraState {
  position: MutableVec3;
  up: MutableVec3;
  target: MutableVec3;
  fov: number;
  aspect: number;
  near: number;
  far: number;
  zoom: number;
  minDistance: number;
  maxDistance: number;
}

export interface ApplyFramingOptions {
  /** OrbitControls.update() also applies distance/polar clamps and lookAt. */
  updateControls?: boolean;
}

function cloneVec3(value: MutableVec3): MutableVec3 {
  return { x: value.x, y: value.y, z: value.z };
}

function isPositiveFinite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Capture everything a still render is allowed to change. */
export function captureCameraState(
  camera: CameraLike,
  controls: OrbitControlsLike,
): CameraState {
  return {
    position: cloneVec3(camera.position),
    up: cloneVec3(camera.up),
    target: cloneVec3(controls.target),
    fov: camera.fov,
    aspect: camera.aspect,
    near: camera.near,
    far: camera.far,
    zoom: camera.zoom,
    minDistance: controls.minDistance,
    maxDistance: controls.maxDistance,
  };
}

/** Restore a snapshot exactly, including projection and orbit limits. */
export function restoreCameraState(
  camera: CameraLike,
  controls: OrbitControlsLike,
  state: CameraState,
): void {
  camera.position.x = state.position.x;
  camera.position.y = state.position.y;
  camera.position.z = state.position.z;
  camera.up.x = state.up.x;
  camera.up.y = state.up.y;
  camera.up.z = state.up.z;
  controls.target.x = state.target.x;
  controls.target.y = state.target.y;
  controls.target.z = state.target.z;
  camera.fov = state.fov;
  camera.aspect = state.aspect;
  camera.near = state.near;
  camera.far = state.far;
  camera.zoom = state.zoom;
  controls.minDistance = state.minDistance;
  controls.maxDistance = state.maxDistance;
  camera.updateProjectionMatrix();
  controls.update();
}

/**
 * Apply one framing to the shared camera. `updateControls: false` is used for
 * capture so OrbitControls cannot clamp the framing distance mid-render; the
 * explicit lookAt keeps the camera aimed at the target in that case.
 */
export function applyFramingToCamera(
  camera: CameraLike,
  controls: OrbitControlsLike,
  framing: FramingLike,
  options: ApplyFramingOptions = {},
): void {
  camera.position.x = framing.position.x;
  camera.position.y = framing.position.y;
  camera.position.z = framing.position.z;
  controls.target.x = framing.target.x;
  controls.target.y = framing.target.y;
  controls.target.z = framing.target.z;

  if (isPositiveFinite(framing.near) && isPositiveFinite(framing.far) && framing.far > framing.near) {
    camera.near = framing.near;
    camera.far = framing.far;
    camera.updateProjectionMatrix();
  }

  camera.lookAt?.(framing.target.x, framing.target.y, framing.target.z);

  if (options.updateControls !== false) {
    controls.update();
  }
}

/**
 * Run a capture task with the complete camera/orbit state restored afterwards,
 * whether the task succeeds or throws. This is the transaction used by
 * `SceneViewer.capturePng()`.
 */
export async function withRestoredCameraState<T>(
  camera: CameraLike,
  controls: OrbitControlsLike,
  task: () => T | Promise<T>,
): Promise<T> {
  const state = captureCameraState(camera, controls);
  try {
    return await task();
  } finally {
    restoreCameraState(camera, controls, state);
  }
}
