export interface TableParams {
  widthCm: number;
  heightCm: number;
  depthCm: number;
  color: string;
}

export interface DimensionRange {
  min: number;
  max: number;
  step: number;
}

export const TABLE_LIMITS = {
  widthCm: { min: 40, max: 240, step: 1 },
  heightCm: { min: 40, max: 120, step: 1 },
  depthCm: { min: 40, max: 120, step: 1 },
} satisfies Record<'widthCm' | 'heightCm' | 'depthCm', DimensionRange>;

export const TABLE_DEFAULTS: TableParams = {
  widthCm: 120,
  heightCm: 75,
  depthCm: 60,
  color: '#a9744f',
};

export const TABLE_COLORS: readonly string[] = [
  '#a9744f',
  '#8b5a2b',
  '#d9c7a7',
  '#5b6b73',
  '#2f2f2f',
  '#c0392b',
];

export interface TableFieldValues {
  widthCm: string;
  heightCm: string;
  depthCm: string;
  color: string;
}

export type TableDimensionField = 'widthCm' | 'heightCm' | 'depthCm';

export interface TableErrors {
  widthCm?: string;
  heightCm?: string;
  depthCm?: string;
  color?: string;
}

export interface ParseResult {
  valid: boolean;
  params: TableParams | null;
  errors: TableErrors;
}

export const DEFAULT_FIELD_VALUES: TableFieldValues = {
  widthCm: String(TABLE_DEFAULTS.widthCm),
  heightCm: String(TABLE_DEFAULTS.heightCm),
  depthCm: String(TABLE_DEFAULTS.depthCm),
  color: TABLE_DEFAULTS.color,
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

type DimensionResult = { ok: true; value: number } | { ok: false; error: string };

function parseDimension(raw: string, range: DimensionRange, label: string): DimensionResult {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: false, error: `${label}: qiymat kiritilishi shart.` };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, error: `${label}: faqat son kiriting.` };
  }
  if (value < range.min || value > range.max) {
    return { ok: false, error: `${label}: ${range.min}–${range.max} sm oralig'ida bo'lishi kerak.` };
  }
  return { ok: true, value };
}

export function parseTableValues(values: TableFieldValues): ParseResult {
  const errors: TableErrors = {};

  const width = parseDimension(values.widthCm, TABLE_LIMITS.widthCm, 'Kenglik');
  if (!width.ok) {
    errors.widthCm = width.error;
  }

  const height = parseDimension(values.heightCm, TABLE_LIMITS.heightCm, 'Balandlik');
  if (!height.ok) {
    errors.heightCm = height.error;
  }

  const depth = parseDimension(values.depthCm, TABLE_LIMITS.depthCm, 'Chuqurlik');
  if (!depth.ok) {
    errors.depthCm = depth.error;
  }

  const color = values.color.trim();
  if (!HEX_COLOR.test(color)) {
    errors.color = "Rang: #RRGGBB ko'rinishida bo'lishi kerak.";
  }

  if (!width.ok || !height.ok || !depth.ok || Object.keys(errors).length > 0) {
    return { valid: false, params: null, errors };
  }

  return {
    valid: true,
    errors,
    params: {
      widthCm: width.value,
      heightCm: height.value,
      depthCm: depth.value,
      color,
    },
  };
}
