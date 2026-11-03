import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  GEOMETRY_KERNEL_VERSION,
  GeometryKernelError,
  createGeometry,
  disposeGeometries,
  geometryStats,
  validateGeometry,
  type GeometryRecipe,
} from './index';

function expectValid(
  recipe: GeometryRecipe,
  expected?: {
    vertices?: number;
    triangles?: number;
    size?: [number, number, number];
    noDegenerate?: boolean;
  },
): THREE.BufferGeometry {
  const geometry = createGeometry(recipe);
  const result = validateGeometry(geometry);
  expect(result.errors, result.errors.join(' ')).toEqual([]);
  expect(result.valid).toBe(true);
  expect(result.vertexCount).toBeGreaterThan(0);
  expect(result.triangleCount).toBeGreaterThan(0);
  expect(result.hasNormals).toBe(true);
  expect(result.hasUv).toBe(true);
  if (expected?.noDegenerate) {
    expect(result.hasDegenerateTriangles).toBe(false);
  }
  expect(result.boundingBoxValid).toBe(true);
  if (expected?.vertices !== undefined) {
    expect(result.vertexCount).toBe(expected.vertices);
  }
  if (expected?.triangles !== undefined) {
    expect(result.triangleCount).toBe(expected.triangles);
  }
  if (expected?.size) {
    const box = geometry.boundingBox;
    expect(box).not.toBeNull();
    expect(box!.max.x - box!.min.x).toBeCloseTo(expected.size[0], 4);
    expect(box!.max.y - box!.min.y).toBeCloseTo(expected.size[1], 4);
    expect(box!.max.z - box!.min.z).toBeCloseTo(expected.size[2], 4);
  }
  return geometry;
}


function uvRange(geometry: THREE.BufferGeometry): { u: [number, number]; v: [number, number] } {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < uv.count; i += 1) {
    minU = Math.min(minU, uv.getX(i));
    maxU = Math.max(maxU, uv.getX(i));
    minV = Math.min(minV, uv.getY(i));
    maxV = Math.max(maxV, uv.getY(i));
  }
  return { u: [minU, maxU], v: [minV, maxV] };
}

function expectInvalid(recipe: GeometryRecipe, code = 'invalid_recipe'): void {
  expect(() => createGeometry(recipe)).toThrowError(GeometryKernelError);
  try {
    createGeometry(recipe);
  } catch (error) {
    expect((error as GeometryKernelError).code).toBe(code);
  }
}

describe('geometry kernel — primitives', () => {
  it('builds a plain box with the legacy triangle count and UVs', () => {
    const geometry = expectValid(
      { kind: 'box', width: 10, height: 4, depth: 2 },
      { vertices: 24, triangles: 12, size: [10, 4, 2], noDegenerate: true },
    );
    expect(geometry.userData.kernel).toMatchObject({
      version: GEOMETRY_KERNEL_VERSION,
      kind: 'box',
    });
  });

  it('builds a rounded box without degenerate geometry', () => {
    const geometry = expectValid(
      { kind: 'roundedBox', width: 10, height: 4, depth: 2, radius: 0.25, segments: 3 },
      { size: [10, 4, 2], noDegenerate: true },
    );
    expect(geometryStats(geometry).triangles).toBeGreaterThan(12);
  });

  it('builds a cylinder and keeps its bounds', () => {
    expectValid(
      { kind: 'cylinder', radiusTop: 2, radiusBottom: 2, height: 10, radialSegments: 16 },
      { size: [4, 10, 4], noDegenerate: true },
    );
  });

  it('builds a sphere and keeps its bounds', () => {
    expectValid(
      { kind: 'sphere', radius: 3, widthSegments: 16, heightSegments: 12 },
      { size: [6, 6, 6] },
    );
  });

  it('builds a capsule using the core CapsuleGeometry', () => {
    expectValid(
      { kind: 'capsule', radius: 1, length: 4, capSegments: 4, radialSegments: 12 },
      { size: [2, 6, 2] },
    );
  });
});

describe('geometry kernel — profiles', () => {
  it('extrudes a closed profile with optional holes', () => {
    expectValid(
      {
        kind: 'extrude',
        profile: [[0, 0], [10, 0], [10, 4], [0, 4]],
        depth: 2,
      },
      { size: [10, 4, 2], noDegenerate: true },
    );

    expectValid({
      kind: 'extrude',
      profile: [[0, 0], [10, 0], [10, 10], [0, 10]],
      holes: [[[3, 3], [5, 3], [5, 5], [3, 5]]],
      depth: 2,
    });
  });

  it('revolves a lathe profile', () => {
    expectValid(
      { kind: 'lathe', points: [[1, 0], [1, 2]], segments: 16 },
      { size: [2, 2, 2] },
    );
  });

  it('sweeps a tube along a curve', () => {
    expectValid(
      {
        kind: 'tube',
        points: [[0, 0, 0], [0, 0, 5], [0, 0, 10]],
        radius: 0.5,
        tubularSegments: 8,
        radialSegments: 8,
      },
      { size: [1, 1, 10], noDegenerate: true },
    );
  });
});

describe('geometry kernel — custom buffer geometry', () => {
  const tetra = {
    positions: [
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ],
    indices: [0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3],
  } as const;

  it('builds a custom mesh, computes normals and creates fallback UVs', () => {
    const geometry = expectValid(
      { kind: 'custom', ...tetra },
      { vertices: 4, triangles: 4, size: [1, 1, 1], noDegenerate: true },
    );
    expect(geometry.userData.uvSource).toBe('planar-fallback');
  });

  it('accepts explicit normals and UVs', () => {
    const normals = Array.from({ length: 12 }, () => 0);
    const uvs = [0, 0, 1, 0, 0, 1, 0, 0];
    expectValid({ kind: 'custom', ...tetra, normals, uvs });
  });
});

describe('geometry kernel — custom planar UV fallback', () => {
  const quad = (points: number[]) => ({
    kind: 'custom' as const,
    positions: points,
    indices: [0, 1, 2, 0, 2, 3],
  });

  it('uses X/Y for a flat XY geometry', () => {
    const geometry = createGeometry(quad([0, 0, 0, 10, 0, 0, 10, 5, 0, 0, 5, 0]));
    const range = uvRange(geometry);
    expect(range.u[1] - range.u[0]).toBeCloseTo(1, 5);
    expect(range.v[1] - range.v[0]).toBeCloseTo(1, 5);
    expect(geometry.userData.uvSource).toBe('planar-fallback');
    geometry.dispose();
  });

  it('uses X/Z for a flat XZ geometry', () => {
    const geometry = createGeometry(quad([0, 0, 0, 10, 0, 0, 10, 0, 5, 0, 0, 5]));
    const range = uvRange(geometry);
    expect(range.u[1] - range.u[0]).toBeCloseTo(1, 5);
    expect(range.v[1] - range.v[0]).toBeCloseTo(1, 5);
    geometry.dispose();
  });

  it('uses Y/Z for a flat YZ geometry', () => {
    const geometry = createGeometry(quad([0, 0, 0, 0, 10, 0, 0, 10, 5, 0, 0, 5]));
    const range = uvRange(geometry);
    expect(range.u[1] - range.u[0]).toBeCloseTo(1, 5);
    expect(range.v[1] - range.v[0]).toBeCloseTo(1, 5);
    geometry.dispose();
  });

  it('selects the two largest extents for a 3D geometry', () => {
    const geometry = createGeometry(
      quad([0, 0, 0, 10, 0, 0, 0, 20, 0, 0, 0, 2]),
    );
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    // Extents are Y=20, X=10, Z=2. Vertex (10,0,0) is U=0, V=1.
    expect(uv.getX(1)).toBeCloseTo(0, 6);
    expect(uv.getY(1)).toBeCloseTo(1, 6);
    expect(geometry.userData.uvSource).toBe('planar-fallback');
    geometry.dispose();
  });

  it('does not alter explicit UVs', () => {
    const uvs = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    const geometry = createGeometry({ ...quad([0, 0, 0, 10, 0, 0, 10, 5, 0, 0, 5, 0]), uvs });
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uvs.length; i += 1) {
      expect(uv.array[i]).toBeCloseTo(uvs[i], 6);
    }
    expect(geometry.userData.uvSource).toBe('provided');
    geometry.dispose();
  });

  it('keeps UV finite for a zero-extent degenerate geometry', () => {
    const geometry = createGeometry(
      { kind: 'custom', positions: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
      { rejectDegenerate: false },
    );
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count * 2; i += 1) {
      expect(Number.isFinite(uv.array[i])).toBe(true);
    }
    geometry.dispose();
  });
});

describe('geometry kernel — invalid recipes', () => {
  it('rejects non-finite, zero and negative dimensions', () => {
    expectInvalid({ kind: 'box', width: 0, height: 1, depth: 1 });
    expectInvalid({ kind: 'box', width: Number.NaN, height: 1, depth: 1 });
    expectInvalid({ kind: 'box', width: Number.POSITIVE_INFINITY, height: 1, depth: 1 });
    expectInvalid({ kind: 'box', width: -1, height: 1, depth: 1 });
  });

  it('rejects invalid segment counts', () => {
    expectInvalid({ kind: 'box', width: 1, height: 1, depth: 1, widthSegments: 0 });
    expectInvalid({ kind: 'roundedBox', width: 2, height: 2, depth: 2, radius: 0.2, segments: 0 });
    expectInvalid({ kind: 'cylinder', radiusTop: 1, radiusBottom: 1, height: 1, radialSegments: 2 });
    expectInvalid({ kind: 'sphere', radius: 1, widthSegments: 2 });
    expectInvalid({ kind: 'capsule', radius: 1, length: 1, capSegments: 0 });
  });

  it('rejects an oversized rounded-box radius', () => {
    expectInvalid({ kind: 'roundedBox', width: 2, height: 2, depth: 2, radius: 1.1 });
  });

  it('rejects a profile with fewer than three points, zero area or a self-intersection', () => {
    expectInvalid({ kind: 'extrude', profile: [[0, 0], [1, 1]], depth: 1 });
    expectInvalid({ kind: 'extrude', profile: [[0, 0], [1, 0], [2, 0]], depth: 1 });
    expectInvalid({
      kind: 'extrude',
      profile: [[0, 0], [2, 2], [0, 2], [2, 0]],
      depth: 1,
    });
  });

  it('rejects a hole outside the outer profile', () => {
    expectInvalid({
      kind: 'extrude',
      profile: [[0, 0], [4, 0], [4, 4], [0, 4]],
      holes: [[[10, 10], [11, 10], [11, 11], [10, 11]]],
      depth: 1,
    });
  });

  it('rejects invalid lathe and tube parameters', () => {
    expectInvalid({ kind: 'lathe', points: [[-1, 0], [1, 2]] });
    expectInvalid({ kind: 'lathe', points: [[0, 0], [0, 2]] });
    expectInvalid({ kind: 'lathe', points: [[1, 0], [1, 2]], segments: 2 });
    expectInvalid({ kind: 'tube', points: [[0, 0, 0]], radius: 1 });
    expectInvalid({ kind: 'tube', points: [[0, 0, 0], [0, 0, 1]], radius: 0 });
  });

  it('rejects malformed custom geometry', () => {
    expectInvalid({ kind: 'custom', positions: [0, 0, 0, 1, 0] });
    expectInvalid({
      kind: 'custom',
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      indices: [0, 1, 3],
    });
    expectInvalid({ kind: 'custom', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [1, 0] });
    expectInvalid({ kind: 'custom', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], uvs: [0, 1] });
  });

  it('rejects a geometry that exceeds its budget', () => {
    for (const budget of [{ maxVertices: 1 }, { maxTriangles: 1 }]) {
      try {
        createGeometry({ kind: 'box', width: 1, height: 1, depth: 1 }, budget);
        throw new Error('expected budget failure');
      } catch (error) {
        expect(error).toBeInstanceOf(GeometryKernelError);
        expect((error as GeometryKernelError).code).toBe('budget_exceeded');
      }
    }
  });
});

describe('geometry kernel — disposal', () => {
  it('disposes every geometry in a supplied list', () => {
    const a = createGeometry({ kind: 'box', width: 1, height: 1, depth: 1 });
    const b = createGeometry({ kind: 'sphere', radius: 1 });
    const aSpy = vi.spyOn(a, 'dispose');
    const bSpy = vi.spyOn(b, 'dispose');
    disposeGeometries([a, b]);
    expect(aSpy).toHaveBeenCalledOnce();
    expect(bSpy).toHaveBeenCalledOnce();
  });
});
