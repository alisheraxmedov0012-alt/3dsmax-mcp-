/**
 * Stage 3.3 — the single place where a stated length becomes centimetres.
 *
 * The whole scene model is centimetres (see `scene/types.ts`), so millimetres and
 * metres must be converted here, not in the parser or the UI. An absent unit is
 * *unknown*, not centimetres: callers must ask instead of guessing.
 */
export type LengthUnit = 'mm' | 'cm' | 'm';

export const CM_PER_UNIT: Readonly<Record<LengthUnit, number>> = {
  mm: 0.1,
  cm: 1,
  m: 100,
};

/** Unit spellings, three languages. Longest first so `mm` wins over `m`. */
const UNIT_TOKENS: ReadonlyArray<{ unit: LengthUnit; pattern: RegExp }> = [
  { unit: 'mm', pattern: /^(?:mm|мм|millimetr\w*|миллиметр\w*|millimeter\w*)$/i },
  { unit: 'cm', pattern: /^(?:cm|sm|см|santimetr\w*|сантиметр\w*|centimet(?:er|re)\w*)$/i },
  { unit: 'm', pattern: /^(?:m|м|metr\w*|метр\w*|met(?:er|re)\w*)$/i },
];

export function parseLengthUnit(token: string): LengthUnit | null {
  const trimmed = token.trim();
  if (trimmed === '') {
    return null;
  }
  for (const entry of UNIT_TOKENS) {
    if (entry.pattern.test(trimmed)) {
      return entry.unit;
    }
  }
  return null;
}

/** Converts a stated length to the scene's internal unit (cm), rounding noise away. */
export function toCentimetres(value: number, unit: LengthUnit): number {
  return Math.round(value * CM_PER_UNIT[unit] * 1000) / 1000;
}

/** Number tokens in the prompt use a dot or a comma decimal separator. */
export function parseDecimal(token: string): number {
  return Number(token.replace(',', '.'));
}
