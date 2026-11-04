/**
 * Stage 2.1a — plan creation.
 *
 * Parsing, solving and validation happen in one deterministic pipeline. The
 * throwing entry point is for callers that must stop on bad input; the `try*`
 * variant returns the same structured issues without exceptions.
 */
import './definitions';
import { furnitureDefinitions } from './registry';
import { validatePlanDraft } from './validate';
import {
  FurniturePlanError,
  type FurniturePlan,
  type FurniturePlanDraft,
  type PlanIssue,
  type RegisteredFurnitureDefinition,
} from './types';

export type PlanCreationResult =
  | { readonly ok: true; readonly plan: FurniturePlan }
  | { readonly ok: false; readonly issues: readonly PlanIssue[] };

function freezePlan(
  definitionId: string,
  spec: object,
  draft: FurniturePlanDraft,
): FurniturePlan {
  const parts = draft.parts.map((part) => Object.freeze({ ...part }));
  return Object.freeze({
    definitionId,
    spec: Object.freeze({ ...spec }),
    parts: Object.freeze(parts),
    connections: Object.freeze([...draft.connections]),
    warnings: Object.freeze([...(draft.warnings ?? [])]),
  });
}

export function tryCreatePlanFromDefinition(
  definition: RegisteredFurnitureDefinition,
  input: unknown,
): PlanCreationResult {
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
    plan: freezePlan(definition.id, solved.spec.spec, solved.spec.draft),
  };
}

export function createPlanFromDefinition(
  definition: RegisteredFurnitureDefinition,
  input: unknown,
): FurniturePlan {
  const result = tryCreatePlanFromDefinition(definition, input);
  if (!result.ok) {
    const invalidSpec = result.issues.every((entry) => entry.code === 'invalid_spec');
    throw new FurniturePlanError(
      invalidSpec ? 'invalid_spec' : 'invalid_plan',
      result.issues.map((entry) => entry.message).join(' '),
      result.issues,
    );
  }
  return result.plan;
}

export function tryCreateFurniturePlan(
  definitionId: string,
  input: unknown,
): PlanCreationResult {
  const definition = furnitureDefinitions.get(definitionId);
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
  return tryCreatePlanFromDefinition(definition, input);
}

export function createFurniturePlan(
  definitionId: string,
  input: unknown,
): FurniturePlan {
  const definition = furnitureDefinitions.get(definitionId);
  if (!definition) {
    throw new FurniturePlanError(
      'unknown_definition',
      `Definition "${definitionId}" topilmadi.`,
    );
  }
  return createPlanFromDefinition(definition, input);
}
