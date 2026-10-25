/**
 * C8.6.2 — the parameter contract shared by the builders.
 *
 * `FURNITURE_FIELDS` is the declared range for every editable channel. The
 * builders also clamp, but for a different purpose: their bounds are *geometric*
 * (a seat must leave room for a backrest, a mattress must be thick enough to
 * model). The two were written independently, so some builder bounds were wider
 * than the declared range — a bed headboard clamped to 200 cm while the field
 * declares 150, a chair seat accepted 20 cm where the field declares 25.
 *
 * That was invisible through the normal path, because `parseFurnitureValues` and
 * `validateFurnitureParams` reject out-of-range input before a builder runs. It
 * only mattered when a builder was called directly (the W13 spec flow, tests, and
 * any future caller), where the geometry could leave the documented contract.
 *
 * The fix is deliberately a *gate* rather than a rewrite of the geometric bounds:
 * the stored value is pulled into the declared range first, and the builder's own
 * clamp then runs unchanged. That ordering matters —
 *
 * - for an in-range value nothing changes at all, so existing geometry is
 *   byte-identical;
 * - a geometric ceiling that depends on other parameters (a backrest limited by
 *   the space above the seat) keeps working, because it is still applied after
 *   the gate. Intersecting the two bounds up front would instead risk an empty
 *   range whenever the geometric ceiling drops below the declared floor.
 *
 * A missing value stays missing, so the builder's documented fallback is used.
 */
import { FURNITURE_DEFAULTS, FURNITURE_FIELDS, type FurnitureNumericKey, type FurnitureType } from './types';

/** Declared editable range for one channel, or null when the type has no such field. */
export function declaredRange(
  type: FurnitureType,
  key: FurnitureNumericKey,
): { min: number; max: number } | null {
  const spec = FURNITURE_FIELDS[type]?.find((entry) => entry.key === key);
  return spec ? { min: spec.range.min, max: spec.range.max } : null;
}

/**
 * Bring a stored channel into its declared range.
 *
 * Returns `undefined` when the channel has no declared field for this type, or
 * when the value is absent/non-finite — both cases where the builder's own
 * fallback is the right answer and the contract has nothing to say.
 */
export function gateParam(
  type: FurnitureType,
  key: FurnitureNumericKey,
  raw: number | undefined,
): number | undefined {
  const range = declaredRange(type, key);
  if (range === null) {
    return undefined;
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return undefined;
  }
  return Math.min(Math.max(raw, range.min), range.max);
}

/**
 * The declared default for a channel.
 *
 * Used where a builder needs a fallback that agrees with `FURNITURE_DEFAULTS`
 * rather than repeating the literal.
 */
export function declaredDefault(type: FurnitureType, key: FurnitureNumericKey): number {
  const value = FURNITURE_DEFAULTS[type][key];
  return typeof value === 'number' ? value : 0;
}
