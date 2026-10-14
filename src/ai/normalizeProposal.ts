import {
  paramsToFieldValues,
  parseTableValues,
  TABLE_DEFAULTS,
  TABLE_LIMITS,
  type DimensionRange,
  type TableParams,
} from '../geometry/tableParams';

/** Raw, possibly incomplete or out-of-range values coming from an adapter. */
export interface RawTableProposal {
  widthCm?: number;
  heightCm?: number;
  depthCm?: number;
  color?: string;
}

export interface NormalizedProposal {
  params: TableParams;
  notes: string[];
  warnings: string[];
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

interface DimensionOutcome {
  value: number;
  note?: string;
  warning?: string;
}

function normalizeDimension(
  value: number | undefined,
  range: DimensionRange,
  label: string,
  fallback: number,
): DimensionOutcome {
  if (value === undefined || !Number.isFinite(value)) {
    return {
      value: fallback,
      note: `${label}: aniqlanmadi, standart qiymat ishlatildi (${fallback} sm).`,
    };
  }

  if (value < range.min || value > range.max) {
    const clamped = Math.min(Math.max(value, range.min), range.max);
    return {
      value: clamped,
      warning: `${label}: ${value} sm ruxsat etilgan ${range.min}–${range.max} sm oralig'iga keltirildi (${clamped} sm).`,
    };
  }

  return { value };
}

interface ColorOutcome {
  color: string;
  note?: string;
  warning?: string;
}

function normalizeColor(color: string | undefined): ColorOutcome {
  const trimmed = (color ?? '').trim();
  if (trimmed === '') {
    return {
      color: TABLE_DEFAULTS.color,
      note: `Rang: aniqlanmadi, standart rang ishlatildi (${TABLE_DEFAULTS.color}).`,
    };
  }
  if (!HEX_COLOR.test(trimmed)) {
    return {
      color: TABLE_DEFAULTS.color,
      warning: `Rang: "${trimmed}" noto'g'ri, standart rang ishlatildi (${TABLE_DEFAULTS.color}).`,
    };
  }
  return { color: trimmed.toLowerCase() };
}

/**
 * Quality control for adapter output: clamps dimensions into the supported
 * ranges, normalizes the colour and verifies the result is accepted by the
 * geometry layer (`parseTableValues`). Adjustments are reported as warnings.
 */
export function normalizeProposal(raw: RawTableProposal): NormalizedProposal {
  const notes: string[] = [];
  const warnings: string[] = [];

  const width = normalizeDimension(
    raw.widthCm,
    TABLE_LIMITS.widthCm,
    'Kenglik',
    TABLE_DEFAULTS.widthCm,
  );
  const height = normalizeDimension(
    raw.heightCm,
    TABLE_LIMITS.heightCm,
    'Balandlik',
    TABLE_DEFAULTS.heightCm,
  );
  const depth = normalizeDimension(
    raw.depthCm,
    TABLE_LIMITS.depthCm,
    'Chuqurlik',
    TABLE_DEFAULTS.depthCm,
  );

  [width, height, depth].forEach((outcome) => {
    if (outcome.note) notes.push(outcome.note);
    if (outcome.warning) warnings.push(outcome.warning);
  });

  const color = normalizeColor(raw.color);
  if (color.note) notes.push(color.note);
  if (color.warning) warnings.push(color.warning);

  const candidate: TableParams = {
    widthCm: width.value,
    heightCm: height.value,
    depthCm: depth.value,
    color: color.color,
  };

  // Final safety check: the geometry layer must accept the parameters.
  const validated = parseTableValues(paramsToFieldValues(candidate));
  if (!validated.params) {
    warnings.push("Natija tekshiruvdan o'tmadi; standart stol ishlatildi.");
    return { params: { ...TABLE_DEFAULTS }, notes, warnings };
  }

  return { params: validated.params, notes, warnings };
}
