/**
 * Stage 3.1 — atomic spec editing (full validation).
 *
 * One call applies a partial patch to an existing spec: merge, parse, solve,
 * validate, canonicalise. The definition owns validation and the Universal Core
 * owns geometry — this module never builds anything itself, and it never returns
 * a half-applied state.
 *
 * This is the only place that runs the full (geometry budget) validation. The
 * reducer only accepts the canonical spec this function returns, so a state
 * transition never materialises geometry.
 */
import { getFurnitureDefinition } from '../../geometry/universal/registry';
import type { PlanIssue } from '../../geometry/universal/types';
import { normalizeSceneSpec, type SceneSpec, type SceneSpecValue } from '../types';
import { checkSpecBuildable } from './buildability';
import { canonicalizeFurnitureSpec, keysFromMessages } from './canonicalSpec';

/** Partial parameter values; every key must be a declared definition field. */
export type SpecPatch = Readonly<Record<string, SceneSpecValue>>;

export type SpecUpdateErrorCode =
  | 'unknown_definition'
  | 'invalid_current_spec'
  | 'invalid_patch'
  | 'unknown_parameter'
  | 'invalid_spec'
  | 'invalid_plan'
  | 'unknown_preset';

export interface SpecUpdateIssue {
  readonly code: SpecUpdateErrorCode;
  readonly message: string;
  /** Parameter keys the issue refers to, when they can be identified. */
  readonly keys?: readonly string[];
}

export type SpecUpdateResult =
  | { readonly ok: true; readonly definitionId: string; readonly spec: SceneSpec }
  | { readonly ok: false; readonly issues: readonly SpecUpdateIssue[] };

function failure(
  code: SpecUpdateErrorCode,
  message: string,
  keys?: readonly string[],
): SpecUpdateResult {
  return { ok: false, issues: [keys ? { code, message, keys } : { code, message }] };
}

function issueWithKeys(
  code: SpecUpdateErrorCode,
  message: string,
  known: ReadonlySet<string>,
): SpecUpdateIssue {
  const keys = keysFromMessages([message], known);
  return keys.length > 0 ? { code, message, keys } : { code, message };
}

function issuesFromPlan(
  issues: readonly PlanIssue[],
  known: ReadonlySet<string>,
): readonly SpecUpdateIssue[] {
  return issues.map((issue) => {
    const code: SpecUpdateErrorCode =
      issue.code === 'invalid_spec' ? 'invalid_spec' : 'invalid_plan';
    return issueWithKeys(code, issue.message, known);
  });
}

/**
 * Applies `patch` to `currentSpec` and returns the new canonical spec.
 *
 * The original spec is never mutated. A patch is applied all-or-nothing: if any
 * channel is unknown, mistyped, out of range or produces an unbuildable plan, the
 * caller gets errors and no new spec.
 */
export function updateFurnitureSpec(
  definitionId: string,
  currentSpec: unknown,
  patch: unknown,
): SpecUpdateResult {
  const definition = getFurnitureDefinition(definitionId.trim());
  if (!definition) {
    return failure('unknown_definition', `Definition "${definitionId}" topilmadi.`);
  }

  const known = new Set(definition.fields.map((field) => field.key));

  const current = canonicalizeFurnitureSpec(definition.id, currentSpec);
  if (!current.ok) {
    return {
      ok: false,
      issues: current.issues.map((issue) =>
        issue.code === 'unknown_definition'
          ? issue
          : { ...issue, code: 'invalid_current_spec' as const },
      ),
    };
  }

  const normalizedPatch = normalizeSceneSpec(patch);
  if (!normalizedPatch) {
    return failure(
      'invalid_patch',
      "Patch obyekt bo'lishi va faqat JSON scalar qiymatlardan iborat bo'lishi kerak.",
    );
  }

  const unknownKeys = Object.keys(normalizedPatch).filter((key) => !known.has(key));
  if (unknownKeys.length > 0) {
    return failure(
      'unknown_parameter',
      `Noma'lum parametr: ${unknownKeys.join(', ')}.`,
      unknownKeys,
    );
  }

  const merged: SceneSpec = { ...current.spec, ...normalizedPatch };
  const buildable = checkSpecBuildable(definition.id, merged);
  if (!buildable.ok) {
    return { ok: false, issues: issuesFromPlan(buildable.issues, known) };
  }

  return { ok: true, definitionId: definition.id, spec: buildable.spec };
}
