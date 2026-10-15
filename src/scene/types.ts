import { TABLE_DEFAULTS } from '../geometry/tableParams';
import {
  FURNITURE_DEFAULT_NAMES,
  createFurnitureParams,
  type FurnitureParams,
  type FurnitureType,
} from '../geometry/furniture/types';
import { createDefaultSettings, type SceneSettings } from './sceneSettings';

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

/** Scene object types are the W2 furniture vocabulary. */
export type SceneObjectType = FurnitureType;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type RoomWall = 'north' | 'south' | 'east' | 'west';

export const ROOM_WALLS: readonly RoomWall[] = ['north', 'east', 'south', 'west'];

export type OpeningKind = 'door' | 'window';

/** A door/window *model* entry on a wall (see the room builder for rendering). */
export interface RoomOpening {
  id: string;
  kind: OpeningKind;
  wall: RoomWall;
  /** Centre offset along the wall from the room centre (cm). */
  offsetCm: number;
  widthCm: number;
  heightCm: number;
  /** Distance of the opening's bottom edge from the floor (cm); 0 for doors. */
  sillCm: number;
}

export const OPENING_LIMITS = {
  offsetCm: { min: -2000, max: 2000, step: 5 },
  widthCm: { min: 40, max: 400, step: 5 },
  heightCm: { min: 40, max: 400, step: 5 },
  sillCm: { min: 0, max: 300, step: 5 },
} satisfies Record<'offsetCm' | 'widthCm' | 'heightCm' | 'sillCm', NumericRange>;

export const MAX_OPENINGS_PER_ROOM = 12;

export interface RoomConfig {
  /** Room extent along X (cm). */
  widthCm: number;
  /** Room extent along Z (cm). */
  lengthCm: number;
  /** Wall height along Y (cm). */
  heightCm: number;
  /** W6: draw a ceiling slab. */
  showCeiling?: boolean;
  /**
   * W6: extensible door/window model. Purely descriptive here — the room builder
   * draws thin markers on the wall to show the positions; they are NOT real
   * holes cut out of the wall geometry (documented, deferred).
   */
  openings?: RoomOpening[];
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
  params: FurnitureParams;
  /** PBR material overrides (metalness/roughness). Base colour is `params.color`. */
  material: ObjectMaterial;
}

export interface ObjectMaterial {
  metalness: number;
  roughness: number;
}

export const MATERIAL_DEFAULTS: ObjectMaterial = { metalness: 0.05, roughness: 0.6 };

export const MATERIAL_LIMITS = {
  metalness: { min: 0, max: 1, step: 0.01 },
  roughness: { min: 0, max: 1, step: 0.01 },
} satisfies Record<'metalness' | 'roughness', NumericRange>;

export interface SceneData {
  schemaVersion: number;
  room: RoomConfig;
  objects: SceneObject[];
  settings: SceneSettings;
}

/** Runtime scene state: persisted data plus transient selection. */
export interface SceneState {
  data: SceneData;
  selectedId: string | null;
}

export const SCENE_SCHEMA_VERSION = 3;

/** Pseudo-id used to select the room itself in the hierarchy / viewer. */
export const ROOM_OBJECT_ID = 'room';

export interface NumericRange {
  min: number;
  max: number;
  step: number;
}

/** @deprecated kept as an alias; use {@link NumericRange}. */
export type RoomRange = NumericRange;

export const ROOM_LIMITS = {
  widthCm: { min: 100, max: 2000, step: 10 },
  lengthCm: { min: 100, max: 2000, step: 10 },
  heightCm: { min: 100, max: 600, step: 10 },
} satisfies Record<'widthCm' | 'lengthCm' | 'heightCm', NumericRange>;

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
    material: { ...MATERIAL_DEFAULTS },
    ...overrides,
  };
}

/** Creates a scene object of any W2 furniture type with that type's defaults. */
export function createFurnitureSceneObject(
  type: FurnitureType,
  id: string,
  overrides: Partial<Omit<SceneObject, 'id' | 'type'>> = {},
): SceneObject {
  return {
    id,
    type,
    name: FURNITURE_DEFAULT_NAMES[type],
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    params: createFurnitureParams(type),
    material: { ...MATERIAL_DEFAULTS },
    ...overrides,
  };
}

/** Default scene: a room with a single table standing at its centre. */
export function createDefaultScene(idFactory: () => string): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects: [createTableSceneObject(idFactory())],
    settings: createDefaultSettings(),
  };
}

export function createDefaultSceneState(idFactory: () => string): SceneState {
  const data = createDefaultScene(idFactory);
  return { data, selectedId: data.objects[0]?.id ?? ROOM_OBJECT_ID };
}
