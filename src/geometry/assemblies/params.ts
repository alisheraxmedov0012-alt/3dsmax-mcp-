/**
 * W14 — parameter schemas for the four assemblies.
 *
 * Each assembly has a small, closed set of numeric channels plus a colour. The
 * shape mirrors the furniture parameter layer (`FURNITURE_FIELDS` /
 * `FURNITURE_DEFAULTS` in `src/geometry/furniture/types.ts`) so the same habits
 * apply: a declared range per channel, a default per kind, and a validator that
 * returns `null` rather than a half-valid object.
 *
 * Validation is deliberately shallow here — it checks presence, type and range.
 * Cross-part consistency (sums, adjacency, containment) belongs to the
 * constraint layer (`constraints.ts`) so each rule has exactly one home.
 */
import type { AssemblyKind } from '../../scene/types';
import { AssemblyError } from './limits';

export interface NumericRange {
  min: number;
  max: number;
  step: number;
  integer?: boolean;
}

const R = (min: number, max: number, step = 1, integer = false): NumericRange => ({
  min,
  max,
  step,
  integer,
});

/** Shared channels every assembly understands. */
export interface BaseAssemblyParams {
  color: string;
}

export interface KitchenBaseRunParams extends BaseAssemblyParams {
  moduleCount: number;
  moduleWidthCm: number;
  heightCm: number;
  depthCm: number;
  plinthHeightCm: number;
}

export interface WallCabinetParams extends BaseAssemblyParams {
  widthCm: number;
  heightCm: number;
  depthCm: number;
  doorCount: number;
  mountHeightCm: number;
}

export interface WardrobeSectionParams extends BaseAssemblyParams {
  widthCm: number;
  heightCm: number;
  depthCm: number;
  sectionCount: number;
  shelfCountPerSection: number;
  doorCount: number;
}

export interface StairStraightParams extends BaseAssemblyParams {
  stepCount: number;
  stepWidthCm: number;
  stepDepthCm: number;
  riseCm: number;
  stringerThicknessCm: number;
}

export type AssemblyParamsByKind = {
  'kitchen-base-run': KitchenBaseRunParams;
  'wall-cabinet': WallCabinetParams;
  'wardrobe-section': WardrobeSectionParams;
  'stair-straight': StairStraightParams;
};

export type AssemblyParams = AssemblyParamsByKind[AssemblyKind];

const DEFAULT_COLOR = '#a9744f';

/** Editable channels per kind, with their ranges. Also the validation schema. */
export const ASSEMBLY_FIELDS: {
  [K in AssemblyKind]: Record<Exclude<keyof AssemblyParamsByKind[K], 'color'>, NumericRange>;
} = {
  'kitchen-base-run': {
    moduleCount: R(2, 4, 1, true),
    moduleWidthCm: R(40, 90, 5),
    heightCm: R(70, 95, 1),
    depthCm: R(45, 65, 1),
    plinthHeightCm: R(0, 20, 1),
  },
  'wall-cabinet': {
    widthCm: R(40, 120, 5),
    heightCm: R(40, 100, 5),
    depthCm: R(25, 40, 1),
    doorCount: R(1, 3, 1, true),
    mountHeightCm: R(120, 180, 5),
  },
  'wardrobe-section': {
    widthCm: R(60, 240, 5),
    heightCm: R(150, 260, 5),
    depthCm: R(40, 70, 1),
    sectionCount: R(1, 4, 1, true),
    shelfCountPerSection: R(0, 6, 1, true),
    doorCount: R(0, 4, 1, true),
  },
  'stair-straight': {
    stepCount: R(6, 16, 1, true),
    stepWidthCm: R(70, 120, 5),
    stepDepthCm: R(22, 32, 1),
    riseCm: R(15, 20, 0.5),
    stringerThicknessCm: R(3, 8, 0.5),
  },
} as const;

export const ASSEMBLY_DEFAULTS: { [K in AssemblyKind]: AssemblyParamsByKind[K] } = {
  'kitchen-base-run': {
    moduleCount: 3,
    moduleWidthCm: 60,
    heightCm: 85,
    depthCm: 60,
    plinthHeightCm: 10,
    color: DEFAULT_COLOR,
  },
  'wall-cabinet': {
    widthCm: 80,
    heightCm: 70,
    depthCm: 32,
    doorCount: 2,
    mountHeightCm: 145,
    color: DEFAULT_COLOR,
  },
  'wardrobe-section': {
    widthCm: 180,
    heightCm: 220,
    depthCm: 60,
    sectionCount: 2,
    shelfCountPerSection: 3,
    doorCount: 2,
    color: DEFAULT_COLOR,
  },
  'stair-straight': {
    stepCount: 12,
    stepWidthCm: 100,
    stepDepthCm: 28,
    riseCm: 17.5,
    stringerThicknessCm: 5,
    color: DEFAULT_COLOR,
  },
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * A fresh copy of the defaults for `kind`, so a caller can never mutate the
 * module-level object.
 */
export function assemblyDefaults<K extends AssemblyKind>(kind: K): AssemblyParamsByKind[K] {
  return { ...ASSEMBLY_DEFAULTS[kind] } as AssemblyParamsByKind[K];
}

/**
 * Validate a stored or incoming parameter object.
 *
 * Returns a complete, in-range parameter set, or `null` when the input cannot be
 * used. Missing channels fall back to the default for that kind; a value that is
 * present but non-finite, of the wrong type, or outside its range makes the
 * whole input invalid — a partially applied assembly would be a half-built
 * object, which the builder must never produce.
 */
export function validateAssemblyParams<K extends AssemblyKind>(
  kind: K,
  raw: unknown,
): AssemblyParamsByKind[K] | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const fields = ASSEMBLY_FIELDS[kind] as Record<string, NumericRange>;
  const params = assemblyDefaults(kind) as unknown as Record<string, unknown>;

  for (const [key, range] of Object.entries(fields)) {
    const value = record[key];
    if (value === undefined || value === null) {
      continue; // keep the default
    }
    // bool is a subtype of number in JS only through the Number() coercion path,
    // so reject it explicitly before any numeric conversion.
    if (typeof value === 'boolean') {
      return null;
    }
    const numeric = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(numeric)) {
      return null;
    }
    if (range.integer && !Number.isInteger(numeric)) {
      return null;
    }
    if (numeric < range.min || numeric > range.max) {
      return null;
    }
    params[key] = numeric;
  }

  const color = record.color;
  if (color !== undefined && color !== null) {
    if (typeof color !== 'string' || !HEX_COLOR.test(color)) {
      return null;
    }
    params.color = color.toLowerCase();
  }

  return params as unknown as AssemblyParamsByKind[K];
}

/**
 * Validate and throw on failure. Used where a caller must not continue with a
 * bad construction (for example the UI when the user submits).
 */
export function requireAssemblyParams<K extends AssemblyKind>(
  kind: K,
  raw: unknown,
): AssemblyParamsByKind[K] {
  const params = validateAssemblyParams(kind, raw);
  if (params === null) {
    throw new AssemblyError(
      'assembly_invalid_params',
      "Assembly parametrlari noto'g'ri yoki ruxsat etilgan oraliqdan tashqarida.",
    );
  }
  return params;
}

/** Total width of a kitchen run: the modules are placed edge to edge. */
export function kitchenRunWidthCm(params: KitchenBaseRunParams): number {
  return params.moduleCount * params.moduleWidthCm;
}

/** Total height of a straight stair: every step rises by `riseCm`. */
export function stairTotalRiseCm(params: StairStraightParams): number {
  return params.stepCount * params.riseCm;
}

/** Total going (horizontal run) of a straight stair. */
export function stairTotalRunCm(params: StairStraightParams): number {
  return params.stepCount * params.stepDepthCm;
}
