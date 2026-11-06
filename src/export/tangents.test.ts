import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  addTangentsToGeometry,
  ensureTangentsForNormalMappedMeshes,
  sanitizeTangentAttribute,
} from './tangents';

const NORMAL_UVS = [0, 0, 1, 0, 1, 1, 0, 1];
const MIRRORED_UVS = [1, 0, 0, 0, 0, 1, 1, 1];

function indexedPlane(uvs: readonly number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
  );
  geometry.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([...uvs], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

function readTangents(geometry: THREE.BufferGeometry): number[][] {
  const tangent = geometry.getAttribute('tangent') as THREE.BufferAttribute | undefined;
  if (!tangent) return [];
  const values: number[][] = [];
  for (let index = 0; index < tangent.count; index += 1) {
    values.push([tangent.getX(index), tangent.getY(index), tangent.getZ(index), tangent.getW(index)]);
  }
  return values;
}

function expectValidTangents(geometry: THREE.BufferGeometry): void {
  const tangents = readTangents(geometry);
  expect(tangents.length).toBeGreaterThan(0);
  for (const [x, y, z, w] of tangents) {
    expect(Number.isFinite(x), 'tangent x').toBe(true);
    expect(Number.isFinite(y), 'tangent y').toBe(true);
    expect(Number.isFinite(z), 'tangent z').toBe(true);
    expect(Math.hypot(x, y, z), 'unit length').toBeCloseTo(1, 5);
    expect(Math.abs(w), 'w is a handedness sign').toBe(1);
  }
}

describe('tangent generation', () => {
  it('can index a non-indexed mesh before tangents when explicitly requested', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0],
        3,
      ),
    );
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(
        [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
        3,
      ),
    );
    geometry.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2),
    );

    expect(addTangentsToGeometry(geometry).reason).toBe('non-indexed');
    const result = addTangentsToGeometry(geometry, { indexNonIndexed: true });

    expect(result.applied).toBe(true);
    expect(geometry.getIndex()?.count).toBe(6);
    expectValidTangents(geometry);
  });

  it('adds a four-component TANGENT attribute to an indexed mesh', () => {
    const geometry = indexedPlane(NORMAL_UVS);
    const result = addTangentsToGeometry(geometry);

    expect(result.applied).toBe(true);
    const tangent = geometry.getAttribute('tangent') as THREE.BufferAttribute;
    expect(tangent.itemSize).toBe(4);
    expect(tangent.count).toBe(4);
    expectValidTangents(geometry);
  });

  it('handles mirrored UV orientation with the opposite tangent and W sign', () => {
    const normal = indexedPlane(NORMAL_UVS);
    const mirrored = indexedPlane(MIRRORED_UVS);
    addTangentsToGeometry(normal);
    addTangentsToGeometry(mirrored);

    const normalTangent = readTangents(normal)[0];
    const mirroredTangent = readTangents(mirrored)[0];
    expect(normalTangent[0]).toBeCloseTo(1, 5);
    expect(normalTangent[3]).toBe(1);
    expect(mirroredTangent[0]).toBeCloseTo(-1, 5);
    expect(mirroredTangent[3]).toBe(-1);
    expectValidTangents(normal);
    expectValidTangents(mirrored);
  });

  it('repairs zero and non-finite tangents instead of emitting invalid data', () => {
    const geometry = indexedPlane(NORMAL_UVS);
    geometry.setAttribute(
      'tangent',
      new THREE.Float32BufferAttribute(
        [
          Number.NaN, 0, 0, 0,
          0, 0, 0, 1,
          2, 0, 0, 0.5,
        ],
        4,
      ),
    );

    const corrected = sanitizeTangentAttribute(geometry);
    expect(corrected).toBe(3);
    expectValidTangents(geometry);
  });

  it('produces valid tangents for degenerate UV triangles', () => {
    const geometry = indexedPlane([0, 0, 0, 0, 0, 0, 0, 0]);
    const result = addTangentsToGeometry(geometry);

    expect(result.applied).toBe(true);
    expect(result.sanitizedVertices).toBeGreaterThan(0);
    expectValidTangents(geometry);
  });

  it('leaves position, normal and UV data unchanged', () => {
    const geometry = indexedPlane(NORMAL_UVS);
    const position = Array.from(geometry.getAttribute('position').array);
    const normal = Array.from(geometry.getAttribute('normal').array);
    const uv = Array.from(geometry.getAttribute('uv').array);

    addTangentsToGeometry(geometry);

    expect(Array.from(geometry.getAttribute('position').array)).toEqual(position);
    expect(Array.from(geometry.getAttribute('normal').array)).toEqual(normal);
    expect(Array.from(geometry.getAttribute('uv').array)).toEqual(uv);
  });

  it('does not touch a geometry that already has tangents', () => {
    const geometry = indexedPlane(NORMAL_UVS);
    geometry.setAttribute(
      'tangent',
      new THREE.Float32BufferAttribute([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1], 4),
    );
    const before = readTangents(geometry);

    const result = addTangentsToGeometry(geometry);

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('already-present');
    expect(readTangents(geometry)).toEqual(before);
  });

  it('skips non-indexed geometry rather than inventing an index', () => {
    const geometry = indexedPlane(NORMAL_UVS).toNonIndexed();
    const result = addTangentsToGeometry(geometry);

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('non-indexed');
    expect(geometry.getAttribute('tangent')).toBeUndefined();
  });

  it('skips geometry whose normal or UV count does not match position', () => {
    const geometry = indexedPlane(NORMAL_UVS);
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0], 2));

    const result = addTangentsToGeometry(geometry);

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('missing-attributes');
    expect(geometry.getAttribute('tangent')).toBeUndefined();
  });

  it('adds tangents only to normal-mapped meshes', () => {
    const root = new THREE.Group();
    const normalMap = new THREE.Texture();
    const normalMaterial = new THREE.MeshStandardMaterial();
    normalMaterial.normalMap = normalMap;
    const plainMaterial = new THREE.MeshStandardMaterial();
    const normalMesh = new THREE.Mesh(indexedPlane(NORMAL_UVS), normalMaterial);
    const plainMesh = new THREE.Mesh(indexedPlane(NORMAL_UVS), plainMaterial);
    normalMesh.name = 'normal-mapped';
    plainMesh.name = 'plain';
    root.add(normalMesh, plainMesh);

    const report = ensureTangentsForNormalMappedMeshes(root);

    expect(report.meshesUsingNormalMap).toBe(1);
    expect(report.tangentsGenerated).toBe(1);
    expect(report.skippedNoNormalMap).toBe(1);
    expect(normalMesh.geometry.getAttribute('tangent')).toBeTruthy();
    expect(plainMesh.geometry.getAttribute('tangent')).toBeUndefined();
    expect(normalMesh.material).toBe(normalMaterial);
    expect(normalMaterial.normalMap).toBe(normalMap);
  });
});
