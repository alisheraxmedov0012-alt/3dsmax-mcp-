import * as THREE from 'three';

export interface DegenerateValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly triangleCount: number;
  readonly hasDegenerateTriangles: boolean;
  readonly degenerateTriangles: number;
  readonly duplicateTriangles: number;
}

function triangleIndices(
  geometry: THREE.BufferGeometry,
  triangle: number,
): readonly [number, number, number] | null {
  const index = geometry.getIndex();
  if (index) {
    return [
      index.getX(triangle * 3),
      index.getX(triangle * 3 + 1),
      index.getX(triangle * 3 + 2),
    ];
  }
  return [triangle * 3, triangle * 3 + 1, triangle * 3 + 2];
}

function triangleArea(
  position: THREE.BufferAttribute,
  a: number,
  b: number,
  c: number,
): number {
  const ax = position.getX(a);
  const ay = position.getY(a);
  const az = position.getZ(a);
  const ux = position.getX(b) - ax;
  const uy = position.getY(b) - ay;
  const uz = position.getZ(b) - az;
  const vx = position.getX(c) - ax;
  const vy = position.getY(c) - ay;
  const vz = position.getZ(c) - az;
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  return Math.hypot(cx, cy, cz) / 2;
}

/** Structural checks and zero-area/duplicate triangle detection. */
export function validateDegenerate(geometry: THREE.BufferGeometry): DegenerateValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!position || position.count === 0) {
    return {
      valid: false,
      errors: ['position atributi yo‘q yoki bo‘sh.'],
      warnings,
      triangleCount: 0,
      hasDegenerateTriangles: false,
      degenerateTriangles: 0,
      duplicateTriangles: 0,
    };
  }

  let nonFinite = 0;
  for (let i = 0; i < position.count; i += 1) {
    if (
      !Number.isFinite(position.getX(i)) ||
      !Number.isFinite(position.getY(i)) ||
      !Number.isFinite(position.getZ(i))
    ) {
      nonFinite += 1;
    }
  }
  if (nonFinite > 0) {
    errors.push(`${nonFinite} vertex koordinatasi chekli emas (NaN yoki Infinity).`);
  }

  const index = geometry.getIndex();
  let triangleCount: number;
  if (index) {
    if (index.count === 0 || index.count % 3 !== 0) {
      errors.push('index soni uchga bo‘linmaydi yoki bo‘sh.');
      triangleCount = 0;
    } else {
      triangleCount = index.count / 3;
      for (let i = 0; i < index.count; i += 1) {
        const value = index.getX(i);
        if (!Number.isInteger(value) || value < 0 || value >= position.count) {
          errors.push(`index[${i}] vertex chegarasidan tashqarida.`);
          break;
        }
      }
    }
  } else {
    if (position.count % 3 !== 0) {
      errors.push('position soni uchga bo‘linmaydi (non-indexed triangle mesh emas).');
    }
    triangleCount = Math.floor(position.count / 3);
  }

  if (triangleCount === 0) {
    errors.push('geometryda uchburchak yo‘q.');
  }

  let degenerateTriangles = 0;
  let duplicateTriangles = 0;
  const seen = new Set<string>();
  if (errors.length === 0 && nonFinite === 0) {
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const indices = triangleIndices(geometry, triangle);
      if (!indices) {
        continue;
      }
      const [a, b, c] = indices;
      if (a === b || b === c || a === c) {
        degenerateTriangles += 1;
        continue;
      }
      if (triangleArea(position, a, b, c) <= 1e-10) {
        degenerateTriangles += 1;
        continue;
      }
      const key = [...indices].sort((left, right) => left - right).join(',');
      if (seen.has(key)) {
        duplicateTriangles += 1;
      } else {
        seen.add(key);
      }
    }
  }

  if (degenerateTriangles > 0) {
    warnings.push(`${degenerateTriangles} degenerativ (nol maydonli yoki takroriy vertexli) triangle topildi.`);
  }
  if (duplicateTriangles > 0) {
    warnings.push(`${duplicateTriangles} takroriy triangle topildi.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    triangleCount,
    hasDegenerateTriangles: degenerateTriangles > 0,
    degenerateTriangles,
    duplicateTriangles,
  };
}
