import type * as THREE from 'three';
import {
  GEOMETRY_LIMITS,
  GeometryKernelError,
  type GeometryStats,
} from '../types';

export interface GeometryBudget {
  readonly maxVertices?: number;
  readonly maxTriangles?: number;
}

/** Cheap counts used before a geometry enters the scene or an export. */
export function geometryStats(geometry: THREE.BufferGeometry): GeometryStats {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const vertices = position?.count ?? 0;
  const triangles = index ? index.count / 3 : vertices / 3;
  return { vertices, triangles, indexed: Boolean(index) };
}

/** Reject a part that exceeds the per-object budget instead of degrading the GPU. */
export function assertGeometryBudget(
  geometry: THREE.BufferGeometry,
  budget: GeometryBudget = {},
): GeometryStats {
  const stats = geometryStats(geometry);
  const maxVertices = budget.maxVertices ?? GEOMETRY_LIMITS.maxVertices;
  const maxTriangles = budget.maxTriangles ?? GEOMETRY_LIMITS.maxTriangles;
  if (stats.vertices > maxVertices) {
    throw new GeometryKernelError(
      'budget_exceeded',
      `Geometry vertex budjeti oshib ketdi: ${stats.vertices} > ${maxVertices}.`,
    );
  }
  if (stats.triangles > maxTriangles) {
    throw new GeometryKernelError(
      'budget_exceeded',
      `Geometry triangle budjeti oshib ketdi: ${stats.triangles} > ${maxTriangles}.`,
    );
  }
  return stats;
}

/** Dispose a list in one place; callers own the geometries they pass in. */
export function disposeGeometries(
  geometries: readonly (THREE.BufferGeometry | null | undefined)[],
): void {
  for (const geometry of geometries) {
    geometry?.dispose();
  }
}
