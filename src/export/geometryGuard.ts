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
  reason:
    | 'non_finite_vertex'
    | 'non_finite_transform'
    | 'missing_position'
    | 'invalid_index'
    | 'invalid_triangle_count'
    | 'invalid_attribute_count'
    | 'non_finite_normal'
    | 'degenerate_triangle'
    | 'invalid_bounds';
}

function isFiniteVec3(v: { x: number; y: number; z: number }): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function finiteAttribute(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): boolean {
  for (let index = 0; index < attribute.count; index += 1) {
    if (
      !Number.isFinite(attribute.getX(index)) ||
      !Number.isFinite(attribute.getY(index)) ||
      !Number.isFinite(attribute.getZ(index))
    ) {
      return false;
    }
  }
  return true;
}

function triangleIsDegenerate(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  a: number,
  b: number,
  c: number,
): boolean {
  const ax = position.getX(a);
  const ay = position.getY(a);
  const az = position.getZ(a);
  const bx = position.getX(b);
  const by = position.getY(b);
  const bz = position.getZ(b);
  const cx = position.getX(c);
  const cy = position.getY(c);
  const cz = position.getZ(c);
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  return Math.hypot(nx, ny, nz) / 2 <= 1e-10;
}

/** Collects geometry issues in the subtree (empty = safe to export). */
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
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    const position = geometry?.getAttribute?.('position') as
      | THREE.BufferAttribute
      | THREE.InterleavedBufferAttribute
      | undefined;
    if (!position || position.count === 0) {
      issues.push({ objectName: mesh.name || '(nomsiz)', reason: 'missing_position' });
      return;
    }
    if (!finiteAttribute(position)) {
      issues.push({ objectName: mesh.name || '(nomsiz)', reason: 'non_finite_vertex' });
      return;
    }

    const index = geometry?.getIndex();
    if (index) {
      // An empty index is not a triangle mesh: positions may exist, but nothing
      // can be exported as a face. Reject it before any exporter sees it.
      if (index.count === 0 || index.count % 3 !== 0) {
        issues.push({ objectName: mesh.name || '(nomsiz)', reason: 'invalid_triangle_count' });
        return;
      }
      for (let i = 0; i < index.count; i += 1) {
        const value = index.getX(i);
        if (!Number.isInteger(value) || value < 0 || value >= position.count) {
          issues.push({ objectName: mesh.name || '(nomsiz)', reason: 'invalid_index' });
          return;
        }
      }
    } else if (position.count % 3 !== 0) {
      issues.push({ objectName: mesh.name || '(nomsiz)', reason: 'invalid_triangle_count' });
      return;
    }

    const normal = geometry?.getAttribute?.('normal') as
      | THREE.BufferAttribute
      | THREE.InterleavedBufferAttribute
      | undefined;
    if (normal) {
      if (normal.count !== position.count) {
        issues.push({ objectName: mesh.name || '(nomsiz)', reason: 'invalid_attribute_count' });
        return;
      }
      if (!finiteAttribute(normal)) {
        issues.push({ objectName: mesh.name || '(nomsiz)', reason: 'non_finite_normal' });
        return;
      }
    }

    if (geometry) {
      const box = new THREE.Box3();
      try {
        box.setFromBufferAttribute(position as THREE.BufferAttribute);
      } catch {
        issues.push({ objectName: mesh.name || '(nomsiz)', reason: 'invalid_bounds' });
        return;
      }
      if (
        box.isEmpty() ||
        ![box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every((value) =>
          Number.isFinite(value),
        )
      ) {
        issues.push({ objectName: mesh.name || '(nomsiz)', reason: 'invalid_bounds' });
        return;
      }
    }

    const triangleCount = index ? index.count / 3 : position.count / 3;
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const a = index ? index.getX(triangle * 3) : triangle * 3;
      const b = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
      const c = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
      if (triangleIsDegenerate(position, a, b, c)) {
        issues.push({ objectName: mesh.name || '(nomsiz)', reason: 'degenerate_triangle' });
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
