import {
  paramsToFieldValues,
  parseTableValues,
  TABLE_DEFAULTS,
  type TableParams,
} from '../geometry/tableParams';
import {
  OBJECT_LIMITS,
  OBJECT_NAME_MAX_LENGTH,
  ROOM_DEFAULTS,
  ROOM_LIMITS,
  SCENE_SCHEMA_VERSION,
  TABLE_OBJECT_DEFAULT_NAME,
  createTableSceneObject,
  type RoomConfig,
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

/**
 * Validates and normalizes a room configuration. Missing or non-finite values
 * fall back to defaults; out-of-range values are clamped to `ROOM_LIMITS`.
 */
export function validateRoomConfig(value: unknown): RoomConfig {
  const record = isRecord(value) ? value : {};
  const dimension = (key: keyof RoomConfig): number => {
    const range = ROOM_LIMITS[key];
    const raw = record[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return ROOM_DEFAULTS[key];
    }
    return clamp(raw, range.min, range.max);
  };

  return {
    widthCm: dimension('widthCm'),
    lengthCm: dimension('lengthCm'),
    heightCm: dimension('heightCm'),
  };
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

  // Only the table type exists in Stage 5; unknown types are dropped.
  if (value.type !== 'table') {
    return null;
  }

  if (!isRecord(value.params)) {
    return null;
  }
  const params = parseTableValues(
    {
      widthCm: String((value.params as Record<string, unknown>).widthCm ?? ''),
      heightCm: String((value.params as Record<string, unknown>).heightCm ?? ''),
      depthCm: String((value.params as Record<string, unknown>).depthCm ?? ''),
      color:
        typeof (value.params as Record<string, unknown>).color === 'string'
          ? ((value.params as Record<string, unknown>).color as string)
          : '',
    },
  );
  if (!params.params) {
    return null;
  }

  return {
    id: id.trim(),
    type: 'table',
    name: normalizeName(value.name, TABLE_OBJECT_DEFAULT_NAME),
    position: normalizeVec3(value.position, OBJECT_LIMITS.position.min, OBJECT_LIMITS.position.max),
    rotation: normalizeVec3(value.rotation, OBJECT_LIMITS.rotation.min, OBJECT_LIMITS.rotation.max),
    scale: normalizeVec3(value.scale, OBJECT_LIMITS.scale.min, OBJECT_LIMITS.scale.max),
    visible: typeof value.visible === 'boolean' ? value.visible : true,
    params: params.params,
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
    },
    droppedObjects,
  };
}

/**
 * Backward-compatible migration: turns a Stage 1–4 table-only project into a
 * scene (default room + one table). Never discards the saved parameters.
 */
export function migrateLegacyParamsToScene(params: TableParams): SceneData {
  const validated = parseTableValues(paramsToFieldValues(params)).params ?? { ...TABLE_DEFAULTS };
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects: [createTableSceneObject('legacy-table', { params: validated })],
  };
}
