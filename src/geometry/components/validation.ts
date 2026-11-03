import { GeometryKernelError, type Vec3Tuple } from '../kernel';
import { CONNECTION_TYPES, type ConnectionType } from './types';

function invalid(message: string): never {
  throw new GeometryKernelError('invalid_recipe', message);
}

export function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    invalid(`${label}: noldan katta va chekli son bo'lishi kerak.`);
  }
  return value;
}

export function nonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    invalid(`${label}: manfiy bo'lmagan chekli son bo'lishi kerak.`);
  }
  return value;
}

export function inRange(value: number, min: number, max: number, label: string): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    invalid(`${label}: ${min}–${max} oralig'ida bo'lishi kerak.`);
  }
  return value;
}

export function integerInRange(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    invalid(`${label}: ${min}–${max} oralig'idagi butun son bo'lishi kerak.`);
  }
  return value;
}

export function nonEmptyId(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    invalid(`${label}: bo'sh bo'lmasligi kerak.`);
  }
  return trimmed;
}

export function vec3(value: Vec3Tuple | undefined, fallback: Vec3Tuple, label: string): Vec3Tuple {
  const source = value ?? fallback;
  if (source.length !== 3 || source.some((item) => !Number.isFinite(item))) {
    invalid(`${label}: uchta chekli son bo'lishi kerak.`);
  }
  return source;
}

export function unitDirection(value: Vec3Tuple, label: string): Vec3Tuple {
  const checked = vec3(value, [0, 0, 0], label);
  const length = Math.hypot(checked[0], checked[1], checked[2]);
  if (length <= 1e-9) {
    invalid(`${label}: nol vektor bo'lmasligi kerak.`);
  }
  return [checked[0] / length, checked[1] / length, checked[2] / length];
}

export function connectionType(value: string): ConnectionType {
  if (!(CONNECTION_TYPES as readonly string[]).includes(value)) {
    invalid(`connection.type: noma'lum tur "${value}".`);
  }
  return value as ConnectionType;
}

export interface SurfaceParams {
  readonly cornerRadius: number;
  readonly bevel: number;
  readonly segments: number;
}

/** Shared panel/door/shelf surface validation (edge radius and bevel). */
export function surfaceParams(
  width: number,
  height: number,
  thickness: number,
  cornerRadius: number,
  bevel: number,
  segments: number,
  label: string,
): SurfaceParams {
  const radius = nonNegative(cornerRadius, `${label}.cornerRadius`);
  const edge = nonNegative(bevel, `${label}.bevel`);
  const count = integerInRange(segments, 1, 16, `${label}.segments`);
  const maxRadius = Math.min(width, height, thickness) / 2;
  if (Math.max(radius, edge) > maxRadius) {
    throw new GeometryKernelError(
      'invalid_recipe',
      `${label}: cornerRadius/bevel ${maxRadius} sm dan oshmasligi kerak.`,
    );
  }
  return { cornerRadius: radius, bevel: edge, segments: count };
}
