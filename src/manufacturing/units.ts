/**
 * W9 length units.
 *
 * The whole scene works in centimetres; manufacturing data is conventionally in
 * millimetres, so conversion is explicit and tested rather than implicit.
 */

export type LengthUnit = 'cm' | 'mm';

export const CM_PER_MM = 0.1;
export const MM_PER_CM = 10;

/** Multiplier that converts a value from `from` into `to`. */
export function unitFactor(from: LengthUnit, to: LengthUnit): number {
  if (from === to) {
    return 1;
  }
  return from === 'cm' && to === 'mm' ? MM_PER_CM : CM_PER_MM;
}

/** Convert a length between units. Non-finite input yields 0 (never NaN). */
export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value * unitFactor(from, to);
}

/** Round to a sane number of decimals for display (mm keeps one decimal). */
export function roundLength(value: number, unit: LengthUnit): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return unit === 'mm' ? Math.round(value * 10) / 10 : Math.round(value * 100) / 100;
}

/** Format a centimetre value in the target unit, e.g. `1200 mm` / `120 sm`. */
export function formatLength(valueCm: number, unit: LengthUnit): string {
  const converted = roundLength(convertLength(valueCm, 'cm', unit), unit);
  return `${converted} ${unit === 'mm' ? 'mm' : 'sm'}`;
}
