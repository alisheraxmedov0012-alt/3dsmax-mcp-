import { TABLE_DEFAULTS, type TableParams } from '../geometry/tableParams';

/**
 * Scene data model (Stage 5).
 *
 * Coordinate convention (right-handed, Y up, all lengths in centimetres):
 * - The room floor is the Y = 0 plane.
 * - The room is centred on the X/Z origin: x ∈ [-width/2, width/2],
 *   z ∈ [-length/2, length/2], walls rise along +Y to `heightCm`.
 * - Object `position` translates the object's origin, which rests on the floor
 *   (y = 0 means "standing on the floor").
 * - `rotation` is stored in DEGREES (Euler XYZ) for readability; the viewer
 *   converts it to radians when applying the transform.
 * - `scale` is a unitless multiplier per axis.
 *
 * This model is intentionally free of Three.js types so it can be serialized,
 * validated and tested without a WebGL context.
 */

export type SceneObjectType = 'table';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface RoomConfig {
  /** Room extent along X (cm). */
  widthCm: number;
  /** Room extent along Z (cm). */
  lengthCm: number;
  /** Wall height along Y (cm). */
  heightCm: number;
}

export interface SceneObject {
  id: string;
  type: SceneObjectType;
  name: string;
  position: Vec3;
  /** Euler XYZ rotation in degrees. */
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
  params: TableParams;
}

export interface SceneData {
  schemaVersion: number;
  room: RoomConfig;
  objects: SceneObject[];
}

/** Runtime scene state: persisted data plus transient selection. */
export interface SceneState {
  data: SceneData;
  selectedId: string | null;
}

export const SCENE_SCHEMA_VERSION = 2;

/** Pseudo-id used to select the room itself in the hierarchy / viewer. */
export const ROOM_OBJECT_ID = 'room';

export interface RoomRange {
  min: number;
  max: number;
  step: number;
}

export const ROOM_LIMITS = {
  widthCm: { min: 100, max: 2000, step: 10 },
  lengthCm: { min: 100, max: 2000, step: 10 },
  heightCm: { min: 100, max: 600, step: 10 },
} satisfies Record<'widthCm' | 'lengthCm' | 'heightCm', RoomRange>;

export const ROOM_DEFAULTS: RoomConfig = {
  widthCm: 400,
  lengthCm: 500,
  heightCm: 280,
};

export const OBJECT_LIMITS = {
  position: { min: -2000, max: 2000, step: 5 },
  rotation: { min: 0, max: 360, step: 5 },
  scale: { min: 0.1, max: 10, step: 0.1 },
};

export const OBJECT_NAME_MAX_LENGTH = 60;

export const TABLE_OBJECT_DEFAULT_NAME = 'Stol';

export function createRoomConfig(partial?: Partial<RoomConfig>): RoomConfig {
  return { ...ROOM_DEFAULTS, ...partial };
}

export function createTableSceneObject(
  id: string,
  overrides: Partial<Omit<SceneObject, 'id' | 'type'>> = {},
): SceneObject {
  return {
    id,
    type: 'table',
    name: TABLE_OBJECT_DEFAULT_NAME,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    params: { ...TABLE_DEFAULTS },
    ...overrides,
  };
}

/** Default scene: a room with a single table standing at its centre. */
export function createDefaultScene(idFactory: () => string): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects: [createTableSceneObject(idFactory())],
  };
}

export function createDefaultSceneState(idFactory: () => string): SceneState {
  const data = createDefaultScene(idFactory);
  return { data, selectedId: data.objects[0]?.id ?? ROOM_OBJECT_ID };
}
