/**
 * W15.3 — resolves edit targets inside a real scene.
 *
 * W15.1 validates one operator against one object, but it never decides *which*
 * object: the caller supplies it. This module closes that gap. It resolves an
 * `objectId` against `SceneData.objects`, distinguishes the pseudo-ids that are
 * not furniture (the room, an assembly), and then hands the operators to the
 * W15.1 validator.
 *
 * Everything here is read-only. Nothing mutates the scene, and an operator set
 * is either fully valid or rejected with the index of the offending operator.
 */
import {
  DENIED_REDUCER_ACTIONS,
  MAX_OPS_PER_PROPOSAL,
  MAX_OBJECT_ID_LENGTH,
  OBJECT_ID_PATTERN,
  validateOps,
  type AiEditOp,
  type EditOpErrorCode,
  type SceneEditChange,
} from './sceneDiff';
import { ROOM_OBJECT_ID, type SceneData, type SceneObject } from './types';

/** Ids that exist in the UI but never address a furniture object. */
export type SceneLookupErrorCode =
  | 'invalid_object_id'
  | 'unknown_object'
  | 'room_not_editable'
  | 'assembly_not_editable';

export type SceneOpsErrorCode =
  | EditOpErrorCode
  | 'room_not_editable'
  | 'assembly_not_editable'
  | 'multiple_objects';

export interface SceneLookupSuccess {
  ok: true;
  object: SceneObject;
}

export interface SceneLookupRejection {
  ok: false;
  code: SceneLookupErrorCode;
  message: string;
}

export type SceneLookupResult = SceneLookupSuccess | SceneLookupRejection;

export interface SceneOpsAcceptance {
  ok: true;
  /** The single object every operator in the set targets. */
  object: SceneObject;
  ops: AiEditOp[];
  changes: SceneEditChange[];
}

export interface SceneOpsRejection {
  ok: false;
  code: SceneOpsErrorCode;
  /**
   * Index of the offending operator in the input list. `-1` means the list
   * itself was malformed (not an array, empty, or over the limit), matching the
   * W15.1 convention.
   */
  index: number;
  message: string;
}

export type SceneOpsResult = SceneOpsAcceptance | SceneOpsRejection;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectLookup(code: SceneLookupErrorCode, message: string): SceneLookupRejection {
  return { ok: false, code, message };
}

function rejectOps(code: SceneOpsErrorCode, index: number, message: string): SceneOpsRejection {
  return { ok: false, code, index, message };
}

/**
 * Resolves an `objectId` to the furniture object it names.
 *
 * The room and assemblies are rejected with their own codes rather than a
 * generic "not found": both are ids a user can legitimately hold, and telling
 * them "not found" would hide why the edit cannot proceed.
 */
export function resolveEditTarget(scene: SceneData, objectId: unknown): SceneLookupResult {
  if (typeof objectId !== 'string') {
    return rejectLookup('invalid_object_id', "objectId satr bo'lishi kerak.");
  }

  const id = objectId.trim();
  if (id === '' || id.length > MAX_OBJECT_ID_LENGTH || !OBJECT_ID_PATTERN.test(id)) {
    return rejectLookup('invalid_object_id', "objectId formati noto'g'ri.");
  }

  if (id === ROOM_OBJECT_ID) {
    return rejectLookup('room_not_editable', "Xona obyekt emas; uni AI tahriri bilan o'zgartirib bo'lmaydi.");
  }

  // A stored object wins over an assembly with the same id: `validateSceneData`
  // dedupes object ids, so this can only happen with a hand-built scene.
  const object = scene.objects.find((entry) => entry.id === id);
  if (object) {
    return { ok: true, object };
  }

  const assembly = (scene.assemblies ?? []).find((entry) => entry.id === id);
  if (assembly) {
    return rejectLookup(
      'assembly_not_editable',
      "Assembly'ni AI orqali tahrirlash W15 doirasiga kirmaydi.",
    );
  }

  return rejectLookup('unknown_object', "Bunday obyekt sahnada topilmadi.");
}

/**
 * Validates a whole operator set against a scene.
 *
 * Operators are resolved in order, so the reported index is always the earliest
 * offending one. A set may only target one object (plan §1.3: W15 v1 edits a
 * single object); a divergence is reported at the index where it starts.
 */
export function validateSceneOps(scene: SceneData, rawOps: unknown): SceneOpsResult {
  if (!Array.isArray(rawOps)) {
    return rejectOps('invalid_op', -1, "Amallar ro'yxati massiv bo'lishi kerak.");
  }
  if (rawOps.length === 0) {
    return rejectOps('invalid_op', -1, "Bo'sh taklif qabul qilinmaydi.");
  }
  if (rawOps.length > MAX_OPS_PER_PROPOSAL) {
    return rejectOps(
      'invalid_op',
      -1,
      `Bitta taklifda ko'pi bilan ${MAX_OPS_PER_PROPOSAL} amal bo'lishi mumkin.`,
    );
  }

  let target: SceneObject | null = null;

  for (let index = 0; index < rawOps.length; index += 1) {
    const raw = rawOps[index];
    if (!isPlainObject(raw)) {
      return rejectOps('invalid_op', index, "Amal obyekt ko'rinishida bo'lishi kerak.");
    }

    // A reducer action is rejected before any lookup: it names an `id`, not an
    // `objectId`, and W15.1 already refuses the whole shape. Handled here so the
    // reported index points at the offending entry.
    if ('type' in raw) {
      const type = raw.type;
      const denied =
        typeof type === 'string' && (DENIED_REDUCER_ACTIONS as readonly string[]).includes(type);
      return denied
        ? rejectOps('denied_action', index, `«${String(type)}» amali AI tahririda ruxsat etilmagan.`)
        : rejectOps('invalid_op', index, "Reducer action yuborish mumkin emas; faqat DSL amallari.");
    }

    const resolved = resolveEditTarget(scene, raw.objectId);
    if (!resolved.ok) {
      return rejectOps(resolved.code, index, resolved.message);
    }

    if (target === null) {
      target = resolved.object;
    } else if (resolved.object.id !== target.id) {
      return rejectOps(
        'multiple_objects',
        index,
        "Bitta taklif faqat bitta obyektni tahrirlashi mumkin.",
      );
    }
  }

  // `target` cannot be null here: the list is non-empty and every entry resolved.
  const object = target as SceneObject;
  const validated = validateOps(rawOps, object);
  if (!validated.ok) {
    return { ok: false, code: validated.code, index: validated.index, message: validated.message };
  }

  return { ok: true, object, ops: validated.ops, changes: validated.changes };
}
