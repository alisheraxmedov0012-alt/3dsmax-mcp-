import * as THREE from 'three';

export interface NormalValidationOptions {
  readonly requireNormals?: boolean;
  readonly unitTolerance?: number;
}

export interface NormalValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly hasNormals: boolean;
  readonly nonFinite: number;
  readonly zeroLength: number;
  readonly nonUnit: number;
}

/** Check presence, finiteness and length of the normal attribute. */
export function validateNormals(
  geometry: THREE.BufferGeometry,
  options: NormalValidationOptions = {},
): NormalValidation {
  const requireNormals = options.requireNormals ?? true;
  const tolerance = options.unitTolerance ?? 1e-3;
  const errors: string[] = [];
  const warnings: string[] = [];
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;

  if (!normal) {
    if (requireNormals) {
      errors.push('normal atributi yo‘q.');
    }
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      hasNormals: false,
      nonFinite: 0,
      zeroLength: 0,
      nonUnit: 0,
    };
  }

  if (position && normal.count !== position.count) {
    errors.push(`normal soni (${normal.count}) position soni (${position.count}) bilan mos emas.`);
  }

  let nonFinite = 0;
  let zeroLength = 0;
  let nonUnit = 0;
  for (let i = 0; i < normal.count; i += 1) {
    const x = normal.getX(i);
    const y = normal.getY(i);
    const z = normal.getZ(i);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      nonFinite += 1;
      continue;
    }
    const length = Math.hypot(x, y, z);
    if (length <= 1e-8) {
      zeroLength += 1;
    } else if (Math.abs(length - 1) > tolerance) {
      nonUnit += 1;
    }
  }

  if (nonFinite > 0) {
    errors.push(`${nonFinite} normal chekli emas (NaN yoki Infinity).`);
  }
  if (zeroLength > 0) {
    warnings.push(`${zeroLength} normal nol uzunlikda.`);
  }
  if (nonUnit > 0) {
    warnings.push(`${nonUnit} normal unit uzunlikda emas.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    hasNormals: true,
    nonFinite,
    zeroLength,
    nonUnit,
  };
}
