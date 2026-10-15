/**
 * W8 geometry safety guard.
 *
 * Before writing any mesh format we verify that every exported vertex and every
 * object transform is finite. A single NaN/Infinity coordinate produces a corrupt
 * file that silently breaks downstream tools, so this is a hard check rather than
 * a warning.
 */
import * as THREE from 'three';
import { ExportError } from './exportTypes';

export interface GeometryIssue {
  objectName: string;
  reason: 'non_finite_vertex' | 'non_finite_transform';
}

function isFiniteVec3(v: { x: number; y: number; z: number }): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/** Collects non-finite vertices/transforms in the subtree (empty = safe). */
export function findGeometryIssues(root: THREE.Object3D): GeometryIssue[] {
  const issues: GeometryIssue[] = [];
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    if (!isFiniteVec3(child.position) || !isFiniteVec3(child.rotation) || !isFiniteVec3(child.scale)) {
      issues.push({ objectName: child.name || '(nomsiz)', reason: 'non_finite_transform' });
      return;
    }
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const position = (mesh.geometry as THREE.BufferGeometry | undefined)?.getAttribute?.('position');
    if (!position) {
      return;
    }
    const array = position.array as ArrayLike<number>;
    for (let i = 0; i < array.length; i += 1) {
      if (!Number.isFinite(array[i])) {
        issues.push({ objectName: mesh.name || '(nomsiz)', reason: 'non_finite_vertex' });
        return;
      }
    }
  });
  return issues;
}

/** Throws an `ExportError('invalid_geometry')` when the scene is unsafe to export. */
export function assertFiniteGeometry(root: THREE.Object3D): void {
  const issues = findGeometryIssues(root);
  if (issues.length > 0) {
    throw new ExportError('invalid_geometry', `Noto'g'ri geometriya: ${issues[0].objectName}.`);
  }
}
