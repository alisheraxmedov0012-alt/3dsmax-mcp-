/**
 * Phase 9A.1 — category-neutral parametric object contract.
 *
 * The existing `FurnitureDefinition` describes one furniture variant and is
 * keyed by `FurnitureType`. This contract carries the same plan pipeline
 * (parse -> solve -> validate -> build) but names only a free-form `domain`
 * and `family`, so a definition is no longer required to be furniture.
 *
 * The types are structural supersets of the furniture contract: an existing
 * `RegisteredFurnitureDefinition` can be adapted without changing its solver,
 * slots or limits, and a generic plan is assignable wherever a `FurniturePlan`
 * is expected. Nothing here creates geometry; the universal kernel and
 * `PartBuilder` remain the only geometry path.
 */
import type { MaterialPresetId } from '../../materials/types';
import type { ComponentConnection } from '../components';
import type {
  DefinitionField,
  PlanIssue,
  PlanLimits,
  PlanPart,
  SpecParseResult,
} from '../universal/types';

/** The only domain the repository ships in 9A.1. New domains need no code change. */
export const FURNITURE_DOMAIN = 'furniture';

/** Open string identifier, e.g. `furniture`, `interior`, `electronics`. */
export type ParametricDomain = string;

/**
 * A domain identifier is a short lowercase slug. It is deliberately not a
 * closed union: adding a category must be data, not an edit to this module.
 */
export const PARAMETRIC_DOMAIN_ID = /^[a-z][a-z0-9-]*$/;

/** A material slot, independent of the furniture vocabulary. */
export interface ParametricSlot {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly materialId: MaterialPresetId;
  /** PartBuilder group name; also the prefix of the material name. */
  readonly groupName: string;
  /** Optional buyer-facing material name; defaults to `${groupName}-material`. */
  readonly materialName?: string;
}

/** A solved, unvalidated plan draft. Mirrors the furniture draft shape. */
export interface ParametricPlanDraft {
  readonly parts: readonly PlanPart[];
  readonly connections: readonly ComponentConnection[];
  readonly warnings?: readonly string[];
}

/** A solved draft plus the validated spec it was produced from. */
export interface SolvedParametricPlan {
  readonly spec: object;
  readonly draft: ParametricPlanDraft;
}

/** A validated plan with its category/domain attached. */
export interface ParametricPlan {
  readonly definitionId: string;
  readonly domain: ParametricDomain;
  readonly family: string;
  readonly spec: Readonly<object>;
  readonly parts: readonly PlanPart[];
  readonly connections: readonly ComponentConnection[];
  readonly warnings: readonly string[];
}

/**
 * A typed, category-neutral definition.
 *
 * `parseSpec` is the only entry point for untrusted input, so `solve` receives
 * a fully validated spec and never corrects it silently.
 */
export interface ParametricDefinition<S extends object> {
  readonly id: string;
  readonly version: number;
  readonly domain: ParametricDomain;
  /** Domain-specific variant name; the furniture domain uses `FurnitureType`. */
  readonly family: string;
  readonly label: string;
  readonly fields: readonly DefinitionField[];
  readonly defaults: Readonly<S>;
  readonly slots: readonly ParametricSlot[];
  readonly limits: PlanLimits;
  /** Group name of the built root; defaults to `${id}:assembly`. */
  readonly groupName?: string;
  readonly parseSpec: (input: unknown) => SpecParseResult<S>;
  readonly solve: (spec: S) => ParametricPlanDraft;
}

/** The type-erased record the registry stores. No `any` is involved. */
export interface RegisteredParametricDefinition {
  readonly id: string;
  readonly version: number;
  readonly domain: ParametricDomain;
  readonly family: string;
  readonly label: string;
  readonly fields: readonly DefinitionField[];
  readonly defaults: Readonly<object>;
  readonly slots: readonly ParametricSlot[];
  readonly limits: PlanLimits;
  readonly groupName?: string;
  readonly parseSpec: (input: unknown) => SpecParseResult<object>;
  readonly solveSpec: (input: unknown) => SpecParseResult<SolvedParametricPlan>;
}

export type ParametricPlanErrorCode =
  | 'invalid_spec'
  | 'invalid_plan'
  | 'duplicate_definition'
  | 'unknown_definition'
  | 'invalid_definition';

export class ParametricPlanError extends Error {
  readonly code: ParametricPlanErrorCode;
  readonly issues: readonly PlanIssue[];

  constructor(
    code: ParametricPlanErrorCode,
    message: string,
    issues: readonly PlanIssue[] = [],
  ) {
    super(message);
    this.name = 'ParametricPlanError';
    this.code = code;
    this.issues = issues;
  }
}
