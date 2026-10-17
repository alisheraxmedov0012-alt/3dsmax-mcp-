/**
 * W15.5 — applies an approved `SceneEditDiff` to a scene.
 *
 * The diff is a *display* structure: a flat list of before/after pairs. This
 * module turns it back into reducer actions, but not by trusting it. The
 * reconstructed operators go through the same `validateSceneOps` gate the
 * proposal went through, and the changes it produces must equal the diff. A
 * diff that does not describe this exact scene — different `before` values,
 * extra or missing fields — is rejected rather than partially applied.
 *
 * That check is also the TOCTOU guard the version comparison alone cannot give:
 * `baseVersion` is supplied by the caller, so two edits can share a version
 * while the scene underneath has already moved.
 *
 * Applying is a replay on a temporary state. The input scene is never written
 * to, and nothing is dispatched — the caller receives the resulting state and
 * decides where it goes.
 */
import {
  FURNITURE_DEFAULTS,
  FURNITURE_FIELDS,
  type FurnitureParams,
  type FurnitureType,
} from '../geometry/furniture';
import { DEFAULT_MATERIAL_ID, DEFAULT_PBR_MATERIAL } from '../materials/types';
import { validateSceneOps, type SceneOpsErrorCode } from './sceneTargets';
import { sceneReducer, type SceneAction } from './sceneReducer';
import {
  EDIT_SCHEMA_VERSION,
  normalizeAngle,
  type AiEditOp,
  type SceneEditChange,
  type SceneEditDiff,
} from './sceneDiff';
import { ROOM_OBJECT_ID, type ObjectMaterial, type SceneObject, type SceneState, type Vec3 } from './types';

/**
 * Validation failures are reported in the vocabulary of the layer that found
 * them: the W15.1/W15.3 codes for an operator that does not survive
 * re-validation, and this module's own codes for the diff/version/apply layer.
 */
export type ApplyDiffErrorCode =
  | SceneOpsErrorCode
  | 'invalid_diff'
  | 'invalid_schema_version'
  | 'invalid_base_version'
  | 'invalid_current_version'
  | 'stale_version'
  | 'stale_content'
  | 'type_mismatch'
  | 'invalid_change'
  | 'duplicate_change'
  | 'reducer_mismatch';

export interface ApplyDiffOptions {
  /**
   * The scene version the caller believes is current. Required: `SceneData`
   * carries no revision, and defaulting this would let a stale diff through.
   */
  currentVersion: number;
}

export interface ApplyDiffSuccess {
  ok: true;
  /** The resulting state. Identical to the input when nothing had to change. */
  state: SceneState;
  /** The actions that were replayed, in application order. Empty for a no-op. */
  actions: SceneAction[];
}

export interface ApplyDiffRejection {
  ok: false;
  code: ApplyDiffErrorCode;
  /** Index into `diff.changes`, or `-1` for a diff-level problem. */
  index: number;
  message: string;
}

export type ApplyDiffResult = ApplyDiffSuccess | ApplyDiffRejection;

const TRANSFORM_AXES = ['x', 'y', 'z'] as const;
const TRANSFORM_GROUPS = ['position', 'rotation', 'scale'] as const;
type TransformGroup = (typeof TRANSFORM_GROUPS)[number];

const MATERIAL_CHANNELS = ['metalness', 'roughness', 'opacity'] as const;
type MaterialChannel = (typeof MATERIAL_CHANNELS)[number];

function reject(code: ApplyDiffErrorCode, index: number, message: string): ApplyDiffRejection {
  return { ok: false, code, index, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * Applies an approved diff.
 *
 * Application order is fixed and independent of the order inside the diff: the
 * material preset first (it rewrites the params colour and the material
 * channels), then params, transform, name and visibility.
 */
export function applyDiff(
  scene: SceneState,
  diff: unknown,
  options: ApplyDiffOptions,
): ApplyDiffResult {
  const parsed = readDiff(diff);
  if (!parsed.ok) {
    return parsed;
  }
  const { diff: proposal } = parsed;

  const rawOptions: unknown = options;
  if (!isPlainObject(rawOptions) || !isPositiveInteger(rawOptions.currentVersion)) {
    return reject(
      'invalid_current_version',
      -1,
      "currentVersion musbat butun son bo'lishi shart; u taxmin qilinmaydi.",
    );
  }
  const currentVersion = rawOptions.currentVersion;

  if (proposal.baseVersion !== currentVersion) {
    return reject(
      'stale_version',
      -1,
      `Taklif ${proposal.baseVersion}-versiyaga asoslangan, joriy versiya ${currentVersion}. Taklifni yangilang.`,
    );
  }

  const object = resolveTarget(scene, proposal.objectId);
  if (!object.ok) {
    return object;
  }
  if (proposal.objectType !== object.object.type) {
    return reject(
      'type_mismatch',
      -1,
      `Taklif «${proposal.objectType}» turi uchun, sahnadagi obyekt esa «${object.object.type}».`,
    );
  }

  const shape = checkChangeShapes(proposal.changes, object.object.type);
  if (!shape.ok) {
    return shape;
  }

  // Idempotency: a diff whose every target value already holds is not an error
  // and must not produce a new state. A partial match means the scene moved on,
  // which is exactly what the version check cannot see.
  const satisfied = proposal.changes.map((change) =>
    sameValue(change, currentValueOf(object.object, change)),
  );
  if (satisfied.every(Boolean)) {
    return { ok: true, state: scene, actions: [] };
  }
  const partialIndex = satisfied.findIndex(Boolean);
  if (partialIndex !== -1) {
    return reject(
      'stale_content',
      partialIndex,
      "Taklif qisman allaqachon qo'llangan; sahna taklif tayyorlangandan keyin o'zgargan.",
    );
  }

  const bound: AiEditOp[] = [];
  for (const op of buildOps(proposal.changes)) {
    bound.push(Object.assign({}, op, { objectId: object.object.id }) as AiEditOp);
  }

  const validated = validateSceneOps(scene.data, bound);
  if (!validated.ok) {
    return { ok: false, code: validated.code, index: validated.index, message: validated.message };
  }

  const mismatch = compareChanges(validated.changes, proposal.changes);
  if (mismatch !== null) {
    return mismatch;
  }

  // `validated.ops` are normalized (angles reduced, colour lower-cased); the
  // raw operators would push an unreduced angle into the reducer, which clamps
  // rather than wraps and would land on a different orientation.
  const actions = toActions(validated.ops, object.object);
  let working = scene;
  for (const action of actions) {
    working = sceneReducer(working, action);
  }

  const applied = working.data.objects.find((entry) => entry.id === object.object.id) ?? null;
  if (applied === null) {
    return reject('reducer_mismatch', -1, "Qo'llashdan keyin obyekt sahnada topilmadi.");
  }

  for (let index = 0; index < proposal.changes.length; index += 1) {
    const change = proposal.changes[index];
    if (!sameValue(change, currentValueOf(applied, change))) {
      return reject(
        'reducer_mismatch',
        index,
        `«${change.field}» kutilgan qiymatga o'zgarmadi; reducer qiymatni rad etgan yoki cheklagan.`,
      );
    }
  }

  return { ok: true, state: working, actions };
}

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

type TargetResult = { ok: true; object: SceneObject } | ApplyDiffRejection;

/**
 * Resolves the diff's target, keeping the room and assemblies distinct from a
 * plain miss so the message says why the edit cannot proceed.
 */
function resolveTarget(scene: SceneState, objectId: string): TargetResult {
  const object = scene.data.objects.find((entry) => entry.id === objectId);
  if (object) {
    return { ok: true, object };
  }
  if (objectId === ROOM_OBJECT_ID) {
    return reject(
      'room_not_editable',
      -1,
      "Xona obyekt emas; uni AI tahriri bilan o'zgartirib bo'lmaydi.",
    );
  }
  if ((scene.data.assemblies ?? []).some((entry) => entry.id === objectId)) {
    return reject(
      'assembly_not_editable',
      -1,
      "Assembly'ni AI orqali tahrirlash W15 doirasiga kirmaydi.",
    );
  }
  return reject('unknown_object', -1, "Bunday obyekt sahnada topilmadi.");
}

// ---------------------------------------------------------------------------
// Diff structure
// ---------------------------------------------------------------------------

type ReadDiffResult = { ok: true; diff: SceneEditDiff } | ApplyDiffRejection;

function readDiff(raw: unknown): ReadDiffResult {
  if (!isPlainObject(raw)) {
    return reject('invalid_diff', -1, "Diff obyekt bo'lishi kerak.");
  }
  if (raw.schemaVersion !== EDIT_SCHEMA_VERSION) {
    return reject(
      'invalid_schema_version',
      -1,
      `Diff sxemasi ${String(raw.schemaVersion)}; kutilgan ${EDIT_SCHEMA_VERSION}.`,
    );
  }
  if (!isPositiveInteger(raw.baseVersion)) {
    return reject('invalid_base_version', -1, "Diff baseVersion musbat butun son bo'lishi shart.");
  }
  if (typeof raw.objectId !== 'string' || raw.objectId.trim() === '') {
    return reject('invalid_object_id', -1, "Diff objectId satr bo'lishi kerak.");
  }
  if (typeof raw.objectType !== 'string') {
    return reject('invalid_diff', -1, "Diff objectType satr bo'lishi kerak.");
  }
  if (!Array.isArray(raw.changes) || raw.changes.length === 0) {
    return reject('invalid_diff', -1, "Diff kamida bitta o'zgarishni ko'rsatishi kerak.");
  }

  const changes: SceneEditChange[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < raw.changes.length; index += 1) {
    const entry = raw.changes[index];
    if (!isPlainObject(entry)) {
      return reject('invalid_change', index, "O'zgarish obyekt bo'lishi kerak.");
    }
    const { kind, field } = entry;
    if (typeof kind !== 'string' || typeof field !== 'string' || field === '') {
      return reject('invalid_change', index, "O'zgarish kind va field maydonlarini talab qiladi.");
    }
    if (!('before' in entry) || !('after' in entry)) {
      return reject('invalid_change', index, "O'zgarish before va after qiymatlarini talab qiladi.");
    }
    const key = `${kind}:${field}`;
    if (seen.has(key)) {
      return reject('duplicate_change', index, `«${field}» ikki marta ko'rsatilgan.`);
    }
    seen.add(key);

    changes.push({
      kind: kind as SceneEditChange['kind'],
      field,
      label: typeof entry.label === 'string' ? entry.label : field,
      unit: entry.unit === 'sm' || entry.unit === 'gradus' ? entry.unit : null,
      before: toScalar(entry.before),
      after: toScalar(entry.after),
    });
  }

  return {
    ok: true,
    diff: {
      schemaVersion: EDIT_SCHEMA_VERSION,
      objectId: raw.objectId.trim(),
      objectType: raw.objectType as FurnitureType,
      baseVersion: raw.baseVersion,
      changes,
      warnings: Array.isArray(raw.warnings)
        ? raw.warnings.filter((entry): entry is string => typeof entry === 'string')
        : [],
    },
  };
}

function toScalar(value: unknown): number | string | boolean | null {
  return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean'
    ? value
    : null;
}

// ---------------------------------------------------------------------------
// Change shape checks
// ---------------------------------------------------------------------------

function allowedParamFields(type: FurnitureType): Set<string> {
  const fields = new Set<string>(FURNITURE_FIELDS[type].map((spec) => spec.key));
  fields.add('color');
  return fields;
}

function isTransformField(field: string): boolean {
  const [group, axis, ...rest] = field.split('.');
  return (
    rest.length === 0 &&
    (TRANSFORM_GROUPS as readonly string[]).includes(group) &&
    (TRANSFORM_AXES as readonly string[]).includes(axis)
  );
}

function checkChangeShapes(
  changes: readonly SceneEditChange[],
  type: FurnitureType,
): ApplyDiffRejection | { ok: true } {
  const params = allowedParamFields(type);

  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    const fail = (message: string) => reject('invalid_change', index, message);

    switch (change.kind) {
      case 'param':
        if (!params.has(change.field)) {
          return fail(`«${change.field}» ${type} turi uchun ruxsat etilgan parametr emas.`);
        }
        if (change.field === 'color') {
          if (typeof change.after !== 'string' || typeof change.before !== 'string') {
            return fail("Rang satr bo'lishi kerak.");
          }
        } else if (!isFiniteNumber(change.after) || !isFiniteNumber(change.before)) {
          return fail(`«${change.field}» uchun chekli son kerak.`);
        }
        break;
      case 'transform':
        if (!isTransformField(change.field)) {
          return fail(`«${change.field}» transform maydoni emas.`);
        }
        if (!isFiniteNumber(change.after) || !isFiniteNumber(change.before)) {
          return fail(`«${change.field}» uchun chekli son kerak.`);
        }
        break;
      case 'name':
        if (
          change.field !== 'name' ||
          typeof change.after !== 'string' ||
          typeof change.before !== 'string'
        ) {
          return fail("Nom o'zgarishi noto'g'ri.");
        }
        break;
      case 'material':
        if (!(MATERIAL_CHANNELS as readonly string[]).includes(change.field)) {
          return fail(`«${change.field}» material kanali emas.`);
        }
        if (!isFiniteNumber(change.after) || !isFiniteNumber(change.before)) {
          return fail(`«${change.field}» uchun chekli son kerak.`);
        }
        break;
      case 'preset':
        if (change.field !== 'materialId' || typeof change.after !== 'string') {
          return fail("Preset o'zgarishi noto'g'ri.");
        }
        break;
      case 'visibility':
        if (
          change.field !== 'visible' ||
          typeof change.after !== 'boolean' ||
          typeof change.before !== 'boolean'
        ) {
          return fail("Ko'rinish o'zgarishi noto'g'ri.");
        }
        break;
      default:
        return reject(
          'invalid_change',
          index,
          `«${String(change.kind)}» amal turi ruxsat etilmagan.`,
        );
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Current values
// ---------------------------------------------------------------------------

/**
 * Reads the value a change refers to. Returns `null` when the value cannot be
 * read, which `sameValue` treats as "different" — never as a match.
 */
function currentValueOf(
  object: SceneObject,
  change: SceneEditChange,
): number | string | boolean | null {
  switch (change.kind) {
    case 'param': {
      const own = (object.params as unknown as Record<string, unknown>)[change.field];
      if (isFiniteNumber(own) || typeof own === 'string') {
        return own;
      }
      // An absent optional channel resolves to the type's default, which is what
      // the builders and `buildDiff` both use.
      const fallback = (FURNITURE_DEFAULTS[object.type] as unknown as Record<string, unknown>)[
        change.field
      ];
      if (isFiniteNumber(fallback) || typeof fallback === 'string') {
        return fallback;
      }
      return null;
    }
    case 'transform': {
      const [group, axis] = change.field.split('.') as [TransformGroup, 'x' | 'y' | 'z'];
      const value = object[group][axis];
      if (!isFiniteNumber(value)) {
        return null;
      }
      return group === 'rotation' ? normalizeAngle(value) : value;
    }
    case 'name':
      return object.name;
    case 'material': {
      const raw = object.material[change.field as MaterialChannel];
      return isFiniteNumber(raw) ? raw : DEFAULT_PBR_MATERIAL[change.field as MaterialChannel];
    }
    case 'preset':
      return object.material.materialId ?? DEFAULT_MATERIAL_ID;
    case 'visibility':
      return object.visible;
  }
}

function sameValue(change: SceneEditChange, value: number | string | boolean | null): boolean {
  if (value === null) {
    return false;
  }
  if (change.kind === 'transform' && change.field.startsWith('rotation.')) {
    return (
      isFiniteNumber(value) &&
      isFiniteNumber(change.after) &&
      normalizeAngle(value) === normalizeAngle(change.after)
    );
  }
  return value === change.after;
}

// ---------------------------------------------------------------------------
// Change list -> operators
// ---------------------------------------------------------------------------

/**
 * Groups the flat change list back into operators.
 *
 * A material preset is special: applying it rewrites the material channels and
 * may set the params colour, so those changes are consequences of the preset and
 * must not be re-issued as separate `set_material`/`set_params` ops — doing so
 * would trip the duplicate-field guard and, worse, leave the final value
 * depending on action order.
 */
function buildOps(changes: readonly SceneEditChange[]): AiEditOp[] {
  const preset = changes.find((change) => change.kind === 'preset');
  const ops: AiEditOp[] = [];

  if (preset) {
    ops.push({ op: 'apply_material_preset', objectId: '', presetId: preset.after as string });
  }

  const explainedByPreset = (change: SceneEditChange): boolean =>
    preset !== undefined &&
    (change.kind === 'material' || (change.kind === 'param' && change.field === 'color'));

  const material: Record<string, number> = {};
  const params: Record<string, number | string> = {};
  const transform: Record<TransformGroup, Record<string, number>> = {
    position: {},
    rotation: {},
    scale: {},
  };
  let name: string | undefined;
  let visible: boolean | undefined;

  for (const change of changes) {
    if (explainedByPreset(change)) {
      continue;
    }
    switch (change.kind) {
      case 'param':
        params[change.field] = change.after as number | string;
        break;
      case 'transform': {
        const [group, axis] = change.field.split('.') as [TransformGroup, 'x' | 'y' | 'z'];
        transform[group][axis] = change.after as number;
        break;
      }
      case 'name':
        name = change.after as string;
        break;
      case 'material':
        material[change.field] = change.after as number;
        break;
      case 'visibility':
        visible = change.after as boolean;
        break;
      case 'preset':
        break;
    }
  }

  if (Object.keys(material).length > 0) {
    ops.push({ op: 'set_material', objectId: '', ...material });
  }
  if (Object.keys(params).length > 0) {
    ops.push({ op: 'set_params', objectId: '', params });
  }
  for (const group of TRANSFORM_GROUPS) {
    if (Object.keys(transform[group]).length === 0) {
      continue;
    }
    const patch: Partial<Vec3> = { ...transform[group] };
    ops.push({ op: 'set_transform', objectId: '', [group]: patch } as AiEditOp);
  }
  if (name !== undefined) {
    ops.push({ op: 'rename', objectId: '', name });
  }
  if (visible !== undefined) {
    ops.push({ op: 'set_visibility', objectId: '', visible });
  }

  return ops;
}

/**
 * Requires the operators' own changes to be exactly the diff's changes. This is
 * what makes `applyDiff` refuse a diff built against a different scene, or
 * edited by hand: `before` values must match, no field may be missing, and no
 * field may be extra. `label` and `unit` are presentational and are not compared.
 */
function compareChanges(
  expected: readonly SceneEditChange[],
  actual: readonly SceneEditChange[],
): ApplyDiffRejection | null {
  const expectedByKey = new Map(expected.map((change) => [keyOf(change), change]));

  if (expectedByKey.size !== actual.length) {
    return reject(
      'stale_content',
      -1,
      "Diff'dagi maydonlar to'plami sahnaga mos emas; taklif eskirgan.",
    );
  }
  for (let index = 0; index < actual.length; index += 1) {
    const want = actual[index];
    const got = expectedByKey.get(keyOf(want));
    if (!got) {
      return reject('stale_content', index, `«${want.field}» sahnaga mos o'zgarish emas.`);
    }
    if (!sameScalar(want, want.before, got.before) || !sameScalar(want, want.after, got.after)) {
      return reject(
        'stale_content',
        index,
        `«${want.field}» uchun kutilgan qiymat sahnadagi holatga mos emas.`,
      );
    }
  }
  return null;
}

function keyOf(change: SceneEditChange): string {
  return `${change.kind}:${change.field}`;
}

/** Rotation compares as an angle; everything else is strict equality. */
function sameScalar(change: SceneEditChange, left: unknown, right: unknown): boolean {
  if (change.kind === 'transform' && change.field.startsWith('rotation.')) {
    return (
      isFiniteNumber(left) && isFiniteNumber(right) && normalizeAngle(left) === normalizeAngle(right)
    );
  }
  return left === right;
}

// ---------------------------------------------------------------------------
// Operators -> reducer actions
// ---------------------------------------------------------------------------

/**
 * Maps the operators to reducer actions in a fixed order.
 *
 * `UPDATE_PARAMS` requires a complete `FurnitureParams`, so the patch is merged
 * over the object's current params; the reducer then re-validates the whole
 * record, and any field it would silently drop is caught by the post-check in
 * `applyDiff`.
 */
function toActions(ops: readonly AiEditOp[], object: SceneObject): SceneAction[] {
  const actions: SceneAction[] = [];
  let params: Record<string, number | string> | null = null;
  let material: Partial<ObjectMaterial> | null = null;
  const transform: {
    position?: Partial<Vec3>;
    rotation?: Partial<Vec3>;
    scale?: Partial<Vec3>;
  } = {};
  let name: string | null = null;
  let visible: boolean | null = null;

  for (const op of ops) {
    switch (op.op) {
      case 'apply_material_preset':
        actions.push({ type: 'APPLY_MATERIAL_PRESET', id: object.id, presetId: op.presetId });
        break;
      case 'set_material': {
        const next: Partial<ObjectMaterial> = material ?? {};
        if (op.metalness !== undefined) {
          next.metalness = op.metalness;
        }
        if (op.roughness !== undefined) {
          next.roughness = op.roughness;
        }
        if (op.opacity !== undefined) {
          next.opacity = op.opacity;
        }
        material = next;
        break;
      }
      case 'set_params':
        params = Object.assign(params ?? {}, op.params);
        break;
      case 'set_transform':
        transform.position = Object.assign(transform.position ?? {}, op.position);
        transform.rotation = Object.assign(transform.rotation ?? {}, op.rotation);
        transform.scale = Object.assign(transform.scale ?? {}, op.scale);
        break;
      case 'rename':
        name = op.name;
        break;
      case 'set_visibility':
        visible = op.visible;
        break;
      case 'reset_material':
        // A flat diff cannot tell a reset from applying the default preset, and
        // `buildOps` maps a preset change to the preset. This arm is defensive.
        actions.push({ type: 'RESET_MATERIAL', id: object.id });
        break;
    }
  }

  if (material && Object.keys(material).length > 0) {
    actions.push({ type: 'UPDATE_MATERIAL', id: object.id, material });
  }
  if (params) {
    const merged = { ...object.params, ...params } as FurnitureParams;
    actions.push({ type: 'UPDATE_PARAMS', id: object.id, params: merged });
  }

  const transformPatch: {
    position?: Partial<Vec3>;
    rotation?: Partial<Vec3>;
    scale?: Partial<Vec3>;
  } = {};
  for (const group of TRANSFORM_GROUPS) {
    const patch = transform[group];
    if (patch && Object.keys(patch).length > 0) {
      transformPatch[group] = patch;
    }
  }
  if (Object.keys(transformPatch).length > 0) {
    actions.push({ type: 'UPDATE_TRANSFORM', id: object.id, ...transformPatch });
  }

  if (name !== null) {
    actions.push({ type: 'RENAME_OBJECT', id: object.id, name });
  }
  if (visible !== null) {
    actions.push({ type: 'SET_VISIBILITY', id: object.id, visible });
  }

  return actions;
}
