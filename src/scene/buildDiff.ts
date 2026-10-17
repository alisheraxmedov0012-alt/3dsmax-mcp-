/**
 * W15.4 — builds the user-facing `SceneEditDiff` from validated operators.
 *
 * `buildDiff` is the second half of the propose/apply split in the plan (§4.5):
 * it turns the operators a provider produced into the single, typed, ordered
 * object the panel shows and the user approves. It does not touch the scene and
 * does not produce reducer actions — `applyDiff` (W15.5) does that, against a
 * fresh scene, so a stale diff cannot be applied by accident.
 *
 * Only `validateSceneOps` output is accepted: the operators go through target
 * resolution and the strict W15.1 validator here, so a caller cannot hand in a
 * pre-approved list that was never checked against this scene.
 */
import {
  CHANGE_KIND_ORDER,
  EDIT_SCHEMA_VERSION,
  type SceneEditChange,
  type SceneEditDiff,
} from './sceneDiff';
import { validateSceneOps, type SceneOpsErrorCode } from './sceneTargets';
import type { SceneData } from './types';

/** Maximum number of provider warnings carried into a diff. */
export const MAX_DIFF_WARNINGS = 10;
export const MAX_WARNING_LENGTH = 300;

export type BuildDiffErrorCode = SceneOpsErrorCode | 'invalid_base_version' | 'duplicate_change';

export interface BuildDiffOptions {
  /**
   * The scene version the operators were computed against.
   *
   * There is deliberately no default. `SceneData` carries no revision today, so
   * this value can only come from the caller (the project version for a saved
   * project, the scene revision once W15.5 introduces one). Substituting `0` or
   * any other placeholder would make a stale diff look current, which is the
   * failure mode the version check exists to prevent.
   */
  baseVersion: number;
  /** Optional provider warnings, shown verbatim next to the preview. */
  warnings?: readonly string[];
}

export interface BuildDiffSuccess {
  ok: true;
  diff: SceneEditDiff;
}

export interface BuildDiffRejection {
  ok: false;
  code: BuildDiffErrorCode;
  /**
   * Index of the offending operator, or `-1` when the problem is not tied to a
   * single operator (a malformed list, a bad `baseVersion`, or two operators
   * whose changes collide). Same convention as W15.1/W15.3.
   */
  index: number;
  message: string;
}

export type BuildDiffResult = BuildDiffSuccess | BuildDiffRejection;

function reject(code: BuildDiffErrorCode, index: number, message: string): BuildDiffRejection {
  return { ok: false, code, index, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Builds the diff the user approves.
 *
 * The result is deterministic: the same scene, operators and options always
 * produce a deep-equal diff, because the changes are re-sorted into the
 * canonical `CHANGE_KIND_ORDER` order and warnings are normalized.
 */
export function buildDiff(
  scene: SceneData,
  rawOps: unknown,
  options: BuildDiffOptions,
): BuildDiffResult {
  const rawOptions: unknown = options;
  if (!isPlainObject(rawOptions)) {
    return reject('invalid_base_version', -1, "baseVersion ko'rsatilishi shart.");
  }

  const baseVersion = rawOptions.baseVersion;
  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 1) {
    return reject(
      'invalid_base_version',
      -1,
      "baseVersion musbat butun son bo'lishi shart; u taxmin qilinmaydi.",
    );
  }

  const warnings = normalizeWarnings(rawOptions.warnings);
  if (!warnings.ok) {
    return reject('invalid_value', -1, warnings.message);
  }

  const validated = validateSceneOps(scene, rawOps);
  if (!validated.ok) {
    return { ok: false, code: validated.code, index: validated.index, message: validated.message };
  }

  const changes = sortChanges(validated.changes);
  const collision = findCollision(changes);
  if (collision !== null) {
    return reject(
      'duplicate_change',
      -1,
      `«${collision}» bir vaqtda ikki xil qiymatga o'zgartirilmoqda; taklifni ajratish kerak.`,
    );
  }

  return {
    ok: true,
    diff: {
      schemaVersion: EDIT_SCHEMA_VERSION,
      objectId: validated.object.id,
      objectType: validated.object.type,
      baseVersion,
      changes,
      warnings: warnings.value,
    },
  };
}

function normalizeWarnings(
  raw: unknown,
): { ok: true; value: string[] } | { ok: false; message: string } {
  if (raw === undefined) {
    return { ok: true, value: [] };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, message: "warnings massiv bo'lishi kerak." };
  }

  const value: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      return { ok: false, message: "warnings faqat satrlardan iborat bo'lishi kerak." };
    }
    const text = entry.trim();
    if (text === '') {
      continue;
    }
    if (text.length > MAX_WARNING_LENGTH) {
      return { ok: false, message: `Ogohlantirish ${MAX_WARNING_LENGTH} belgidan oshmasligi kerak.` };
    }
    if (!value.includes(text)) {
      value.push(text);
    }
  }

  if (value.length > MAX_DIFF_WARNINGS) {
    return { ok: false, message: `Ko'pi bilan ${MAX_DIFF_WARNINGS} ta ogohlantirish bo'lishi mumkin.` };
  }
  return { ok: true, value };
}

/** Canonical order: change kind, then field. Matches W15.1's ordering rules. */
function sortChanges(changes: readonly SceneEditChange[]): SceneEditChange[] {
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

/**
 * Two operators can differ in kind yet write the same displayed field: a
 * `set_params` colour and an `apply_material_preset` that also sets a colour, or
 * `set_material` and `reset_material` on the same channel. W15.1's duplicate
 * check is per operator key and does not catch that overlap, so the flattened
 * change list is checked here — otherwise the approved diff would contain two
 * `after` values for one field and `applyDiff` would have to pick one.
 */
function findCollision(changes: readonly SceneEditChange[]): string | null {
  const seen = new Set<string>();
  for (const change of changes) {
    const key = `${change.kind}:${change.field}`;
    if (seen.has(key)) {
      return change.field;
    }
    seen.add(key);
  }
  return null;
}
