/**
 * W15.1 — strict edit model for AI-driven scene changes.
 *
 * The AI never produces reducer actions and never names an arbitrary JSON path.
 * It may only produce one of the seven operators in {@link EDIT_OPS}, and every
 * operator is validated here before anything is applied. The validation is
 * deliberately stricter than the reducer:
 *
 * - the reducer clamps (`mergeVec3`) and silently drops unusable optional params
 *   (`validateFurnitureParams`), which would turn an AI mistake into a quiet,
 *   unexplained change;
 * - this module rejects the same input instead, so a proposal either applies
 *   exactly as shown to the user or not at all.
 *
 * Nothing in this module mutates a scene, dispatches an action or touches the
 * DOM. It returns normalized operators and the user-visible change list; the
 * apply step (`applyDiff`) is W15.4.
 */
import {
  FURNITURE_DEFAULTS,
  FURNITURE_FIELDS,
  isFurnitureType,
  relationErrors,
  validateFurnitureParams,
  type FurnitureParams,
  type FurnitureType,
} from '../geometry/furniture';
import { MATERIAL_PRESET_IDS, getMaterialPreset } from '../materials/presets';
import { DEFAULT_MATERIAL_ID, DEFAULT_PBR_MATERIAL, PBR_LIMITS } from '../materials/types';
import type { SceneAction } from './sceneReducer';
import {
  MATERIAL_DEFAULTS,
  OBJECT_LIMITS,
  OBJECT_NAME_MAX_LENGTH,
  type ObjectMaterial,
  type SceneObject,
  type Vec3,
} from './types';

/** Version of the operator schema. A proposal carries the version it was built for. */
export const EDIT_SCHEMA_VERSION = 1;

/** Upper bound on operators in one proposal (plan §4.1). */
export const MAX_OPS_PER_PROPOSAL = 8;

/** Object ids come from `createSceneObjectId()`: UUIDs or `obj-*`. */
export const OBJECT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
export const MAX_OBJECT_ID_LENGTH = 64;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** True when the text contains C0 control characters or DEL. */
function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * The closed set of operators the AI may produce — one per allowlisted reducer
 * action (plan §3.2). `TOGGLE_VISIBILITY` is intentionally absent: it is not
 * idempotent, so the DSL uses an explicit target value instead.
 */
export const EDIT_OPS = [
  'set_params',
  'set_transform',
  'rename',
  'set_material',
  'apply_material_preset',
  'reset_material',
  'set_visibility',
] as const;

export type EditOpName = (typeof EDIT_OPS)[number];

export function isEditOpName(value: unknown): value is EditOpName {
  return typeof value === 'string' && (EDIT_OPS as readonly string[]).includes(value);
}

/**
 * Reducer actions the AI may never reach. The list is typed against
 * `SceneAction['type']`, so adding a new reducer action without deciding whether
 * the AI may use it is a compile error.
 *
 * `TOGGLE_VISIBILITY` is denied even though visibility is editable: the DSL's
 * `set_visibility` carries an explicit target instead.
 */
type DeniedActionName = Exclude<
  SceneAction['type'],
  | 'UPDATE_TRANSFORM'
  | 'RENAME_OBJECT'
  | 'UPDATE_PARAMS'
  | 'UPDATE_MATERIAL'
  | 'APPLY_MATERIAL_PRESET'
  | 'RESET_MATERIAL'
>;

export const DENIED_REDUCER_ACTIONS: readonly DeniedActionName[] = [
  'SET_ROOM',
  'SET_LAYOUT',
  'PLACE_AGAINST_WALL',
  'SET_ROOM_CEILING',
  'ADD_ROOM_OPENING',
  'REMOVE_ROOM_OPENING',
  'ADD_TABLE',
  'ADD_FURNITURE',
  'SELECT',
  'TOGGLE_VISIBILITY',
  'DELETE_OBJECT',
  'SET_BACKGROUND',
  'UPDATE_LIGHTS',
  'RESET_LIGHTS',
  'APPLY_LIGHTING_PRESET',
  'UPDATE_ROOM_MATERIALS',
  'SET_CAMERA_PRESET',
  'SET_RENDER_QUALITY',
  'SET_EXPOSURE',
  'SET_TONE_MAPPING',
  'LOAD_SCENE',
  'ADD_ASSEMBLY',
  'DELETE_ASSEMBLY',
  'NEW_SCENE',
];

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

export type EditParamValue = number | string;

export interface SetParamsOp {
  op: 'set_params';
  objectId: string;
  params: Record<string, EditParamValue>;
}

export interface SetTransformOp {
  op: 'set_transform';
  objectId: string;
  position?: Partial<Vec3>;
  rotation?: Partial<Vec3>;
  scale?: Partial<Vec3>;
}

export interface RenameOp {
  op: 'rename';
  objectId: string;
  name: string;
}

export interface SetMaterialOp {
  op: 'set_material';
  objectId: string;
  metalness?: number;
  roughness?: number;
  opacity?: number;
}

export interface ApplyMaterialPresetOp {
  op: 'apply_material_preset';
  objectId: string;
  presetId: string;
}

export interface ResetMaterialOp {
  op: 'reset_material';
  objectId: string;
}

export interface SetVisibilityOp {
  op: 'set_visibility';
  objectId: string;
  visible: boolean;
}

export type AiEditOp =
  | SetParamsOp
  | SetTransformOp
  | RenameOp
  | SetMaterialOp
  | ApplyMaterialPresetOp
  | ResetMaterialOp
  | SetVisibilityOp;

// ---------------------------------------------------------------------------
// Diff shapes (consumed by the panel; built by W15.3)
// ---------------------------------------------------------------------------

export type SceneEditChangeKind = 'param' | 'transform' | 'name' | 'material' | 'preset' | 'visibility';

export const CHANGE_KIND_ORDER: readonly SceneEditChangeKind[] = [
  'param',
  'transform',
  'name',
  'material',
  'preset',
  'visibility',
];

export interface SceneEditChange {
  kind: SceneEditChangeKind;
  /** Stable field key used for deterministic ordering, e.g. `widthCm`. */
  field: string;
  /** Uzbek label for the panel. */
  label: string;
  unit: 'sm' | 'gradus' | null;
  before: number | string | boolean | null;
  after: number | string | boolean | null;
}

export interface SceneEditDiff {
  schemaVersion: number;
  objectId: string;
  objectType: FurnitureType;
  baseVersion: number;
  changes: SceneEditChange[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Validation results
// ---------------------------------------------------------------------------

export type EditOpErrorCode =
  | 'invalid_op'
  | 'denied_action'
  | 'out_of_scope'
  | 'unknown_field'
  | 'invalid_object_id'
  | 'unknown_object'
  | 'invalid_value'
  | 'out_of_range'
  | 'relation_violation'
  | 'invalid_preset'
  | 'no_change'
  | 'duplicate_op';

export interface EditOpRejection {
  ok: false;
  code: EditOpErrorCode;
  message: string;
}

export interface EditOpAcceptance {
  ok: true;
  /** Normalized operator (angles reduced, colour lower-cased, name trimmed). */
  op: AiEditOp;
  changes: SceneEditChange[];
}

export type EditOpValidation = EditOpAcceptance | EditOpRejection;

export interface EditOpsRejection extends EditOpRejection {
  /** Index of the offending operator in the input list. */
  index: number;
}

export interface EditOpsAcceptance {
  ok: true;
  ops: AiEditOp[];
  changes: SceneEditChange[];
}

export type EditOpsValidation = EditOpsAcceptance | EditOpsRejection;

function reject(code: EditOpErrorCode, message: string): EditOpRejection {
  return { ok: false, code, message };
}

// ---------------------------------------------------------------------------
// Small readers — every one rejects instead of coercing
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Accepts only real, finite numbers. Booleans and numeric strings are rejected. */
function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Reduces an angle to [0, 360). 370 -> 10, -10 -> 350, 360 -> 0.
 *
 * The viewer applies Euler XYZ degrees to Three.js unchanged
 * (`buildSceneObject.ts:20`), so a full turn is the same orientation; clamping
 * (what the reducer does) would silently pick a different angle instead.
 */
export function normalizeAngle(degrees: number): number {
  const wrapped = ((degrees % 360) + 360) % 360;
  // -0 and 0 must serialize identically.
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

function sameAngle(a: number, b: number): boolean {
  return normalizeAngle(a) === normalizeAngle(b);
}

// ---------------------------------------------------------------------------
// Operator validation
// ---------------------------------------------------------------------------

const OP_KEYS: Record<EditOpName, readonly string[]> = {
  set_params: ['op', 'objectId', 'params'],
  set_transform: ['op', 'objectId', 'position', 'rotation', 'scale'],
  rename: ['op', 'objectId', 'name'],
  // `materialId`, `textureScale` and `normalStrength` are recognised so the
  // validator can answer "out of scope" instead of "unknown field" (D-W15-7).
  set_material: ['op', 'objectId', 'metalness', 'roughness', 'opacity', 'materialId', 'textureScale', 'normalStrength'],
  apply_material_preset: ['op', 'objectId', 'presetId'],
  reset_material: ['op', 'objectId'],
  set_visibility: ['op', 'objectId', 'visible'],
};

/**
 * Validates one operator against the object it targets.
 *
 * `object` supplies the type, the current values (for `no_change` detection) and
 * the identity check — an operator can only ever address the object it was
 * validated for, which closes the id-tampering path.
 */
export function validateOp(raw: unknown, object: SceneObject): EditOpValidation {
  if (!isPlainObject(raw)) {
    return reject('invalid_op', "Amal obyekt ko'rinishida bo'lishi kerak.");
  }

  // A reducer action is never accepted, even if its shape happens to overlap.
  if ('type' in raw) {
    const type = raw.type;
    if (typeof type === 'string' && (DENIED_REDUCER_ACTIONS as readonly string[]).includes(type)) {
      return reject('denied_action', `«${type}» amali AI tahririda ruxsat etilmagan.`);
    }
    return reject('invalid_op', "Reducer action yuborish mumkin emas; faqat DSL amallari.");
  }

  if ('assemblyId' in object) {
    return reject('out_of_scope', "Assembly qismlarini AI orqali tahrirlash W15 doirasiga kirmaydi.");
  }
  if (!isFurnitureType(object.type)) {
    return reject('out_of_scope', "Obyekt turi AI tahririni qo'llab-quvvatlamaydi.");
  }

  const name = raw.op;
  if (!isEditOpName(name)) {
    if (typeof name === 'string' && (DENIED_REDUCER_ACTIONS as readonly string[]).includes(name)) {
      return reject('denied_action', `«${name}» amali AI tahririda ruxsat etilmagan.`);
    }
    return reject('invalid_op', "Noma'lum amal. Faqat allowlist'dagi DSL amallari qabul qilinadi.");
  }

  const unknownKey = Object.keys(raw).find((key) => !OP_KEYS[name].includes(key));
  if (unknownKey !== undefined) {
    return reject('unknown_field', `«${unknownKey}» maydoni bu amal uchun ruxsat etilmagan.`);
  }

  const id = raw.objectId;
  if (typeof id !== 'string') {
    return reject('invalid_object_id', "objectId satr bo'lishi kerak.");
  }
  const trimmedId = id.trim();
  if (
    trimmedId === '' ||
    trimmedId.length > MAX_OBJECT_ID_LENGTH ||
    !OBJECT_ID_PATTERN.test(trimmedId)
  ) {
    return reject('invalid_object_id', "objectId formati noto'g'ri.");
  }
  if (trimmedId !== object.id) {
    return reject('unknown_object', "objectId tekshirilayotgan obyektga mos kelmaydi.");
  }

  switch (name) {
    case 'set_params':
      return validateSetParams(raw.params, object);
    case 'set_transform':
      return validateSetTransform(raw, object);
    case 'rename':
      return validateRename(raw.name, object);
    case 'set_material':
      return validateSetMaterial(raw, object);
    case 'apply_material_preset':
      return validateApplyPreset(raw.presetId, object);
    case 'reset_material':
      return validateResetMaterial(object);
    case 'set_visibility':
      return validateSetVisibility(raw.visible, object);
  }
}

/**
 * Validates a whole proposal atomically: the first rejection aborts everything,
 * so a partially valid list can never be applied.
 *
 * Two operators may not write the same field of the same object — that would
 * make the resulting value depend on order and hide one of the two intents.
 */
export function validateOps(raw: unknown, object: SceneObject): EditOpsValidation {
  if (!Array.isArray(raw)) {
    return { ...reject('invalid_op', "Amallar ro'yxati massiv bo'lishi kerak."), index: -1 };
  }
  if (raw.length === 0) {
    return { ...reject('invalid_op', "Bo'sh taklif qabul qilinmaydi."), index: -1 };
  }
  if (raw.length > MAX_OPS_PER_PROPOSAL) {
    return {
      ...reject('invalid_op', `Bitta taklifda ko'pi bilan ${MAX_OPS_PER_PROPOSAL} amal bo'lishi mumkin.`),
      index: -1,
    };
  }

  const ops: AiEditOp[] = [];
  const changes: SceneEditChange[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < raw.length; index += 1) {
    const result = validateOp(raw[index], object);
    if (!result.ok) {
      return { ...result, index };
    }
    for (const key of opFieldKeys(result.op)) {
      if (seen.has(key)) {
        return { ...reject('duplicate_op', `«${key}» maydoni taklifda ikki marta o'zgartirilgan.`), index };
      }
      seen.add(key);
    }
    ops.push(result.op);
    changes.push(...result.changes);
  }

  return { ok: true, ops, changes: sortChanges(changes) };
}

function opFieldKeys(op: AiEditOp): string[] {
  switch (op.op) {
    case 'set_params':
      return Object.keys(op.params).map((key) => `${op.objectId}:param:${key}`);
    case 'set_transform': {
      const keys: string[] = [];
      for (const group of ['position', 'rotation', 'scale'] as const) {
        const axis = op[group];
        if (axis) {
          for (const key of Object.keys(axis)) {
            keys.push(`${op.objectId}:${group}:${key}`);
          }
        }
      }
      return keys;
    }
    case 'set_material':
      return (['metalness', 'roughness', 'opacity'] as const)
        .filter((key) => op[key] !== undefined)
        .map((key) => `${op.objectId}:material:${key}`);
    case 'rename':
      return [`${op.objectId}:name`];
    case 'apply_material_preset':
      return [`${op.objectId}:preset`];
    case 'reset_material':
      return [`${op.objectId}:preset`];
    case 'set_visibility':
      return [`${op.objectId}:visibility`];
  }
}

function sortChanges(changes: SceneEditChange[]): SceneEditChange[] {
  return [...changes].sort((a, b) => {
    const kind = CHANGE_KIND_ORDER.indexOf(a.kind) - CHANGE_KIND_ORDER.indexOf(b.kind);
    if (kind !== 0) {
      return kind;
    }
    if (a.field === b.field) {
      return 0;
    }
    return a.field < b.field ? -1 : 1;
  });
}

function accepted(op: AiEditOp, changes: SceneEditChange[]): EditOpValidation {
  if (changes.length === 0) {
    return reject('no_change', "Taklif sahnani o'zgartirmaydi.");
  }
  return { ok: true, op, changes: sortChanges(changes) };
}

// ---------------------------------------------------------------------------
// set_params
// ---------------------------------------------------------------------------

const PARAM_LABELS: Record<string, string> = (() => {
  const labels: Record<string, string> = { color: 'Rang' };
  for (const specs of Object.values(FURNITURE_FIELDS)) {
    for (const spec of specs) {
      labels[spec.key] = spec.label;
    }
  }
  return labels;
})();

function validateSetParams(rawParams: unknown, object: SceneObject): EditOpValidation {
  if (!isPlainObject(rawParams)) {
    return reject('invalid_op', "params obyekt bo'lishi kerak.");
  }

  const entries = Object.entries(rawParams);
  if (entries.length === 0) {
    return reject('invalid_op', "params bo'sh bo'lishi mumkin emas.");
  }

  const specs = FURNITURE_FIELDS[object.type];
  const allowed = new Set<string>(specs.map((spec) => spec.key));
  allowed.add('color');

  const next: Record<string, EditParamValue> = {};
  for (const [key, value] of entries) {
    if (!allowed.has(key)) {
      return reject(
        'unknown_field',
        `«${key}» ${object.type} turi uchun ruxsat etilgan parametr emas.`,
      );
    }

    if (key === 'color') {
      if (typeof value !== 'string' || !HEX_COLOR.test(value.trim())) {
        return reject('invalid_value', "Rang #RRGGBB ko'rinishida bo'lishi kerak.");
      }
      next.color = value.trim().toLowerCase();
      continue;
    }

    const spec = specs.find((entry) => entry.key === key);
    if (!spec) {
      return reject('unknown_field', `«${key}» parametri topilmadi.`);
    }
    const numeric = readNumber(value);
    if (numeric === null) {
      return reject('invalid_value', `«${spec.label}» uchun chekli son kerak.`);
    }
    if (spec.integer && !Number.isInteger(numeric)) {
      return reject('invalid_value', `«${spec.label}» butun son bo'lishi kerak.`);
    }
    if (numeric < spec.range.min || numeric > spec.range.max) {
      return reject(
        'out_of_range',
        `«${spec.label}» ${spec.range.min}–${spec.range.max} oralig'ida bo'lishi kerak.`,
      );
    }
    next[key] = numeric;
  }

  const merged: FurnitureParams = { ...object.params, ...next } as FurnitureParams;

  // Cross-field rules (seat height vs total height, wall thickness vs depth, ...).
  const relation = relationErrors(object.type, merged);
  const relationKey = Object.keys(relation)[0];
  if (relationKey !== undefined) {
    return reject('relation_violation', relation[relationKey as keyof typeof relation] as string);
  }
  if (validateFurnitureParams(object.type, merged) === null) {
    return reject('invalid_value', "Parametrlar birgalikda yaroqsiz.");
  }

  const changes: SceneEditChange[] = [];
  for (const [key, value] of Object.entries(next)) {
    const before = readCurrentParam(object, key);
    if (valuesEqual(before, value)) {
      continue;
    }
    changes.push({
      kind: 'param',
      field: key,
      label: PARAM_LABELS[key] ?? key,
      unit: key === 'color' ? null : 'sm',
      before,
      after: value,
    });
  }

  return accepted({ op: 'set_params', objectId: object.id, params: next }, changes);
}

/**
 * Reads the value a param currently has, resolving an absent optional channel to
 * the per-type default the builders fall back to. Without that, proposing the
 * default value would look like a change.
 */
function readCurrentParam(object: SceneObject, key: string): number | string | null {
  const value = (object.params as unknown as Record<string, unknown>)[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return value;
  }
  const fallback = (FURNITURE_DEFAULTS[object.type] as unknown as Record<string, unknown>)[key];
  if (typeof fallback === 'number' && Number.isFinite(fallback)) {
    return fallback;
  }
  if (typeof fallback === 'string') {
    return fallback;
  }
  return null;
}

function valuesEqual(before: number | string | null, after: number | string): boolean {
  return before === after;
}

// ---------------------------------------------------------------------------
// set_transform
// ---------------------------------------------------------------------------

const AXES = ['x', 'y', 'z'] as const;
const TRANSFORM_GROUPS = ['position', 'rotation', 'scale'] as const;
type TransformGroup = (typeof TRANSFORM_GROUPS)[number];

const GROUP_LABELS: Record<TransformGroup, string> = {
  position: "O'rni",
  rotation: 'Burilish',
  scale: "Masshtab",
};

function validateSetTransform(raw: Record<string, unknown>, object: SceneObject): EditOpValidation {
  const op: SetTransformOp = { op: 'set_transform', objectId: object.id };
  const changes: SceneEditChange[] = [];

  for (const group of TRANSFORM_GROUPS) {
    const source = raw[group];
    if (source === undefined) {
      continue;
    }
    if (!isPlainObject(source)) {
      return reject('invalid_op', `«${GROUP_LABELS[group]}» obyekt bo'lishi kerak.`);
    }
    const unknownAxis = Object.keys(source).find(
      (key) => !(AXES as readonly string[]).includes(key),
    );
    if (unknownAxis !== undefined) {
      return reject('unknown_field', `«${unknownAxis}» o'qi mavjud emas (x, y, z).`);
    }

    const patch: Partial<Vec3> = {};
    for (const axis of AXES) {
      const rawValue = source[axis];
      if (rawValue === undefined) {
        continue;
      }
      const numeric = readNumber(rawValue);
      if (numeric === null) {
        return reject('invalid_value', `«${GROUP_LABELS[group]} ${axis}» uchun chekli son kerak.`);
      }

      const normalized = validateAxisValue(group, axis, numeric);
      if (typeof normalized !== 'number') {
        return normalized;
      }
      patch[axis] = normalized;

      const current = object[group][axis];
      const changed = group === 'rotation' ? !sameAngle(current, normalized) : current !== normalized;
      if (changed) {
        changes.push({
          kind: 'transform',
          field: `${group}.${axis}`,
          label: `${GROUP_LABELS[group]} ${axis}`,
          unit: group === 'scale' ? null : group === 'rotation' ? 'gradus' : 'sm',
          before: group === 'rotation' ? normalizeAngle(current) : current,
          after: normalized,
        });
      }
    }

    if (Object.keys(patch).length === 0) {
      return reject('invalid_op', `«${GROUP_LABELS[group]}» bo'sh bo'lishi mumkin emas.`);
    }
    op[group] = patch;
  }

  if (op.position === undefined && op.rotation === undefined && op.scale === undefined) {
    return reject('invalid_op', "set_transform kamida bitta guruhni ko'rsatishi kerak.");
  }

  return accepted(op, changes);
}

function validateAxisValue(
  group: TransformGroup,
  axis: 'x' | 'y' | 'z',
  value: number,
): number | EditOpRejection {
  if (group === 'rotation') {
    // Any finite angle is meaningful once reduced to a full turn.
    return normalizeAngle(value);
  }

  const range = group === 'position' ? OBJECT_LIMITS.position : OBJECT_LIMITS.scale;
  if (value < range.min || value > range.max) {
    return reject(
      'out_of_range',
      `«${GROUP_LABELS[group]} ${axis}» ${range.min}–${range.max} oralig'ida bo'lishi kerak.`,
    );
  }

  // Objects stand on the floor (see the coordinate convention in `scene/types.ts`);
  // the stored limits still allow negative Y, but an AI edit must not sink one.
  if (group === 'position' && axis === 'y' && value < 0) {
    return reject('out_of_range', "Obyekt pol ostiga tushirilmaydi (y ≥ 0).");
  }

  return value;
}

// ---------------------------------------------------------------------------
// rename
// ---------------------------------------------------------------------------

function validateRename(rawName: unknown, object: SceneObject): EditOpValidation {
  if (typeof rawName !== 'string') {
    return reject('invalid_value', "Nom satr bo'lishi kerak.");
  }
  const name = rawName.trim();
  if (name === '') {
    return reject('invalid_value', "Nom bo'sh bo'lishi mumkin emas.");
  }
  if (name.length > OBJECT_NAME_MAX_LENGTH) {
    return reject('invalid_value', `Nom ${OBJECT_NAME_MAX_LENGTH} belgidan oshmasligi kerak.`);
  }
  if (hasControlChars(name)) {
    return reject('invalid_value', "Nomda boshqaruv belgilari bo'lmasligi kerak.");
  }

  const changes: SceneEditChange[] =
    name === object.name
      ? []
      : [{ kind: 'name', field: 'name', label: 'Nom', unit: null, before: object.name, after: name }];

  return accepted({ op: 'rename', objectId: object.id, name }, changes);
}

// ---------------------------------------------------------------------------
// set_material
// ---------------------------------------------------------------------------

const MATERIAL_CHANNELS = ['metalness', 'roughness', 'opacity'] as const;
type MaterialChannel = (typeof MATERIAL_CHANNELS)[number];

/** Channels that exist in the model but are out of the W15 v1 scope (D-W15-7). */
const MATERIAL_OUT_OF_SCOPE = ['materialId', 'textureScale', 'normalStrength'];

const MATERIAL_LABELS: Record<MaterialChannel, string> = {
  metalness: 'Metallik',
  roughness: "G'adir-budurlik",
  opacity: 'Shaffoflik',
};

function validateSetMaterial(
  raw: Record<string, unknown>,
  object: SceneObject,
): EditOpValidation {
  const op: SetMaterialOp = { op: 'set_material', objectId: object.id };
  const changes: SceneEditChange[] = [];

  for (const key of MATERIAL_OUT_OF_SCOPE) {
    if (key in raw) {
      return reject(
        'out_of_scope',
        `«${key}» W15 v1 doirasiga kirmaydi; material preset orqali o'zgartiriladi.`,
      );
    }
  }

  for (const channel of MATERIAL_CHANNELS) {
    const rawValue = raw[channel];
    if (rawValue === undefined) {
      continue;
    }
    const numeric = readNumber(rawValue);
    if (numeric === null) {
      return reject('invalid_value', `«${MATERIAL_LABELS[channel]}» uchun chekli son kerak.`);
    }
    const range = PBR_LIMITS[channel];
    if (numeric < range.min || numeric > range.max) {
      return reject(
        'out_of_range',
        `«${MATERIAL_LABELS[channel]}» ${range.min}–${range.max} oralig'ida bo'lishi kerak.`,
      );
    }
    op[channel] = numeric;

    const before = currentMaterialValue(object.material, channel);
    if (before !== numeric) {
      changes.push({
        kind: 'material',
        field: channel,
        label: MATERIAL_LABELS[channel],
        unit: null,
        before,
        after: numeric,
      });
    }
  }

  if (
    op.metalness === undefined &&
    op.roughness === undefined &&
    op.opacity === undefined
  ) {
    return reject('invalid_op', "set_material kamida bitta kanalni ko'rsatishi kerak.");
  }

  return accepted(op, changes);
}

function currentMaterialValue(material: ObjectMaterial, channel: MaterialChannel): number {
  const value = material[channel];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return DEFAULT_PBR_MATERIAL[channel];
}

function currentMaterialId(material: ObjectMaterial): string {
  return typeof material.materialId === 'string' ? material.materialId : DEFAULT_MATERIAL_ID;
}

// ---------------------------------------------------------------------------
// apply_material_preset / reset_material
// ---------------------------------------------------------------------------

function validateApplyPreset(rawPresetId: unknown, object: SceneObject): EditOpValidation {
  if (typeof rawPresetId !== 'string' || !MATERIAL_PRESET_IDS.has(rawPresetId)) {
    return reject('invalid_preset', "Material preseti mavjud emas.");
  }

  const preset = getMaterialPreset(rawPresetId);
  const changes: SceneEditChange[] = [];

  if (currentMaterialId(object.material) !== preset.id) {
    changes.push({
      kind: 'preset',
      field: 'materialId',
      label: 'Material',
      unit: null,
      before: currentMaterialId(object.material),
      after: preset.id,
    });
  }
  for (const channel of MATERIAL_CHANNELS) {
    const before = currentMaterialValue(object.material, channel);
    const after = preset[channel];
    if (before !== after) {
      changes.push({
        kind: 'material',
        field: channel,
        label: MATERIAL_LABELS[channel],
        unit: null,
        before,
        after,
      });
    }
  }
  // A preset may also set the base colour (see APPLY_MATERIAL_PRESET in the reducer).
  if (preset.color !== null && object.params.color !== preset.color) {
    changes.push({
      kind: 'param',
      field: 'color',
      label: PARAM_LABELS.color as string,
      unit: null,
      before: object.params.color,
      after: preset.color,
    });
  }

  return accepted({ op: 'apply_material_preset', objectId: object.id, presetId: preset.id }, changes);
}

function validateResetMaterial(object: SceneObject): EditOpValidation {
  const changes: SceneEditChange[] = [];

  for (const channel of ['metalness', 'roughness'] as const) {
    const before = currentMaterialValue(object.material, channel);
    const after = MATERIAL_DEFAULTS[channel];
    if (before !== after) {
      changes.push({
        kind: 'material',
        field: channel,
        label: MATERIAL_LABELS[channel],
        unit: null,
        before,
        after,
      });
    }
  }

  // RESET_MATERIAL replaces the record with MATERIAL_DEFAULTS, dropping the
  // PBR extras, so their resolved values return to the model defaults.
  const dropped: readonly [string, MaterialChannel | 'materialId'][] = [
    ['materialId', 'materialId'],
    ['opacity', 'opacity'],
  ];
  for (const [field, channel] of dropped) {
    const before =
      channel === 'materialId' ? currentMaterialId(object.material) : currentMaterialValue(object.material, channel);
    const after =
      channel === 'materialId' ? DEFAULT_MATERIAL_ID : DEFAULT_PBR_MATERIAL[channel];
    if (before !== after) {
      changes.push({
        kind: channel === 'materialId' ? 'preset' : 'material',
        field,
        label: channel === 'materialId' ? 'Material' : MATERIAL_LABELS.opacity,
        unit: null,
        before,
        after,
      });
    }
  }

  return accepted({ op: 'reset_material', objectId: object.id }, changes);
}

// ---------------------------------------------------------------------------
// set_visibility
// ---------------------------------------------------------------------------

function validateSetVisibility(rawVisible: unknown, object: SceneObject): EditOpValidation {
  if (typeof rawVisible !== 'boolean') {
    return reject('invalid_value', "visible faqat true yoki false bo'lishi kerak.");
  }
  const changes: SceneEditChange[] =
    rawVisible === object.visible
      ? []
      : [
          {
            kind: 'visibility',
            field: 'visible',
            label: "Ko'rinish",
            unit: null,
            before: object.visible,
            after: rawVisible,
          },
        ];

  return accepted({ op: 'set_visibility', objectId: object.id, visible: rawVisible }, changes);
}
