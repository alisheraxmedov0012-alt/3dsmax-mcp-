import type { AiDesignDetails, AiDesignDimensions, AiFurnitureType } from '../api/client';
import {
  FURNITURE_FIELDS,
  createFurnitureParams,
  validateFurnitureParams,
  type FurnitureNumericKey,
  type FurnitureParams,
  type FurnitureType,
} from '../geometry/furniture';

/**
 * Turn a validated `DesignSpec` into geometry parameters for any of the eight
 * furniture types (W13).
 *
 * Two guarantees:
 *
 * 1. **Defaults first.** The result always starts from `FURNITURE_DEFAULTS[type]`
 *    and only the channels the spec actually supplies are overridden, so a spec
 *    with partial data still produces a complete, buildable object.
 * 2. **The geometry layer has the last word.** Whatever this function returns is
 *    passed through `validateFurnitureParams`, and `null` is returned if that
 *    rejects it. A caller must never apply a `null` result.
 *
 * Out-of-range values are clamped into the type's editable range with an explicit
 * warning rather than silently changed. Clamping still yields valid geometry;
 * values that cannot be salvaged (non-finite, unknown type) return `null`.
 */

const DIMENSION_KEYS = ['widthCm', 'heightCm', 'depthCm'] as const;

/** Dimension channels come from the wire (`width_cm`) but map to one axis each. */
const WIRE_TO_PARAM: Record<keyof AiDesignDimensions, FurnitureNumericKey> = {
  width_cm: 'widthCm',
  height_cm: 'heightCm',
  depth_cm: 'depthCm',
};

const DIMENSION_LABELS: Record<string, string> = {
  widthCm: 'Kenglik',
  heightCm: 'Balandlik',
  depthCm: 'Chuqurlik',
};

const DETAIL_LABELS: Record<string, string> = {
  topThicknessCm: 'Usti qalinligi',
  legCount: 'Oyoqlar soni',
  seatHeightCm: "O'rindiq balandligi",
  backHeightCm: 'Suyanchiq balandligi',
  armHeightCm: "Qo'l tayanchi balandligi",
  wallThicknessCm: 'Devor qalinligi',
  shelfCount: 'Tokchalar soni',
  doorCount: 'Eshiklar soni',
  drawerCount: 'Tortmalar soni',
  legHeightCm: 'Oyoq balandligi',
  mattressHeightCm: 'Matras qalinligi',
  headboardHeightCm: 'Bosh qismi balandligi',
};

export interface BuiltFurnitureSpec {
  type: FurnitureType;
  params: FurnitureParams;
  /**
   * The AI's `material_kind`, passed through unchanged (or `null`). Resolving it
   * to a PBR preset is a separate step — see `presetIdForMaterialKind`.
   */
  materialKind: string | null;
  notes: string[];
  warnings: string[];
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function clampToField(
  key: FurnitureNumericKey,
  raw: number,
  type: FurnitureType,
  label: string,
  warnings: string[],
): number | null {
  const spec = FURNITURE_FIELDS[type].find((field) => field.key === key);
  if (!spec) {
    // Not a channel of this type: ignore it rather than inventing one.
    return null;
  }
  if (!Number.isFinite(raw)) {
    warnings.push(`${label}: noto'g'ri qiymat e'tiborga olinmadi, standart qiymat qoldirildi.`);
    return null;
  }
  const rounded = spec.integer ? Math.round(raw) : raw;
  if (rounded < spec.range.min) {
    warnings.push(`${label}: ${rounded} ruxsat etilgan ${spec.range.min}–${spec.range.max} oralig'iga keltirildi (${spec.range.min}).`);
    return spec.range.min;
  }
  if (rounded > spec.range.max) {
    warnings.push(`${label}: ${rounded} ruxsat etilgan ${spec.range.min}–${spec.range.max} oralig'iga keltirildi (${spec.range.max}).`);
    return spec.range.max;
  }
  return rounded;
}

/**
 * Build parameters for `type` from wire dimensions/details.
 *
 * Returns `null` when the combination cannot produce valid geometry. Note that
 * "valid geometry" is not the same as "manufacturing-ready": no edge banding,
 * joinery or hardware is modelled here.
 */
export function buildFurnitureSpec(
  type: FurnitureType,
  dimensions: AiDesignDimensions | null | undefined,
  details: AiDesignDetails | null | undefined,
  color?: string | null,
  materialKind?: string | null,
): BuiltFurnitureSpec | null {
  const params = createFurnitureParams(type);
  const notes: string[] = [];
  const warnings: string[] = [];

  if (dimensions) {
    for (const wireKey of Object.keys(WIRE_TO_PARAM) as Array<keyof AiDesignDimensions>) {
      const value = dimensions[wireKey];
      if (typeof value !== 'number') {
        continue;
      }
      const paramKey = WIRE_TO_PARAM[wireKey];
      if (!DIMENSION_KEYS.includes(paramKey as (typeof DIMENSION_KEYS)[number])) {
        continue;
      }
      const clamped = clampToField(paramKey, value, type, DIMENSION_LABELS[paramKey], warnings);
      if (clamped !== null) {
        params[paramKey] = clamped;
      }
    }
  } else {
    notes.push("O'lchamlar aniqlanmadi, standart qiymatlar ishlatildi.");
  }

  if (details) {
    for (const [key, raw] of Object.entries(details)) {
      if (typeof raw !== 'number') {
        continue;
      }
      const paramKey = key as FurnitureNumericKey;
      const clamped = clampToField(
        paramKey,
        raw,
        type,
        DETAIL_LABELS[paramKey] ?? paramKey,
        warnings,
      );
      if (clamped !== null) {
        params[paramKey] = clamped;
      }
    }
  }

  if (color) {
    if (HEX_COLOR.test(color)) {
      params.color = color.toLowerCase();
    } else {
      warnings.push(`Rang: "${color}" noto'g'ri, standart rang ishlatiladi.`);
    }
  }

  // Final gate: the geometry layer must accept the parameters.
  const validated = validateFurnitureParams(type, params);
  if (!validated) {
    return null;
  }

  return { type, params: validated, materialKind: materialKind ?? null, notes, warnings };
}

/** True when the spec's type has a builder in the geometry layer. */
export function isBuildable(type: string): type is FurnitureType {
  return FURNITURE_FIELDS[type as FurnitureType] !== undefined;
}

export type { AiFurnitureType };
