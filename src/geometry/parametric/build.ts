/**
 * Phase 9A.1 — materialise a category-neutral plan.
 *
 * This resolves the definition from the generic registry and delegates to the
 * exact same `PartBuilder` path furniture uses. No geometry code is duplicated,
 * so a new domain inherits material slots, UV policy and disposal unchanged.
 */
import {
  buildPlanWithDefinition,
  type BuildPlanOptions,
  type BuiltPlanFurniture,
} from '../universal/build';
import { requireParametricDefinition } from './registry';
import type { ParametricPlan } from './types';

export function buildParametricPlan(
  plan: ParametricPlan,
  options: BuildPlanOptions = {},
): BuiltPlanFurniture {
  const definition = requireParametricDefinition(plan.definitionId);
  return buildPlanWithDefinition(plan, definition, options);
}
