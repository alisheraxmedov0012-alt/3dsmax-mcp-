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
 * Validate stored (unknown) params for a type. Base dimensions and colour must be
 * present and in range; other channels fall back to their default when missing or
 * unusable. Returns `null` when the object is not representable.
 */
export function validateFurnitureParams(type: FurnitureType, raw: unknown): FurnitureParams | null {
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

  for (const spec of FURNITURE_FIELDS[type]) {
    if (BASE_DIMENSIONS.includes(spec.key)) {
      continue;
    }
    const value = readNumber(spec);
    if (value !== null && value >= spec.range.min && value <= spec.range.max) {
      params[spec.key] = value;
    }
  }

  if (Object.keys(relationErrors(type, params)).length > 0) {
    return null;
  }
  return params;
}
