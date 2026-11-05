/**
 * Phase 5.5 — runtime-only product camera angles.
 *
 * These are deliberately separate from `SceneSettings.cameraPreset`: the
 * persisted five presets keep their schema/API, while product shots can use
 * front/back/left/right/detail without a scene-schema change.
 */
import type { BoundsBox, Framing, Vec3Like } from '../render/framing';
import { computeObjectFramingForDirection, isValidBounds } from '../render/framing';

export type CameraAngleId =
  | 'hero'
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'top'
  | 'detail';

export interface CameraAngle {
  id: CameraAngleId;
  label: string;
  /** Direction from the target towards the camera. */
  direction: Vec3Like;
}

export const CAMERA_ANGLES: readonly CameraAngleId[] = [
  'hero',
  'front',
  'back',
  'left',
  'right',
  'top',
  'detail',
];

export const CAMERA_ANGLE_LABELS: Record<CameraAngleId, string> = {
  hero: 'Hero (uch chorak)',
  front: 'Old',
  back: 'Orqa',
  left: 'Chap yon',
  right: "O'ng yon",
  top: 'Yuqoridan',
  detail: 'Detal (yaqin)',
};

/** Stable directions; `top` keeps the small Z offset used by the old preset. */
export const CAMERA_ANGLE_DEFINITIONS: Record<CameraAngleId, CameraAngle> = {
  hero: {
    id: 'hero',
    label: CAMERA_ANGLE_LABELS.hero,
    direction: { x: 0.85, y: 0.32, z: 1.25 },
  },
  front: {
    id: 'front',
    label: CAMERA_ANGLE_LABELS.front,
    direction: { x: 0, y: 0.08, z: 1 },
  },
  back: {
    id: 'back',
    label: CAMERA_ANGLE_LABELS.back,
    direction: { x: 0, y: 0.08, z: -1 },
  },
  left: {
    id: 'left',
    label: CAMERA_ANGLE_LABELS.left,
    direction: { x: -1, y: 0.08, z: 0 },
  },
  right: {
    id: 'right',
    label: CAMERA_ANGLE_LABELS.right,
    direction: { x: 1, y: 0.08, z: 0 },
  },
  top: {
    id: 'top',
    label: CAMERA_ANGLE_LABELS.top,
    direction: { x: 0, y: 1, z: 0.02 },
  },
  detail: {
    id: 'detail',
    label: CAMERA_ANGLE_LABELS.detail,
    direction: { x: 0.85, y: 0.5, z: 1.1 },
  },
};

/** Tighter than the standard product margin; still leaves a safe edge. */
export const DETAIL_MARGIN = 1.05;
/** No selected part: zoom toward the product centre without entering it. */
export const DETAIL_FALLBACK_MARGIN = 0.72;

/**
 * Framing for one angle. When `detailBounds` is valid the detail shot focuses
 * on that part's bounding box; otherwise it centres on the product bounds.
 */
export function computeCameraAngleFraming(
  bounds: BoundsBox | null | undefined,
  angle: CameraAngleId,
  aspect: number,
  detailBounds?: BoundsBox | null,
): Framing {
  const definition = CAMERA_ANGLE_DEFINITIONS[angle];
  if (angle === 'detail') {
    const focus = isValidBounds(detailBounds) ? detailBounds : bounds;
    return computeObjectFramingForDirection(focus, definition.direction, aspect, {
      margin: isValidBounds(detailBounds) ? DETAIL_MARGIN : DETAIL_FALLBACK_MARGIN,
    });
  }
  return computeObjectFramingForDirection(bounds, definition.direction, aspect);
}

export function isCameraAngleId(value: unknown): value is CameraAngleId {
  return typeof value === 'string' && (CAMERA_ANGLES as readonly string[]).includes(value);
}
