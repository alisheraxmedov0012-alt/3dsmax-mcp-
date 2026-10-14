import {
  paramsToFieldValues,
  parseTableValues,
  TABLE_DEFAULTS,
  type TableParams,
} from '../geometry/tableParams';
import {
  FURNITURE_DEFAULT_NAMES,
  isFurnitureType,
  validateFurnitureParams,
} from '../geometry/furniture';
import { validateSceneSettings } from './sceneSettings';
import {
  MATERIAL_DEFAULTS,
  MATERIAL_LIMITS,
  MAX_OPENINGS_PER_ROOM,
  OBJECT_LIMITS,
  OBJECT_NAME_MAX_LENGTH,
  OPENING_LIMITS,
  ROOM_DEFAULTS,
  ROOM_LIMITS,
  ROOM_WALLS,
  SCENE_SCHEMA_VERSION,
  createTableSceneObject,
  type NumericRange,
  type ObjectMaterial,
  type OpeningKind,
  type RoomConfig,
  type RoomOpening,
  type RoomWall,
  type SceneData,
  type SceneObject,
  type Vec3,
} from './types';

export interface SceneValidationResult {
  scene: SceneData | null;
  /** Number of stored objects that were invalid and therefore dropped. */
  droppedObjects: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeVec3(value: unknown, min: number, max: number): Vec3 {
  if (!isRecord(value)) {
    return { x: 0, y: 0, z: 0 };
  }
  return {
    x: clamp(finiteOr(value.x, 0), min, max),
    y: clamp(finiteOr(value.y, 0), min, max),
    z: clamp(finiteOr(value.z, 0), min, max),
  };
}

function normalizeName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed === '' ? fallback : trimmed.slice(0, OBJECT_NAME_MAX_LENGTH);
}

/** Clamps a material value into 0–1, falling back when non-finite. */
function normalizeMaterial(value: unknown): ObjectMaterial {
  const record = isRecord(value) ? value : {};
  const clampUnit = (raw: unknown, fallback: number): number => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return fallback;
    }
    return Math.min(Math.max(raw, MATERIAL_LIMITS.metalness.min), MATERIAL_LIMITS.metalness.max);
  };
  return {
    metalness: clampUnit(record.metalness, MATERIAL_DEFAULTS.metalness),
    roughness: clampUnit(record.roughness, MATERIAL_DEFAULTS.roughness),
  };
}

/** Validates a single stored door/window entry, or null when unusable. */
export function validateRoomOpening(value: unknown): RoomOpening | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = value.id;
  if (typeof id !== 'string' || id.trim() === '') {
    return null;
  }
  const wall = value.wall;
  if (typeof wall !== 'string' || !(ROOM_WALLS as readonly string[]).includes(wall)) {
    return null;
  }
  const kind: OpeningKind = value.kind === 'window' ? 'window' : 'door';

  const number = (raw: unknown, range: NumericRange, fallback: number): number => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return fallback;
    }
    return clamp(raw, range.min, range.max);
  };

  return {
    id: id.trim().slice(0, OBJECT_NAME_MAX_LENGTH),
    kind,
    wall: wall as RoomWall,
    offsetCm: number(value.offsetCm, OPENING_LIMITS.offsetCm, 0),
    widthCm: number(value.widthCm, OPENING_LIMITS.widthCm, 90),
    heightCm: number(value.heightCm, OPENING_LIMITS.heightCm, kind === 'window' ? 120 : 200),
    sillCm: number(value.sillCm, OPENING_LIMITS.sillCm, kind === 'window' ? 90 : 0),
  };
}

/**
 * Validates and normalizes a room configuration. Missing or non-finite values
 * fall back to defaults; out-of-range values are clamped to `ROOM_LIMITS`.
 * `showCeiling` and the door/window model are optional (W6).
 */
export function validateRoomConfig(value: unknown): RoomConfig {
  const record = isRecord(value) ? value : {};
  const dimension = (key: 'widthCm' | 'lengthCm' | 'heightCm'): number => {
    const range = ROOM_LIMITS[key];
    const raw = record[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return ROOM_DEFAULTS[key];
    }
    return clamp(raw, range.min, range.max);
  };

  const room: RoomConfig = {
    widthCm: dimension('widthCm'),
    lengthCm: dimension('lengthCm'),
    heightCm: dimension('heightCm'),
  };
  // Only store W6 extras when actually set, so the validated room of an old
  // project is byte-for-byte identical to the Stage 6 shape.
  if (record.showCeiling === true) {
    room.showCeiling = true;
  }

  if (Array.isArray(record.openings)) {
    const openings: RoomOpening[] = [];
    const seen = new Set<string>();
    for (const entry of record.openings) {
      const opening = validateRoomOpening(entry);
      if (opening && !seen.has(opening.id)) {
        seen.add(opening.id);
        openings.push(opening);
      }
      if (openings.length >= MAX_OPENINGS_PER_ROOM) {
        break;
      }
    }
    if (openings.length > 0) {
      room.openings = openings;
    }
  }

  return room;
}

/** Validates one stored scene object. Returns null when it is unusable. */
export function validateSceneObject(value: unknown): SceneObject | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value.id;
  if (typeof id !== 'string' || id.trim() === '') {
    return null;
  }

  // Any known W2 furniture type is accepted; unknown types are dropped.
  if (!isFurnitureType(value.type)) {
    return null;
  }

  const params = validateFurnitureParams(value.type, value.params);
  if (!params) {
    return null;
  }

  return {
    id: id.trim(),
    type: value.type,
    name: normalizeName(value.name, FURNITURE_DEFAULT_NAMES[value.type]),
    position: normalizeVec3(value.position, OBJECT_LIMITS.position.min, OBJECT_LIMITS.position.max),
    rotation: normalizeVec3(value.rotation, OBJECT_LIMITS.rotation.min, OBJECT_LIMITS.rotation.max),
    scale: normalizeVec3(value.scale, OBJECT_LIMITS.scale.min, OBJECT_LIMITS.scale.max),
    visible: typeof value.visible === 'boolean' ? value.visible : true,
    params,
    material: normalizeMaterial(value.material),
  };
}

/**
 * Validates a whole scene. The room is normalized (never fails); individual
 * invalid objects are dropped. Duplicate ids are removed (first wins) so the
 * scene can never contain ambiguous identifiers.
 */
export function validateSceneData(value: unknown): SceneValidationResult {
  if (!isRecord(value)) {
    return { scene: null, droppedObjects: 0 };
  }

  const room = validateRoomConfig(value.room);

  const rawObjects = Array.isArray(value.objects) ? value.objects : [];
  const objects: SceneObject[] = [];
  const seen = new Set<string>();
  let droppedObjects = 0;

  rawObjects.forEach((entry) => {
    const object = validateSceneObject(entry);
    if (!object || seen.has(object.id)) {
      droppedObjects += 1;
      return;
    }
    seen.add(object.id);
    objects.push(object);
  });

  return {
    scene: {
      schemaVersion: SCENE_SCHEMA_VERSION,
      room,
      objects,
      settings: validateSceneSettings(value.settings),
    },
    droppedObjects,
  };
}

/**
 * Backward-compatible migration: turns a Stage 1–4 table-only project into a
 * scene (default room + one table + default visualization settings). Never
 * discards the saved parameters.
 */
export function migrateLegacyParamsToScene(params: TableParams): SceneData {
  const validated = parseTableValues(paramsToFieldValues(params)).params ?? { ...TABLE_DEFAULTS };
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects: [createTableSceneObject('legacy-table', { params: validated })],
    settings: validateSceneSettings(undefined),
  };
}
