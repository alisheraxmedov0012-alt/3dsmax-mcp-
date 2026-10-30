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

describe('geometry guard — topology checks', () => {
  function triangle(options: {
    positions?: number[];
    index?: number[];
    normal?: number[];
  } = {}): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    const positions = options.positions ?? [0, 0, 0, 10, 0, 0, 0, 10, 0];
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (options.index) geometry.setIndex(options.index);
    if (options.normal) {
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(options.normal, 3));
    }
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    mesh.name = 'probe';
    return mesh;
  }

  it('accepts a valid indexed triangle and a valid non-indexed triangle', () => {
    expect(findGeometryIssues(triangle({ index: [0, 1, 2] }))).toEqual([]);
    expect(findGeometryIssues(triangle())).toEqual([]);
  });

  it('does not require normals; missing normals are allowed', () => {
    expect(findGeometryIssues(triangle({ index: [0, 1, 2] }))).toEqual([]);
  });

  it('rejects an index outside the vertex range', () => {
    const issues = findGeometryIssues(triangle({ index: [0, 1, 99] }));
    expect(issues[0].reason).toBe('invalid_index');
  });

  it('rejects a degenerate triangle', () => {
    const issues = findGeometryIssues(
      triangle({ positions: [0, 0, 0, 1, 0, 0, 2, 0, 0], index: [0, 1, 2] }),
    );
    expect(issues[0].reason).toBe('degenerate_triangle');
  });

  it('rejects a non-finite or mismatched normal attribute', () => {
    const finite = triangle({ index: [0, 1, 2], normal: [0, 0, 1, 0, 0, 1, 0, 0, 1] });
    expect(findGeometryIssues(finite)).toEqual([]);

    const nan = triangle({ index: [0, 1, 2], normal: [0, 0, 1, 0, 0, Number.NaN, 0, 0, 1] });
    expect(findGeometryIssues(nan)[0].reason).toBe('non_finite_normal');

    const short = triangle({ index: [0, 1, 2], normal: [0, 0, 1, 0, 0, 1] });
    expect(findGeometryIssues(short)[0].reason).toBe('invalid_attribute_count');
  });

  it('rejects an indexed geometry with an empty index', () => {
    const issues = findGeometryIssues(triangle({ index: [] }));
    expect(issues[0].reason).toBe('invalid_triangle_count');
  });

  it('rejects a non-indexed geometry that cannot form a triangle', () => {
    const issues = findGeometryIssues(triangle({ positions: [0, 0, 0, 10, 0, 0] }));
    expect(issues[0].reason).toBe('invalid_triangle_count');
  });

  it('rejects triangle counts that cannot form triangles', () => {
    const issues = findGeometryIssues(triangle({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 2, 2] }));
    expect(issues[0].reason).toBe('invalid_triangle_count');
  });

  it('rejects a mesh with no position attribute but keeps an empty scene export separate', () => {
    const geometry = new THREE.BufferGeometry();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    mesh.name = 'empty-mesh';
    const scene = new THREE.Scene();
    scene.add(mesh);
    expect(findGeometryIssues(scene)[0].reason).toBe('missing_position');
  });
});
