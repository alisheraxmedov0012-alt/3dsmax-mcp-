import * as THREE from 'three';
import type { CreateGeometryOptions, GeometryValidationResult } from '../types';
import { validateDegenerate } from './validateDegenerate';
import { validateNormals } from './validateNormals';

/** Full structural validation used by the factory and available to callers. */
export function validateGeometry(
  geometry: THREE.BufferGeometry,
  options: CreateGeometryOptions = {},
): GeometryValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;

  if (!position || position.count === 0) {
    return {
      valid: false,
      errors: ['position atributi yo‘q yoki bo‘sh.'],
      warnings,
      vertexCount: 0,
      triangleCount: 0,
      hasNormals: false,
      hasUv: false,
      hasDegenerateTriangles: false,
      boundingBoxValid: false,
    };
  }

  const degenerate = validateDegenerate(geometry);
  errors.push(...degenerate.errors);
  warnings.push(...degenerate.warnings);

  const normals = validateNormals(geometry, {
    requireNormals: options.requireNormals ?? true,
  });
  errors.push(...normals.errors);
  warnings.push(...normals.warnings);

  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) {
    if (options.requireUv ?? true) {
      errors.push('uv atributi yo‘q.');
    }
  } else {
    if (uv.count !== position.count) {
      errors.push(`uv soni (${uv.count}) position soni (${position.count}) bilan mos emas.`);
    }
    let nonFiniteUv = 0;
    for (let i = 0; i < uv.count; i += 1) {
      if (!Number.isFinite(uv.getX(i)) || !Number.isFinite(uv.getY(i))) {
        nonFiniteUv += 1;
      }
    }
    if (nonFiniteUv > 0) {
      errors.push(`${nonFiniteUv} UV koordinatasi chekli emas.`);
    }
  }

  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  let boundingBoxValid = false;
  if (box) {
    const values = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
    boundingBoxValid =
      values.every((value) => Number.isFinite(value)) &&
      box.min.x <= box.max.x &&
      box.min.y <= box.max.y &&
      box.min.z <= box.max.z;
  }
  if (!boundingBoxValid) {
    errors.push('bounding box chekli emas yoki noto‘g‘ri.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    vertexCount: position.count,
    triangleCount: degenerate.triangleCount,
    hasNormals: normals.hasNormals,
    hasUv: Boolean(uv),
    hasDegenerateTriangles: degenerate.hasDegenerateTriangles,
    boundingBoxValid,
  };
}
