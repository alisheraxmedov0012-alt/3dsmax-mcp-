/**
 * B3 — the small, explicit printer configuration.
 *
 * There is no universal printer: build volume, minimum wall and feature size are
 * properties of a specific machine and material. Nothing is assumed here. An
 * empty field means "not configured", and every dependent check then reports
 * `NOT_CHECKED` instead of inventing a limit.
 *
 * Units are millimetres, because that is what slicers and printer specs use. The
 * scene itself stores centimetres; conversion happens in the print layer only.
 */

export interface PrinterProfile {
  name: string;
  /** Build volume in mm, or `null` when the user has not configured one. */
  buildVolumeMm: { x: number; y: number; z: number } | null;
  /** Target minimum wall thickness in mm, or `null`. */
  minWallThicknessMm: number | null;
  /** Optional minimum feature size in mm, or `null`. */
  minFeatureSizeMm: number | null;
}

export interface PrinterProfileInput {
  name?: string;
  buildVolumeXmm?: number | null;
  buildVolumeYmm?: number | null;
  buildVolumeZmm?: number | null;
  minWallThicknessMm?: number | null;
  minFeatureSizeMm?: number | null;
}

export interface PrinterProfileResult {
  profile: PrinterProfile;
  errors: string[];
}

/** No limits assumed: every dependent check reports NOT_CHECKED. */
export const EMPTY_PRINTER_PROFILE: PrinterProfile = {
  name: 'Sozlanmagan',
  buildVolumeMm: null,
  minWallThicknessMm: null,
  minFeatureSizeMm: null,
};

const MIN_POSITIVE_MM = 0.01;
const MAX_BUILD_MM = 20000;
const MAX_WALL_MM = 1000;

interface ParsedValue {
  value: number | null;
  error?: string;
  absent: boolean;
}

function parseMillimetres(
  raw: number | null | undefined,
  label: string,
  max: number,
): ParsedValue {
  if (raw === null || raw === undefined) {
    return { value: null, absent: true };
  }
  if (!Number.isFinite(raw)) {
    return { value: null, absent: false, error: `${label}: son chekli bo'lishi kerak.` };
  }
  if (raw < MIN_POSITIVE_MM) {
    return {
      value: null,
      absent: false,
      error: `${label}: ${MIN_POSITIVE_MM} mm dan katta bo'lishi kerak.`,
    };
  }
  if (raw > max) {
    return { value: null, absent: false, error: `${label}: ${max} mm dan oshmasligi kerak.` };
  }
  return { value: raw, absent: false };
}

/**
 * Validate any partially entered profile.
 *
 * A build volume is only usable when all three axes are present; entering one or
 * two axes is reported as an error rather than silently completing the others.
 */
export function resolvePrinterProfile(input: PrinterProfileInput = {}): PrinterProfileResult {
  const errors: string[] = [];
  const x = parseMillimetres(input.buildVolumeXmm, 'Build volume X', MAX_BUILD_MM);
  const y = parseMillimetres(input.buildVolumeYmm, 'Build volume Y', MAX_BUILD_MM);
  const z = parseMillimetres(input.buildVolumeZmm, 'Build volume Z', MAX_BUILD_MM);
  for (const parsed of [x, y, z]) {
    if (parsed.error) errors.push(parsed.error);
  }

  const providedAxes = [x, y, z].filter((axis) => !axis.absent).length;
  let buildVolumeMm: PrinterProfile['buildVolumeMm'] = null;
  if (providedAxes === 3 && x.value !== null && y.value !== null && z.value !== null) {
    buildVolumeMm = { x: x.value, y: y.value, z: z.value };
  } else if (providedAxes > 0) {
    errors.push("Build volume uchun X, Y va Z qiymatlari to'liq kiritilishi kerak.");
  }

  const wall = parseMillimetres(input.minWallThicknessMm, 'Minimal devor', MAX_WALL_MM);
  if (wall.error) errors.push(wall.error);
  const feature = parseMillimetres(input.minFeatureSizeMm, 'Minimal feature size', MAX_WALL_MM);
  if (feature.error) errors.push(feature.error);

  const configured = buildVolumeMm !== null || wall.value !== null || feature.value !== null;
  return {
    profile: {
      name:
        input.name?.trim() ||
        (configured ? 'Foydalanuvchi profili' : EMPTY_PRINTER_PROFILE.name),
      buildVolumeMm,
      minWallThicknessMm: wall.value,
      minFeatureSizeMm: feature.value,
    },
    errors,
  };
}
