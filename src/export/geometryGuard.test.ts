import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { assertFiniteGeometry, findGeometryIssues } from './geometryGuard';
import { ExportError } from './exportTypes';

function boxMesh(name: string, vertices?: number[]): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(10, 10, 10);
  if (vertices) {
    const attribute = geometry.getAttribute('position');
    vertices.forEach((value, index) => attribute.setX(index, value));
  }
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = name;
  return mesh;
}

describe('findGeometryIssues', () => {
  it('reports nothing for a normal scene', () => {
    const scene = new THREE.Scene();
    scene.add(boxMesh('box'));
    expect(findGeometryIssues(scene)).toEqual([]);
  });

  it('detects a non-finite vertex', () => {
    const scene = new THREE.Scene();
    scene.add(boxMesh('bad', [Number.NaN]));
    const issues = findGeometryIssues(scene);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual({ objectName: 'bad', reason: 'non_finite_vertex' });
  });

  it('detects a non-finite transform', () => {
    const scene = new THREE.Scene();
    const mesh = boxMesh('moved');
    mesh.position.set(Number.POSITIVE_INFINITY, 0, 0);
    scene.add(mesh);
    const issues = findGeometryIssues(scene);
    expect(issues.some((issue) => issue.reason === 'non_finite_transform')).toBe(true);
  });

  it('detects issues in nested children', () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.add(boxMesh('nested', [0, Number.NEGATIVE_INFINITY]));
    scene.add(group);
    expect(findGeometryIssues(scene).length).toBeGreaterThan(0);
  });
});

describe('assertFiniteGeometry', () => {
  it('passes for a finite scene', () => {
    const scene = new THREE.Scene();
    scene.add(boxMesh('ok'));
    expect(() => assertFiniteGeometry(scene)).not.toThrow();
  });

  it('throws a typed ExportError for a broken scene', () => {
    const scene = new THREE.Scene();
    scene.add(boxMesh('bad', [Number.NaN]));
    expect(() => assertFiniteGeometry(scene)).toThrow(ExportError);
    try {
      assertFiniteGeometry(scene);
    } catch (error) {
      expect((error as ExportError).code).toBe('invalid_geometry');
    }
  });
});
