/**
 * Stage 2.1a — universal furniture plan vocabulary.
 *
 * A definition describes a furniture variant; `solve()` turns one validated
 * spec into a plan. The plan is pure data (no Three.js objects), reusing the
 * Stage 1 component/connection vocabulary and the Stage 1.1 geometry recipes.
 */
import type { MaterialPresetId } from '../../materials/types';
import type {
  ComponentConnection,
  ComponentDimensions,
  ComponentRole,
  ComponentType,
  ComponentUvMode,
} from '../components';
import type { FurnitureType } from '../furniture/types';
import type { GeometryRecipe, Vec3Tuple } from '../kernel';

export type DefinitionId = string;

export interface NumericRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export type DefinitionFieldKind = 'number' | 'boolean' | 'string';

/** Editable channel metadata. Validation itself stays in the definition parser. */
export interface DefinitionField {
  readonly key: string;
  readonly label: string;
  readonly kind: DefinitionFieldKind;
  readonly range?: NumericRange;
  readonly integer?: boolean;
  readonly hint?: string;
}

/** A material slot the definition can assign to plan parts. */
export interface FurnitureSlot {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly materialId: MaterialPresetId;
  /** PartBuilder group name; also the prefix of the material name. */
  readonly groupName: string;
  /** Optional buyer-facing material name; defaults to `${groupName}-material`. */
  readonly materialName?: string;
}

export interface PlanLimits {
  readonly maxParts: number;
  readonly maxPartVertices: number;
  readonly maxPartTriangles: number;
  readonly maxTotalVertices: number;
}

/**
 * Manufacturing data is never inferred from a non-box geometry. `boxCm` may
 * only describe an axis-aligned rectangular box; `cutFromSheet` marks parts a
 * cut list may treat as sheet stock.
 */
export interface ManufacturingMetadata {
  readonly boxCm?: Vec3Tuple;
  readonly cutFromSheet: boolean;
  /** Component vocabulary tag, not a BOM `PartKind`. */
  readonly partKind?: string;
}

/**
 * Neutral structural part kinds, outside the furniture component vocabulary.
 *
 * 9A.1 keeps the furniture `ComponentType` closed because its factory switches
 * on it. A non-furniture domain (Interior) still needs an honest part kind, so
 * this additive union widens the plan contract without adding anything to
 * `COMPONENT_TYPES` or touching a furniture builder.
 */
export const PARAMETRIC_PART_TYPES = [
  'wall',
  'floor',
  'ceiling',
  'opening',
  'trim',
  'baseboard',
  'crown-molding',
  'column',
  'door-frame',
  'door-leaf',
  'door-handle',
  'window-frame',
  'window-glass',
  'window-sill',
  'mullion',
  'transom',
] as const;

export type ParametricPartType = (typeof PARAMETRIC_PART_TYPES)[number];

/** Any part kind a plan may carry: furniture component or neutral structural. */
export type PlanPartType = ComponentType | ParametricPartType;
export type PlanPartRole = ComponentRole | ParametricPartType;

/** One resolved part. The shape mirrors `ComponentPart`, with a final slot id. */
export interface PlanPart {
  readonly id: string;
  readonly type: PlanPartType;
  readonly role: PlanPartRole;
  readonly dimensions: ComponentDimensions;
  readonly geometry: GeometryRecipe;
  readonly position: Vec3Tuple;
  /** Euler XYZ in degrees, matching the scene convention. */
  readonly rotation: Vec3Tuple;
  readonly materialSlot: string;
  readonly parentId?: string;
  readonly manufacturing?: ManufacturingMetadata;
  readonly notes?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Optional UV policy carried over from the component (e.g. `box`). */
  readonly uv?: ComponentUvMode;
  /**
   * Physical texture tile for the UV mapper, in centimetres. Omitted parts keep
   * the global default, so furniture UVs are unchanged.
   */
  readonly uvTileCm?: number;
}

export interface FurniturePlanDraft {
  readonly parts: readonly PlanPart[];
  readonly connections: readonly ComponentConnection[];
  readonly warnings?: readonly string[];
}

/** A solved draft plus the validated spec it was produced from. */
export interface SolvedFurniturePlan {
  readonly spec: object;
  readonly draft: FurniturePlanDraft;
}

export interface FurniturePlan {
  readonly definitionId: DefinitionId;
  readonly spec: Readonly<object>;
  readonly parts: readonly PlanPart[];
  readonly connections: readonly ComponentConnection[];
  readonly warnings: readonly string[];
}

export type SpecParseResult<S extends object> =
  | { readonly ok: true; readonly spec: S }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * A typed definition. `parseSpec` is the only entry point for untrusted input,
 * so `solve` receives a fully validated spec and never corrects it silently.
 */
export interface FurnitureDefinition<S extends object> {
  readonly id: DefinitionId;
  readonly version: number;
  readonly family: FurnitureType;
  readonly label: string;
  readonly fields: readonly DefinitionField[];
  readonly defaults: Readonly<S>;
  readonly slots: readonly FurnitureSlot[];
  readonly limits: PlanLimits;
  /** Group name of the built root; defaults to `${id}:assembly`. */
  readonly groupName?: string;
  readonly parseSpec: (input: unknown) => SpecParseResult<S>;
  readonly solve: (spec: S) => FurniturePlanDraft;
}

/** The type-erased record the registry stores. No `any` is involved. */
export interface RegisteredFurnitureDefinition {
  readonly id: DefinitionId;
  readonly version: number;
  readonly family: FurnitureType;
  readonly label: string;
  readonly fields: readonly DefinitionField[];
  readonly defaults: Readonly<object>;
  readonly slots: readonly FurnitureSlot[];
  readonly limits: PlanLimits;
  readonly groupName?: string;
  readonly parseSpec: (input: unknown) => SpecParseResult<object>;
  readonly solveSpec: (input: unknown) => SpecParseResult<SolvedFurniturePlan>;
}

export type PlanIssueCode =
  | 'invalid_spec'
  | 'unknown_definition'
  | 'duplicate_part_id'
  | 'duplicate_connection_id'
  | 'missing_parent'
  | 'missing_connection_component'
  | 'missing_connection_hardware'
  | 'non_finite_transform'
  | 'invalid_dimensions'
  | 'invalid_geometry_recipe'
  | 'geometry_budget_exceeded'
  | 'part_budget_exceeded'
  | 'invalid_material_slot'
  | 'invalid_manufacturing';

export interface PlanIssue {
  readonly code: PlanIssueCode;
  readonly message: string;
  readonly partId?: string;
  readonly connectionId?: string;
}

export interface PlanValidationResult {
  readonly valid: boolean;
  readonly errors: readonly PlanIssue[];
}

export type FurniturePlanErrorCode =
  | 'invalid_spec'
  | 'invalid_plan'
  | 'duplicate_definition'
  | 'unknown_definition'
  | 'invalid_definition';

export class FurniturePlanError extends Error {
  readonly code: FurniturePlanErrorCode;
  readonly issues: readonly PlanIssue[];

  constructor(code: FurniturePlanErrorCode, message: string, issues: readonly PlanIssue[] = []) {
    super(message);
    this.name = 'FurniturePlanError';
    this.code = code;
    this.issues = issues;
  }
}
