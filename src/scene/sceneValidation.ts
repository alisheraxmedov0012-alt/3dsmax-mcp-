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
import { MATERIAL_PRESET_IDS } from '../materials/presets';
import { PBR_LIMITS } from '../materials/types';
import {
  isKnownSheetMaterial,
  validateSheetThickness,
  type SheetMaterialEntry,
  type ThicknessSource,
} from '../manufacturing/sheetMaterial';
import {
  MATERIAL_DEFAULTS,
  MATERIAL_LIMITS,
  MAX_ASSEMBLIES_PER_SCENE,
  MAX_SHEET_MATERIALS_PER_OBJECT,
  MAX_OPENINGS_PER_ROOM,
  OBJECT_LIMITS,
  OBJECT_NAME_MAX_LENGTH,
  OPENING_LIMITS,
  ROOM_DEFAULTS,
  ROOM_LIMITS,
  ROOM_WALLS,
  SCENE_SCHEMA_VERSION,
  createTableSceneObject,
  isAssemblyKind,
  type NumericRange,
  type ObjectMaterial,
  type OpeningKind,
  type RoomConfig,
  type RoomOpening,
  type RoomWall,
  type SceneAssembly,
  type SceneData,
  type SceneObject,
  type Vec3,
} from './types';

export interface SceneValidationResult {
  scene: SceneData | null;
  /** Number of stored objects that were invalid and therefore dropped. */
  droppedObjects: number;
  /** W14: number of stored assemblies that were invalid and therefore dropped. */
  droppedAssemblies?: number;
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
 * Validate stored manufacturing-material assignments.
 *
 * This is the only place a saved assignment is read back, so it is where a
 * corrupted or hand-edited record must be stopped: an entry survives only when
 * its partId is a non-empty string, its material is in the catalogue and its
 * thickness passes the C3 rule. Anything else is dropped rather than repaired —
 * inventing a thickness here would put a number in the BOM that the user never
 * entered.
 *
 * Absent or empty input yields `undefined`, not `[]`, so an object that never had
 * assignments keeps its exact previous shape on re-save.
 */
export function normalizeSheetMaterials(value: unknown): SheetMaterialEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const seen = new Set<string>();
  const entries: SheetMaterialEntry[] = [];
  for (const raw of value) {
    if (entries.length >= MAX_SHEET_MATERIALS_PER_OBJECT) {
      break;
    }
    if (!isRecord(raw)) {
      continue;
    }
    const partId = typeof raw.partId === 'string' ? raw.partId.trim() : '';
    if (partId === '' || seen.has(partId)) {
      // Duplicate partIds are ambiguous; the first one wins, like duplicate ids.
      continue;
    }
    if (!isKnownSheetMaterial(raw.materialId)) {
      continue;
    }
    const thickness = validateSheetThickness(raw.thicknessMm);
    if (!thickness.ok) {
      continue;
    }
    const source: ThicknessSource = raw.thicknessSource === 'default' ? 'default' : 'user';
    seen.add(partId);
    entries.push({
      partId,
      materialId: raw.materialId,
      thicknessMm: thickness.thicknessMm,
      thicknessSource: source,
    });
  }
  return entries.length > 0 ? entries : undefined;
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
  const material: ObjectMaterial = {
    metalness: clampUnit(record.metalness, MATERIAL_DEFAULTS.metalness),
    roughness: clampUnit(record.roughness, MATERIAL_DEFAULTS.roughness),
  };

  // W4 channels: kept only when present and usable. A non-finite or unknown
  // value is dropped so the renderer resolves it to its default.
  const optionalNumber = (raw: unknown, range: NumericRange): number | undefined => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return undefined;
    }
    return Math.min(Math.max(raw, range.min), range.max);
  };

  if (typeof record.materialId === 'string' && MATERIAL_PRESET_IDS.has(record.materialId)) {
    material.materialId = record.materialId;
  }
  const opacity = optionalNumber(record.opacity, PBR_LIMITS.opacity);
  if (opacity !== undefined) material.opacity = opacity;
  const textureScale = optionalNumber(record.textureScale, PBR_LIMITS.textureScale);
  if (textureScale !== undefined) material.textureScale = textureScale;
  const normalStrength = optionalNumber(record.normalStrength, PBR_LIMITS.normalStrength);
  if (normalStrength !== undefined) material.normalStrength = normalStrength;

  return material;
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
    // Manufacturing material (C3) travels with the object so assignments survive
    // save/load; it is a different field from the PBR `material` above.
    sheetMaterials: normalizeSheetMaterials(value.sheetMaterials),
  };
}

/**
 * Validates a whole scene. The room is normalized (never fails); individual
 * invalid objects are dropped. Duplicate ids are removed (first wins) so the
 * scene can never contain ambiguous identifiers.
 */
export function validateSceneData(value: unknown): SceneValidationResult {
  if (!isRecord(value)) {
    return { scene: null, droppedObjects: 0, droppedAssemblies: 0 };
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

  const { assemblies, dropped: droppedAssemblies } = validateAssemblies(value.assemblies);

  return {
    scene: {
      schemaVersion: SCENE_SCHEMA_VERSION,
      room,
      objects,
      settings: validateSceneSettings(value.settings),
      // W14: omitted entirely when the scene has no assemblies, so a scene
      // saved before W14 round-trips to exactly the same JSON shape.
      ...(assemblies.length > 0 ? { assemblies } : {}),
    },
    droppedObjects,
    droppedAssemblies,
  };
}

/**
 * W14 — validate the stored `assemblies` array.
 *
 * The rule is the same as for objects: an entry that cannot be understood is
 * dropped (and counted), never guessed at. The list is capped at
 * `MAX_ASSEMBLIES_PER_SCENE`; entries beyond the cap are dropped too, so an
 * oversized scene cannot exhaust memory on load.
 *
 * This validates *structure* only. Whether the parameters make a buildable
 * construction is decided later by `validateAssemblyParams()` in the geometry
 * layer — exactly the split the scene layer already uses for objects.
 */
export function validateAssemblies(raw: unknown): {
  assemblies: SceneAssembly[];
  dropped: number;
} {
  if (!Array.isArray(raw)) {
    return { assemblies: [], dropped: 0 };
  }

  const assemblies: SceneAssembly[] = [];
  const seen = new Set<string>();
  let dropped = 0;

  for (const entry of raw) {
    if (assemblies.length >= MAX_ASSEMBLIES_PER_SCENE) {
      dropped += 1;
      continue;
    }
    if (!isRecord(entry)) {
      dropped += 1;
      continue;
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id || id.length > 64 || seen.has(id)) {
      dropped += 1;
      continue;
    }
    if (!isAssemblyKind(entry.kind)) {
      dropped += 1;
      continue;
    }
    if (!isRecord(entry.params)) {
      dropped += 1;
      continue;
    }
    seen.add(id);
    assemblies.push({ id, kind: entry.kind, params: entry.params });
  }

  return { assemblies, dropped };
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
