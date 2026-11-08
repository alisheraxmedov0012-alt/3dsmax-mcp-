/**
 * Phase 9A.1 — category-neutral plan creation.
 *
 * The pipeline is the same one the furniture contract uses: parse untrusted
 * input, solve it, validate every part against the definition's budgets, then
 * freeze the result. The only addition is that the plan records the domain and
 * family, which the scene layer uses to tell furniture from a future category.
 */
import { validatePlanDraft } from '../universal/validate';
import type { PlanIssue } from '../universal/types';
import { parametricDefinitions } from './registry';
import {
  ParametricPlanError,
  type ParametricPlan,
  type ParametricPlanDraft,
  type RegisteredParametricDefinition,
} from './types';

export type ParametricPlanCreationResult =
  | { readonly ok: true; readonly plan: ParametricPlan }
  | { readonly ok: false; readonly issues: readonly PlanIssue[] };

function freezePlan(
  definition: RegisteredParametricDefinition,
  spec: object,
  draft: ParametricPlanDraft,
): ParametricPlan {
  const parts = draft.parts.map((part) => Object.freeze({ ...part }));
  return Object.freeze({
    definitionId: definition.id,
    domain: definition.domain,
    family: definition.family,
    spec: Object.freeze({ ...spec }),
    parts: Object.freeze(parts),
    connections: Object.freeze([...draft.connections]),
    warnings: Object.freeze([...(draft.warnings ?? [])]),
  });
}

export function tryCreateParametricPlanFromDefinition(
  definition: RegisteredParametricDefinition,
  input: unknown,
): ParametricPlanCreationResult {
  const solved = definition.solveSpec(input);
  if (!solved.ok) {
    return {
      ok: false,
      issues: solved.errors.map((message) => ({ code: 'invalid_spec', message })),
    };
  }

  const validation = validatePlanDraft(solved.spec.draft, definition);
  if (!validation.valid) {
    return { ok: false, issues: validation.errors };
  }

  return {
    ok: true,
    plan: freezePlan(definition, solved.spec.spec, solved.spec.draft),
  };
}

export function createParametricPlanFromDefinition(
  definition: RegisteredParametricDefinition,
  input: unknown,
): ParametricPlan {
  const result = tryCreateParametricPlanFromDefinition(definition, input);
  if (!result.ok) {
    const invalidSpec = result.issues.every((entry) => entry.code === 'invalid_spec');
    throw new ParametricPlanError(
      invalidSpec ? 'invalid_spec' : 'invalid_plan',
      result.issues.map((entry) => entry.message).join(' '),
      result.issues,
    );
  }
  return result.plan;
}

export function tryCreateParametricPlan(
  definitionId: string,
  input: unknown,
): ParametricPlanCreationResult {
  const definition = parametricDefinitions.get(definitionId);
  if (!definition) {
    return {
      ok: false,
      issues: [
        {
          code: 'unknown_definition',
          message: `Definition "${definitionId}" topilmadi.`,
        },
      ],
    };
  }
  return tryCreateParametricPlanFromDefinition(definition, input);
}

export function createParametricPlan(
  definitionId: string,
  input: unknown,
): ParametricPlan {
  const definition = parametricDefinitions.get(definitionId);
  if (!definition) {
    throw new ParametricPlanError(
      'unknown_definition',
      `Definition "${definitionId}" topilmadi.`,
    );
  }
  return createParametricPlanFromDefinition(definition, input);
}
