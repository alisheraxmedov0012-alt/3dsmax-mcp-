import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GeometryKernelError, createGeometry, validateGeometry } from './index';
import { validateDegenerate } from './validation/validateDegenerate';
import { validateNormals } from './validation/validateNormals';

describe('geometry validation — normals', () => {
  it('reports a missing normal attribute', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.deleteAttribute('normal');
    const result = validateNormals(geometry);
    expect(result.valid).toBe(false);
    expect(result.hasNormals).toBe(false);
    expect(result.errors.join(' ')).toContain('normal');
  });

  it('reports non-finite normals', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
    normal.setXYZ(0, Number.NaN, 0, 1);
    const result = validateNormals(geometry);
    expect(result.valid).toBe(false);
    expect(result.nonFinite).toBe(1);
  });

  it('warns about zero-length and non-unit normals without rejecting them', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < normal.count; i += 1) {
      normal.setXYZ(i, 0, 0, 0);
    }
    const result = validateNormals(geometry);
    expect(result.valid).toBe(true);
    expect(result.zeroLength).toBe(normal.count);
  });
});

describe('geometry validation — degenerate triangles', () => {
  it('detects zero-area triangles', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]), 3),
    );
    const result = validateDegenerate(geometry);
    expect(result.valid).toBe(true);
    expect(result.hasDegenerateTriangles).toBe(true);
    expect(result.degenerateTriangles).toBe(1);
  });

  it('rejects invalid indices', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    geometry.setIndex([0, 1, 5]);
    const result = validateDegenerate(geometry);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('index');
  });

  it('rejects a custom recipe with a degenerate triangle at the factory boundary', () => {
    expect(() =>
      createGeometry({
        kind: 'custom',
        positions: [0, 0, 0, 1, 0, 0, 2, 0, 0],
      }, { rejectDegenerate: true }),
    ).toThrowError(GeometryKernelError);
  });

  it('can keep a degenerate geometry when explicitly allowed', () => {
    const geometry = createGeometry(
      { kind: 'custom', positions: [0, 0, 0, 1, 0, 0, 2, 0, 0] },
    );
    expect(geometry.getAttribute('position').count).toBe(3);
    geometry.dispose();
  });
});

describe('geometry validation — structural', () => {
  it('rejects missing normals and UVs by default', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');
    const result = validateGeometry(geometry);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('normal');
    expect(result.errors.join(' ')).toContain('uv');
  });

  it('reports pole degeneracy for capsule geometry as a warning', () => {
    const geometry = createGeometry({
      kind: 'capsule',
      radius: 1,
      length: 4,
      capSegments: 4,
      radialSegments: 12,
    });
    const result = validateGeometry(geometry);
    expect(result.valid).toBe(true);
    expect(result.hasDegenerateTriangles).toBe(true);
    expect(result.warnings.join(' ')).toContain('degenerativ');
    geometry.dispose();
  });

  it('can opt out of normal and UV requirements', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');
    const result = validateGeometry(geometry, { requireNormals: false, requireUv: false });
    expect(result.valid).toBe(true);
    expect(result.hasNormals).toBe(false);
    expect(result.hasUv).toBe(false);
  });

  it('rejects an empty geometry', () => {
    const geometry = new THREE.BufferGeometry();
    const result = validateGeometry(geometry);
    expect(result.valid).toBe(false);
    expect(result.vertexCount).toBe(0);
    expect(result.triangleCount).toBe(0);
  });
});
