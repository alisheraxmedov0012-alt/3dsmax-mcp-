import * as THREE from 'three';
import { validateUvGeometry } from '../../materials/uv';
import type { UvDiagnostic } from './types';

const UV_EPSILON = 1e-12;
const SAT_EPSILON = 1e-9;
const MAX_OVERLAP_PAIRS = 20_000;
const MAX_OVERLAP_COMPARISONS = 200_000;

interface UvTriangle {
  indices: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
  area: number;
}

function triangleIndices(
  geometry: THREE.BufferGeometry,
  triangle: number,
): [number, number, number] {
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

function sharesVertex(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): boolean {
  return left.some((value) => right.includes(value));
}

function aabbOverlap(left: UvTriangle, right: UvTriangle): boolean {
  return (
    left.minU <= right.maxU + UV_EPSILON &&
    right.minU <= left.maxU + UV_EPSILON &&
    left.minV <= right.maxV + UV_EPSILON &&
    right.minV <= left.maxV + UV_EPSILON
  );
}

function project(
  u: readonly [number, number, number],
  v: readonly [number, number, number],
  axisU: number,
  axisV: number,
): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < 3; index += 1) {
    const value = u[index] * axisU + v[index] * axisV;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

/** Strict 2D triangle overlap; edge-touching/seams do not count. */
function trianglesOverlap(left: UvTriangle, right: UvTriangle): boolean {
  const edges: Array<[number, number]> = [];
  for (const triangle of [left, right]) {
    for (let index = 0; index < 3; index += 1) {
      const next = (index + 1) % 3;
      edges.push([
        triangle.u[next] - triangle.u[index],
        triangle.v[next] - triangle.v[index],
      ]);
    }
  }

  for (const [du, dv] of edges) {
    if (Math.abs(du) < UV_EPSILON && Math.abs(dv) < UV_EPSILON) continue;
    const axisU = -dv;
    const axisV = du;
    const a = project(left.u, left.v, axisU, axisV);
    const b = project(right.u, right.v, axisU, axisV);
    if (a.max <= b.min + SAT_EPSILON || b.max <= a.min + SAT_EPSILON) {
      return false;
    }
  }
  return true;
}

export interface UvAnalysisOptions {
  meshNames?: string[];
  /** Base-colour texture pixels (width * height), when known. */
  texturePixels?: number | null;
  /** World-space surface area in cm² for one representative instance. */
  worldArea?: number | null;
}

/**
 * Exact UV validity plus bounded approximate overlap and texel-density
 * diagnostics. Overlap is deliberately informational: tiled/procedural UVs may
 * overlap by design, and the sweep is capped so a huge mesh cannot turn this
 * into a quadratic audit.
 */
export function analyzeUvQuality(
  geometry: THREE.BufferGeometry,
  options: UvAnalysisOptions = {},
): UvDiagnostic {
  const base = validateUvGeometry(geometry);
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const notes: string[] = [];

  if (!position || !uv) {
    return {
      geometryId: geometry.uuid,
      meshNames: options.meshNames ?? [],
      uvTriangles: 0,
      degenerateTriangles: 0,
      minU: null,
      maxU: null,
      minV: null,
      maxV: null,
      overlapCandidates: 0,
      overlapStatus: 'not_verified',
      overlapCapped: false,
      texelDensity: null,
      notes: [...base.errors, 'UV overlap va texel density o‘lchanmadi: UV yo‘q.'],
    };
  }

  const count = geometry.getIndex()?.count ?? position.count;
  const triangleCount = Math.floor(count / 3);
  const triangles: UvTriangle[] = [];
  let degenerateTriangles = 0;
  let uvArea = 0;

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const indices = triangleIndices(geometry, triangle);
    const u = indices.map((index) => uv.getX(index)) as [number, number, number];
    const v = indices.map((index) => uv.getY(index)) as [number, number, number];
    if (![...u, ...v].every(Number.isFinite)) {
      notes.push('Ba’zi UV uchburchaklarida NaN/Infinity bor; ular overlap tahlilidan chiqarildi.');
      continue;
    }
    const area = Math.abs((u[1] - u[0]) * (v[2] - v[0]) - (u[2] - u[0]) * (v[1] - v[0])) / 2;
    uvArea += area;
    if (area <= UV_EPSILON) {
      degenerateTriangles += 1;
      continue;
    }
    triangles.push({
      indices,
      u,
      v,
      minU: Math.min(...u),
      maxU: Math.max(...u),
      minV: Math.min(...v),
      maxV: Math.max(...v),
      area,
    });
  }

  triangles.sort((left, right) => left.minU - right.minU);
  const active: UvTriangle[] = [];
  let overlapCandidates = 0;
  let testedPairs = 0;
  let comparisons = 0;
  let overlapCapped = false;

  outer: for (const triangle of triangles) {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].maxU < triangle.minU - UV_EPSILON) {
        active.splice(index, 1);
      }
    }
    for (const other of active) {
      comparisons += 1;
      if (comparisons > MAX_OVERLAP_COMPARISONS) {
        overlapCapped = true;
        notes.push(
          `Overlap tahlili ${MAX_OVERLAP_COMPARISONS} taqqoslashdan keyin to‘xtatildi; natija to‘liq emas.`,
        );
        break outer;
      }
      if (!aabbOverlap(triangle, other)) continue;
      // Shared vertices are legitimate seams/adjacent triangles; skip them.
      if (sharesVertex(triangle.indices, other.indices)) continue;
      testedPairs += 1;
      if (testedPairs > MAX_OVERLAP_PAIRS) {
        overlapCapped = true;
        notes.push(
          `Overlap tahlili ${MAX_OVERLAP_PAIRS} juftlikdan keyin to‘xtatildi; natija to‘liq emas.`,
        );
        break outer;
      }
      if (trianglesOverlap(triangle, other)) {
        overlapCandidates += 1;
      }
    }
    active.push(triangle);
  }

  if (triangles.length > 0 && overlapCandidates > 0) {
    notes.push(
      'Overlap taxminiy: tiled/procedural UV’larda bir xil tekstura maydonining takrorlanishi qonuniy bo‘lishi mumkin.',
    );
  }

  let texelDensity = null;
  if (
    typeof options.texturePixels === 'number' &&
    options.texturePixels > 0 &&
    typeof options.worldArea === 'number' &&
    options.worldArea > 0 &&
    uvArea > 0
  ) {
    const density = Math.sqrt((options.texturePixels * uvArea) / options.worldArea);
    texelDensity = {
      min: density,
      max: density,
      average: density,
      certainty: 'approximate' as const,
      unit: 'texels/cm' as const,
    };
    notes.push('Texel density taxminiy: UV maydoni va bitta base-colour tekstura o‘lchamidan hisoblandi.');
  } else {
    notes.push(
      'Texel density NOT VERIFIED: tekstura o‘lchami yoki world-space yuza yetarli emas.',
    );
  }

  return {
    geometryId: geometry.uuid,
    meshNames: options.meshNames ?? [],
    uvTriangles: triangleCount,
    degenerateTriangles,
    minU: base.minU,
    maxU: base.maxU,
    minV: base.minV,
    maxV: base.maxV,
    overlapCandidates,
    overlapStatus: overlapCapped ? 'not_verified' : triangles.length > 0 ? 'approximate' : 'not_verified',
    overlapCapped,
    texelDensity,
    notes,
  };
}
