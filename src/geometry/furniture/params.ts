/**
 * Parsing, validation and defaults for `FurnitureParams`.
 *
 * Two entry points:
 * - `parseFurnitureValues` — the UI path: takes raw string field values, returns
 *   a validated `FurnitureParams` plus per-field error messages (invalid input is
 *   never applied).
 * - `validateFurnitureParams` — the storage path: takes unknown stored JSON and
 *   returns a normalized `FurnitureParams`, or `null` when the required base
 *   dimensions/colour are missing or out of range.
 *
 * Neither ever yields NaN/Infinity: the geometry builders therefore receive only
 * finite, in-range numbers.
 */
import {
  FURNITURE_DEFAULTS,
  FURNITURE_FIELDS,
  createFurnitureParams,
  isFurnitureType,
  type FurnitureFieldSpec,
  type FurnitureNumericKey,
  type FurnitureParams,
  type FurnitureType,
} from './types';
import { drawerFitProblem, shelfFitProblem } from './capacity';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export type FurnitureErrors = Partial<Record<FurnitureNumericKey | 'color', string>>;

export interface FurnitureParseResult {
  valid: boolean;
  params: FurnitureParams | null;
  errors: FurnitureErrors;
}

/** The three base dimensions every type requires. */
const BASE_DIMENSIONS: readonly FurnitureNumericKey[] = ['widthCm', 'heightCm', 'depthCm'];

function parseNumber(
  raw: string,
  spec: FurnitureFieldSpec,
  label: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: false, error: `${label}: qiymat kiritilishi shart.` };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, error: `${label}: faqat son kiriting.` };
  }
  if (spec.integer && !Number.isInteger(value)) {
    return { ok: false, error: `${label}: butun son bo'lishi kerak.` };
  }
  if (value < spec.range.min || value > spec.range.max) {
    return {
      ok: false,
      error: `${label}: ${spec.range.min}–${spec.range.max} oralig'ida bo'lishi kerak.`,
    };
  }
  return { ok: true, value };
}

function assertFinite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Cross-field sanity checks. Returns an error per offending field so the UI can
 * point at the right control; an empty object means the combination is valid.
 */
export function relationErrors(type: FurnitureType, p: FurnitureParams): FurnitureErrors {
  const errors: FurnitureErrors = {};
  const w = assertFinite(p.wallThicknessCm ?? 0);

  if (type === 'table') {
    if ((p.topThicknessCm ?? 0) >= p.heightCm) {
      errors.topThicknessCm = "Usti qalinligi balandlikdan kichik bo'lishi kerak.";
    }
  }
  if (type === 'chair' || type === 'armchair' || type === 'sofa') {
    if ((p.seatHeightCm ?? 0) >= p.heightCm) {
      errors.seatHeightCm = "O'rindiq balandligi umumiy balandlikdan kichik bo'lishi kerak.";
    }
  }
  if (type === 'armchair' || type === 'sofa') {
    if ((p.armHeightCm ?? 0) > p.heightCm) {
      errors.armHeightCm = "Qo'l tayanchi balandligi umumiy balandlikdan oshmasligi kerak.";
    }
  }
  if (type === 'wardrobe' || type === 'shelf') {
    if (w > 0 && p.heightCm <= 2 * w) {
      errors.wallThicknessCm = "Devor qalinligi balandlikka nisbatan juda katta.";
    }
    if (w > 0 && p.depthCm <= 2 * w) {
      errors.wallThicknessCm = "Devor qalinligi chuqurlikka nisbatan juda katta.";
    }
  }
  if (type === 'dresser') {
    if ((p.legHeightCm ?? 0) >= p.heightCm) {
      errors.legHeightCm = "Oyoq balandligi umumiy balandlikdan kichik bo'lishi kerak.";
    }
  }

  // Fit checks: a count that cannot physically fit inside the opening would make
  // the builder stack parts on top of each other. The arithmetic lives in
  // `capacity.ts` and is shared with the builders, so a combination rejected here
  // is exactly one that would have produced overlapping geometry.
  if (type === 'shelf') {
    const problem = shelfFitProblem(p);
    if (problem !== null) {
      errors.shelfCount = problem;
    }
  }
  if (type === 'dresser') {
    const problem = drawerFitProblem(p);
    if (problem !== null) {
      errors.drawerCount = problem;
    }
  }
  return errors;
}

/** Convert a params object into editable string field values. */
export function furnitureParamsToFieldValues(
  type: FurnitureType,
  params: FurnitureParams,
): Record<string, string> {
  const values: Record<string, string> = { color: params.color };
  for (const spec of FURNITURE_FIELDS[type]) {
    const value = params[spec.key];
    values[spec.key] = String(value ?? FURNITURE_DEFAULTS[type][spec.key] ?? spec.range.min);
  }
  return values;
}

/** Parse and validate raw UI field values for a furniture type. */
export function parseFurnitureValues(
  type: FurnitureType,
  values: Record<string, string>,
): FurnitureParseResult {
  const errors: FurnitureErrors = {};
  const params: FurnitureParams = createFurnitureParams(type);

  for (const spec of FURNITURE_FIELDS[type]) {
    const result = parseNumber(values[spec.key] ?? '', spec, spec.label);
    if (result.ok) {
      params[spec.key] = result.value;
    } else {
      errors[spec.key] = result.error;
    }
  }

  const color = (values.color ?? '').trim();
  if (!HEX_COLOR.test(color)) {
    errors.color = "Rang: #RRGGBB ko'rinishida bo'lishi kerak.";
  } else {
    params.color = color;
  }

  if (Object.keys(errors).length === 0) {
    Object.assign(errors, relationErrors(type, params));
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, params: null, errors };
  }
  return { valid: true, params, errors };
}

/**
 * One channel that was present in the stored data but could not be kept as
 * written, so the model will use something else.
 */
export interface ParamNormalization {
  key: FurnitureNumericKey;
  /** The stored value, stringified for display. */
  stored: string;
  /** The value the validated params actually carry, or null when the channel was
   *  dropped and the builder's own fallback applies. */
  applied: number | null;
  reason: 'out-of-range' | 'not-integer' | 'not-finite';
}

export interface DetailedFurnitureParams {
  params: FurnitureParams;
  /** Channels that were adjusted. Empty when the stored data was used verbatim. */
  normalized: ParamNormalization[];
}

/**
 * Validate stored params and report what had to be adjusted.
 *
 * `validateFurnitureParams` answers "is this representable?" and says nothing
 * about the route it took, which is how a stored `topThicknessCm: 1000` could
 * become a different piece without a trace. This variant returns the same params
 * plus the list of channels that were rewritten, so a caller can tell the user.
 *
 * Base dimensions and colour are still all-or-nothing: an unrepresentable object
 * returns `null` from both entry points. Only *optional* channels produce a
 * normalization entry, because those are the ones that are silently replaced —
 * an optional value that is missing entirely is not a normalization (older scenes
 * legitimately omit channels), it is just absent.
 */
export function validateFurnitureParamsDetailed(
  type: FurnitureType,
  raw: unknown,
): DetailedFurnitureParams | null {
  if (!isFurnitureType(type) || typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const defaults = FURNITURE_DEFAULTS[type];

  const readNumber = (spec: FurnitureFieldSpec): number | null => {
    const value = record[spec.key];
    const numeric =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
    if (!Number.isFinite(numeric)) {
      return null;
    }
    if (spec.integer && !Number.isInteger(numeric)) {
      return null;
    }
    return numeric;
  };

  // Build only what is stored: base dims + colour are required, optional channels
  // are copied when present and valid (absent ones are left out so old scenes keep
  // their exact shape and the builders fall back to defaults).
  const params: FurnitureParams = {
    widthCm: 0,
    heightCm: 0,
    depthCm: 0,
    color: defaults.color,
  };

  for (const key of BASE_DIMENSIONS) {
    const spec = FURNITURE_FIELDS[type].find((entry) => entry.key === key);
    if (!spec) {
      return null;
    }
    const value = readNumber(spec);
    if (value === null || value < spec.range.min || value > spec.range.max) {
      return null;
    }
    params[key] = value;
  }

  const color = record.color;
  if (typeof color !== 'string' || !HEX_COLOR.test(color.trim())) {
    return null;
  }
  params.color = color.trim().toLowerCase();

  const normalized: ParamNormalization[] = [];
  for (const spec of FURNITURE_FIELDS[type]) {
    if (BASE_DIMENSIONS.includes(spec.key)) {
      continue;
    }
    // Absent is not "normalized": older scenes omit optional channels on purpose.
    if (!(spec.key in record)) {
      continue;
    }
    const storedRaw = record[spec.key];
    const numeric =
      typeof storedRaw === 'number'
        ? storedRaw
        : typeof storedRaw === 'string'
          ? Number(storedRaw.trim())
          : Number.NaN;

    // Classify explicitly rather than inferring from `readNumber`, which collapses
    // "not a number" and "not an integer" into the same null.
    const reason: ParamNormalization['reason'] | null = !Number.isFinite(numeric)
      ? 'not-finite'
      : spec.integer && !Number.isInteger(numeric)
        ? 'not-integer'
        : numeric < spec.range.min || numeric > spec.range.max
          ? 'out-of-range'
          : null;

    if (reason === null) {
      params[spec.key] = numeric;
      continue;
    }
    normalized.push({
      key: spec.key,
      stored: typeof storedRaw === 'string' ? storedRaw : String(storedRaw),
      applied: null,
      reason,
    });
  }

  if (Object.keys(relationErrors(type, params)).length > 0) {
    return null;
  }

  // Report the value that survived, now that `params` is final.
  for (const entry of normalized) {
    const value = params[entry.key];
    entry.applied = typeof value === 'number' ? value : null;
  }
  return { params, normalized };
}

/**
 * Validate stored (unknown) params for a type.
 *
 * Thin wrapper over {@link validateFurnitureParamsDetailed} so there is one
 * implementation and the two entry points cannot disagree. Existing callers keep
 * the old contract: the validated params, or `null` when not representable.
 */
export function validateFurnitureParams(type: FurnitureType, raw: unknown): FurnitureParams | null {
  return validateFurnitureParamsDetailed(type, raw)?.params ?? null;
}

/**
 * Last-resort safety net for the geometry builders.
 *
 * The authoritative validation happens earlier (UI `parseFurnitureValues`, scene
 * `validateFurnitureParams`), so this never runs for normal user input. It exists
 * because builders can also be driven by other callers (e.g. a future W1
 * `DesignSpec`), and a NaN/Infinity dimension would otherwise produce non-finite
 * vertex coordinates. Non-finite base dimensions fall back to the type default;
 * finite ones are clamped into the type's declared range. Optional channels are
 * left untouched — the builders already clamp those.
 */
export function sanitizeBaseDimensions(type: FurnitureType, params: FurnitureParams): FurnitureParams {
  const safe: FurnitureParams = { ...params };
  for (const key of BASE_DIMENSIONS) {
    const spec = FURNITURE_FIELDS[type].find((entry) => entry.key === key);
    const fallback = FURNITURE_DEFAULTS[type][key];
    const raw = params[key];
    if (spec === undefined) {
      safe[key] = typeof raw === 'number' && Number.isFinite(raw) ? raw : (fallback as number);
      continue;
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      safe[key] = fallback as number;
    } else {
      safe[key] = Math.min(Math.max(raw, spec.range.min), spec.range.max);
    }
  }
  return safe;
}
