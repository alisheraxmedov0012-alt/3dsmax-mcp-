/**
 * Phase 5.1 — the OrbitControls configuration the viewer starts from.
 *
 * Kept as data rather than scattered assignments so the desktop/touch contract
 * (damping, zoom range and the floor-safe polar limit) can be unit-tested
 * without creating a WebGL context. Object framing may soften the distance
 * limits later; these are the safe defaults for a room view.
 */
import { DEFAULT_ORBIT_MAX_DISTANCE, DEFAULT_ORBIT_MIN_DISTANCE } from '../render/framing';

export interface OrbitSettings {
  enableDamping: boolean;
  dampingFactor: number;
  minDistance: number;
  maxDistance: number;
  maxPolarAngle: number;
}

export const VIEWER_ORBIT_SETTINGS: OrbitSettings = {
  enableDamping: true,
  dampingFactor: 0.08,
  minDistance: DEFAULT_ORBIT_MIN_DISTANCE,
  maxDistance: DEFAULT_ORBIT_MAX_DISTANCE,
  // Keep the camera above the floor; the top preset has its own tiny Z offset.
  maxPolarAngle: Math.PI / 2 - 0.02,
};

export function applyOrbitSettings(
  controls: OrbitSettings,
  settings: OrbitSettings = VIEWER_ORBIT_SETTINGS,
): void {
  controls.enableDamping = settings.enableDamping;
  controls.dampingFactor = settings.dampingFactor;
  controls.minDistance = settings.minDistance;
  controls.maxDistance = settings.maxDistance;
  controls.maxPolarAngle = settings.maxPolarAngle;
}
