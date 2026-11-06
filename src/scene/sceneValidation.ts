import {
  paramsToFieldValues,
  parseTableValues,
  TABLE_DEFAULTS,
  type TableParams,
} from '../geometry/tableParams';
import {
  FURNITURE_DEFAULT_NAMES,
  createFurnitureParams,
  isFurnitureType,
  validateFurnitureParamsDetailed,
  type FurnitureParams,
  type FurnitureType,
  type ParamNormalization,
} from '../geometry/furniture';
import { getFurnitureDefinition } from '../geometry/universal/registry';
import { checkSpecBuildable } from './configurator/buildability';
import { validateSceneSettings } from './sceneSettings';
import { MATERIAL_PRESET_IDS } from '../materials/presets';
import { validateMaterialAssetMaps } from '../materials/asset';
import { PBR_LIMITS } from '../materials/types';
import {
  isKnownSheetMaterial,
  validateSheetThickness,
  type SheetMaterialEntry,
  type ThicknessSource,
} from '../manufacturing/sheetMaterial';
import { buildHardwareBom, type HardwareItem } from '../manufacturing/hardware';
import {
  MATERIAL_DEFAULTS,
  MATERIAL_LIMITS,
  IMPORTED_BOUNDS_LIMIT_CM,
  IMPORTED_MODEL_FORMATS,
  IMPORTED_OBJECT_TYPE,
  MAX_ASSEMBLIES_PER_SCENE,
  MAX_DEFINITION_ID_LENGTH,
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
  normalizeSceneSpec,
  type NumericRange,
  type ObjectMaterial,
  type OpeningKind,
  type RoomConfig,
  type RoomOpening,
  type RoomWall,
  type SceneAssembly,
  type SceneData,
  type SceneObject,
  type SceneSpec,
  type Vec3,
  type ImportedModelBounds,
  type ImportedModelFormat,
  type ImportedModelMeta,
} from './types';

export interface SceneValidationResult {
  scene: SceneData | null;
  /** Number of stored objects that were invalid and therefore dropped. */
  droppedObjects: number;
  /** W14: number of stored assemblies that were invalid and therefore dropped. */
  droppedAssemblies?: number;
  /**
   * C8.6.2: stored parameter channels that were rewritten to fit the field
   * contract, per object. Omitted when nothing was adjusted, so the common case is
   * unchanged in shape. Callers that ignore it behave exactly as before.
   */
  normalizations?: Array<{ objectId: string; fields: string[] }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(trimmed) ? trimmed : undefined;
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
  const emissiveIntensity = optionalNumber(
    record.emissiveIntensity,
    PBR_LIMITS.emissiveIntensity,
  );
  if (emissiveIntensity !== undefined) material.emissiveIntensity = emissiveIntensity;
  const aoIntensity = optionalNumber(record.aoIntensity, PBR_LIMITS.aoIntensity);
  if (aoIntensity !== undefined) material.aoIntensity = aoIntensity;
  const baseColor = normalizeHexColor(record.baseColor);
  if (baseColor !== undefined) material.baseColor = baseColor;
  const emissiveColor = normalizeHexColor(record.emissiveColor);
  if (emissiveColor !== undefined) material.emissiveColor = emissiveColor;

  // Phase 4.5: every map role goes through the shared validator, which enforces
  // role/color-space rules and rejects unknown roles. Malformed stored data is
  // dropped without failing the whole scene, matching the pre-4.5 behaviour.
  if (isRecord(record.maps)) {
    const validated = validateMaterialAssetMaps(record.maps);
    if (validated.ok && Object.keys(validated.maps).length > 0) {
      material.maps = validated.maps;
    }
  }

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

function normalizeHardware(value: unknown): { hardware: HardwareItem[] } | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const result = buildHardwareBom(value as HardwareItem[]);
  if (!result.ok || !result.hardware.specified) {
    return undefined;
  }
  return { hardware: result.hardware.items };
}

/** Validates one stored scene object. Returns null when it is unusable. */
export function validateSceneObject(value: unknown): SceneObject | null {
  return validateSceneObjectDetailed(value)?.object ?? null;
}

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const MAX_IMPORTED_FILE_NAME_LENGTH = 255;

/** Same rule as `normalizeAssetPath`: no control characters in a stored name. */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** Imported metadata is rejected rather than repaired, like a stored board assignment. */
function strictVec3(value: unknown, limit: number): Vec3 | null {
  if (!isRecord(value)) {
    return null;
  }
  const axes: number[] = [];
  for (const axis of ['x', 'y', 'z'] as const) {
    const raw = value[axis];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < -limit || raw > limit) {
      return null;
    }
    axes.push(raw);
  }
  return { x: axes[0], y: axes[1], z: axes[2] };
}

function normalizeImportedBounds(value: unknown): ImportedModelBounds | null {
  const min = strictVec3(isRecord(value) ? value.min : undefined, IMPORTED_BOUNDS_LIMIT_CM);
  const max = strictVec3(isRecord(value) ? value.max : undefined, IMPORTED_BOUNDS_LIMIT_CM);
  if (!min || !max) {
    return null;
  }
  // An inverted box cannot come from the importer and would break framing and
  // every bounds-based capture, so it is treated as corrupt.
  if (min.x > max.x || min.y > max.y || min.z > max.z) {
    return null;
  }
  return { min, max };
}

function importedCount(value: unknown, minimum: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  if (!Number.isInteger(value) || value < minimum) {
    return null;
  }
  return value;
}

type ImportedObjectCheck =
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'imported'; readonly meta: ImportedModelMeta };

/**
 * Phase 6.2 — reads the imported-model fields of a stored object.
 *
 * The pair `type: 'imported'` + `imported` metadata must agree: metadata without
 * the type (or the reverse) is corrupt and the object is dropped, because a stored
 * imported object without metadata would render as nothing while still occupying
 * a slot and a name. Counts and hashes are rejected, never clamped — inventing a
 * triangle count here would put a number in the UI that no file ever contained.
 */
function checkImportedObjectFields(value: Record<string, unknown>): ImportedObjectCheck {
  const rawImported = value.imported;
  if (rawImported === undefined) {
    return { kind: 'none' };
  }
  if (value.type !== IMPORTED_OBJECT_TYPE || !isRecord(rawImported)) {
    return { kind: 'invalid' };
  }

  const format = rawImported.format;
  if (typeof format !== 'string' || !(IMPORTED_MODEL_FORMATS as readonly string[]).includes(format)) {
    return { kind: 'invalid' };
  }

  const rawFileName = rawImported.fileName;
  if (typeof rawFileName !== 'string') {
    return { kind: 'invalid' };
  }
  const fileName = rawFileName.trim();
  if (
    fileName === '' ||
    fileName.length > MAX_IMPORTED_FILE_NAME_LENGTH ||
    hasControlCharacter(fileName)
  ) {
    return { kind: 'invalid' };
  }

  const sourceBytes = importedCount(rawImported.sourceBytes, 1);
  const meshes = importedCount(rawImported.meshes, 0);
  const triangles = importedCount(rawImported.triangles, 0);
  const materials = importedCount(rawImported.materials, 0);
  const textures = importedCount(rawImported.textures, 0);
  if (
    sourceBytes === null ||
    meshes === null ||
    triangles === null ||
    materials === null ||
    textures === null
  ) {
    return { kind: 'invalid' };
  }

  const sourceHash = rawImported.sourceHash;
  if (typeof sourceHash !== 'string' || !SHA256_HEX.test(sourceHash)) {
    return { kind: 'invalid' };
  }

  const boundsCm = normalizeImportedBounds(rawImported.boundsCm);
  if (!boundsCm) {
    return { kind: 'invalid' };
  }

  return {
    kind: 'imported',
    meta: {
      format: format as ImportedModelFormat,
      fileName,
      sourceBytes,
      meshes,
      triangles,
      materials,
      textures,
      sourceHash,
      boundsCm,
    },
  };
}

type UniversalObjectCheck =
  | { readonly kind: 'legacy' }
  | { readonly kind: 'invalid' }
  | {
      readonly kind: 'universal';
      readonly definitionId: string;
      readonly family: FurnitureType;
      readonly label: string;
      readonly spec: SceneSpec;
    };

/**
 * Stage 3.0 — reads the universal fields of a stored object.
 *
 * `definitionId` and `spec` are a pair: absent together (legacy object) or
 * present together (universal object). Anything else is `invalid` and the object
 * is dropped by the caller. A universal object is only accepted when the
 * definition exists and the spec produces a valid plan, so a persisted object can
 * never reach the viewer with geometry that cannot be built.
 */
function checkUniversalObjectFields(value: Record<string, unknown>): UniversalObjectCheck {
  const rawDefinitionId = value.definitionId;
  const rawSpec = value.spec;
  if (rawDefinitionId === undefined && rawSpec === undefined) {
    return { kind: 'legacy' };
  }
  if (rawDefinitionId === undefined || rawSpec === undefined) {
    return { kind: 'invalid' };
  }
  if (typeof rawDefinitionId !== 'string') {
    return { kind: 'invalid' };
  }

  const definitionId = rawDefinitionId.trim();
  if (definitionId === '' || definitionId.length > MAX_DEFINITION_ID_LENGTH) {
    return { kind: 'invalid' };
  }
  const definition = getFurnitureDefinition(definitionId);
  if (!definition) {
    return { kind: 'invalid' };
  }

  const spec = normalizeSceneSpec(rawSpec);
  if (!spec) {
    return { kind: 'invalid' };
  }
  // Full pipeline (memoised with the configurator): parsing alone would let a
  // spec that cannot be solved through.
  const buildable = checkSpecBuildable(definition.id, spec);
  if (!buildable.ok) {
    return { kind: 'invalid' };
  }

  return {
    kind: 'universal',
    definitionId: definition.id,
    family: definition.family,
    label: definition.label,
    spec: buildable.spec,
  };
}

/**
 * Builds the stored form of an imported object.
 *
 * Only fields common to every scene object are read (name, transform,
 * visibility, PBR material). Manufacturing assignments are deliberately not
 * accepted: an imported mesh has no part list, so a stored board or hardware
 * assignment would be a number the user never entered for this object.
 */
function buildImportedSceneObject(
  id: string,
  value: Record<string, unknown>,
  meta: ImportedModelMeta,
): SceneObject {
  return {
    id: id.trim(),
    type: IMPORTED_OBJECT_TYPE,
    kind: 'imported',
    name: normalizeName(value.name, meta.fileName),
    position: normalizeVec3(value.position, OBJECT_LIMITS.position.min, OBJECT_LIMITS.position.max),
    rotation: normalizeVec3(value.rotation, OBJECT_LIMITS.rotation.min, OBJECT_LIMITS.rotation.max),
    scale: normalizeVec3(value.scale, OBJECT_LIMITS.scale.min, OBJECT_LIMITS.scale.max),
    visible: typeof value.visible === 'boolean' ? value.visible : true,
    params: { ...TABLE_DEFAULTS },
    material: normalizeMaterial(value.material),
    imported: meta,
  };
}

/**
 * Same as {@link validateSceneObject}, plus the list of parameter channels that
 * had to be rewritten. Used where the result is reported to the user.
 */
function validateSceneObjectDetailed(
  value: unknown,
): { object: SceneObject; normalized: string[] } | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value.id;
  if (typeof id !== 'string' || id.trim() === '') {
    return null;
  }

  // Phase 6.2: an imported object is validated and returned before any furniture
  // logic runs, so the parametric branches below never see `type: 'imported'`.
  const imported = checkImportedObjectFields(value);
  if (imported.kind === 'invalid') {
    return null;
  }
  if (imported.kind === 'imported') {
    return { object: buildImportedSceneObject(id, value, imported.meta), normalized: [] };
  }
  // A stored `type: 'imported'` without metadata falls through to the furniture
  // check and is dropped: there is no geometry to restore, so keeping the object
  // would leave an invisible entry in the hierarchy.

  const universal = checkUniversalObjectFields(value);
  if (universal.kind === 'invalid') {
    return null;
  }

  let type: FurnitureType;
  let params: FurnitureParams;
  let nameFallback: string;
  let normalized: string[] = [];

  if (universal.kind === 'universal') {
    // The definition owns the family, so a stale stored `type` cannot disagree
    // with the geometry. `params` is only the legacy projection: a bad or
    // missing value falls back to the family defaults instead of dropping a
    // piece that is fully described by its spec.
    type = universal.family;
    params =
      validateFurnitureParamsDetailed(type, value.params)?.params ?? createFurnitureParams(type);
    nameFallback = universal.label;
  } else {
    // Any known W2 furniture type is accepted; unknown types are dropped.
    if (!isFurnitureType(value.type)) {
      return null;
    }

    const validated = validateFurnitureParamsDetailed(value.type, value.params);
    if (!validated) {
      return null;
    }
    type = value.type;
    params = validated.params;
    nameFallback = FURNITURE_DEFAULT_NAMES[type];
    normalized = validated.normalized.map((entry: ParamNormalization) => entry.key);
  }

  const object: SceneObject = {
    id: id.trim(),
    type,
    name: normalizeName(value.name, nameFallback),
    position: normalizeVec3(value.position, OBJECT_LIMITS.position.min, OBJECT_LIMITS.position.max),
    rotation: normalizeVec3(value.rotation, OBJECT_LIMITS.rotation.min, OBJECT_LIMITS.rotation.max),
    scale: normalizeVec3(value.scale, OBJECT_LIMITS.scale.min, OBJECT_LIMITS.scale.max),
    visible: typeof value.visible === 'boolean' ? value.visible : true,
    params,
    material: normalizeMaterial(value.material),
    // Manufacturing material (C3) travels with the object so assignments survive
    // save/load; it is a different field from the PBR `material` above.
    sheetMaterials: normalizeSheetMaterials(value.sheetMaterials),
    // Invalid stored hardware is omitted rather than allowed to reach exports;
    // the package then reports the explicit "not specified" state.
    ...normalizeHardware(value.hardware),
    // Omitted entirely for legacy objects so their stored JSON shape is unchanged.
    ...(universal.kind === 'universal'
      ? { definitionId: universal.definitionId, spec: universal.spec }
      : {}),
  };

  return { object, normalized };
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
  const normalizations: Array<{ objectId: string; fields: string[] }> = [];

  rawObjects.forEach((entry) => {
    const detailed = validateSceneObjectDetailed(entry);
    const object = detailed?.object ?? null;
    if (!object || seen.has(object.id)) {
      droppedObjects += 1;
      return;
    }
    // Phase 6.2: an imported model's geometry lives in the runtime store, which a
    // stored scene cannot carry. Its metadata is valid on its own (the reducer uses
    // `validateSceneObject` to accept a fresh import), but inside a *loaded* scene
    // it is a record that could never be rebuilt, so it is dropped and counted
    // rather than left to fail in the viewer.
    if (object.type === IMPORTED_OBJECT_TYPE) {
      droppedObjects += 1;
      return;
    }
    if (detailed && detailed.normalized.length > 0) {
      normalizations.push({ objectId: object.id, fields: detailed.normalized });
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
    ...(normalizations.length > 0 ? { normalizations } : {}),
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
