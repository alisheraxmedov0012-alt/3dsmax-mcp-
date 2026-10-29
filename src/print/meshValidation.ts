/**
 * B1/B3 — print-geometry checks that can be made honestly from the mesh alone.
 *
 * This is deliberately not a slicer and not a manufacturability certificate.
 * It checks the topology of each mesh (closed boundary, manifold edges,
 * degenerate triangles) and reports the measured size in millimetres. Wall
 * thickness, self-intersection, orientation and supports need information this
 * model does not carry, so they stay explicit "not verified" limitations.
 */
import * as THREE from 'three';

export interface PrintMeshReport {
  meshes: number;
  triangles: number;
  closedMeshes: number;
  openMeshes: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  degenerateTriangles: number;
  /** True only when every mesh is closed, manifold and free of degenerate faces. */
  watertight: boolean;
  /** Measured world-space size in millimetres, or null when there is no mesh. */
  sizeMm: { x: number; y: number; z: number } | null;
  limitations: string[];
}

export const PRINT_GEOMETRY_LIMITATIONS: readonly string[] = [
  'Devor qalinligi va minimal feature size tekshirilmagan — printer va material ma’lumoti yo‘q.',
  "Self-intersection va ichki bo‘shliqlar tekshirilmagan.",
  "Har bir mesh alohida tekshiriladi; qismlar birlashmasi boolean union emas.",
  "Orientation, support va slicer sozlamalari tekshirilmagan.",
  'Bu hisobot 3D-print kafolati yoki ishlab chiqarish sertifikati emas.',
];

const WELD_DECIMALS = 4;
const EPSILON_AREA = 1e-10;

function vertexKey(x: number, y: number, z: number): string {
  return `${x.toFixed(WELD_DECIMALS)},${y.toFixed(WELD_DECIMALS)},${z.toFixed(WELD_DECIMALS)}`;
}

function triangleArea(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  return (
    new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a))
      .length() / 2
  );
}

function analyseMesh(geometry: THREE.BufferGeometry): {
  triangles: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  degenerateTriangles: number;
  closed: boolean;
} {
  const position = geometry.getAttribute('position');
  if (!position) {
    return {
      triangles: 0,
      boundaryEdges: 0,
      nonManifoldEdges: 0,
      degenerateTriangles: 0,
      closed: false,
    };
  }

  const index = geometry.getIndex();
  const indices: number[] = [];
  if (index) {
    for (let i = 0; i < index.count; i += 1) indices.push(index.getX(i));
  } else {
    for (let i = 0; i < position.count; i += 1) indices.push(i);
  }

  const keys = new Map<string, number>();
  const positions: THREE.Vector3[] = [];
  const keyFor = (indexValue: number): number => {
    const x = position.getX(indexValue);
    const y = position.getY(indexValue);
    const z = position.getZ(indexValue);
    const key = vertexKey(x, y, z);
    const existing = keys.get(key);
    if (existing !== undefined) return existing;
    const id = positions.length;
    keys.set(key, id);
    positions.push(new THREE.Vector3(x, y, z));
    return id;
  };

  const edges = new Map<string, number>();
  let degenerateTriangles = 0;
  const triangles = Math.floor(indices.length / 3);

  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const a = keyFor(indices[triangle * 3]);
    const b = keyFor(indices[triangle * 3 + 1]);
    const c = keyFor(indices[triangle * 3 + 2]);
    if (
      a === b ||
      b === c ||
      a === c ||
      triangleArea(positions[a], positions[b], positions[c]) <= EPSILON_AREA
    ) {
      degenerateTriangles += 1;
      continue;
    }
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const count of edges.values()) {
    if (count === 1) boundaryEdges += 1;
    else if (count > 2) nonManifoldEdges += 1;
  }

  return {
    triangles,
    boundaryEdges,
    nonManifoldEdges,
    degenerateTriangles,
    closed:
      triangles > 0 &&
      boundaryEdges === 0 &&
      nonManifoldEdges === 0 &&
      degenerateTriangles === 0,
  };
}

/**
 * Inspect every mesh under `root`. The caller owns `root` and should dispose it
 * afterwards; this function only reads geometry.
 */
export function analyzePrintGeometry(root: THREE.Object3D): PrintMeshReport {
  root.updateMatrixWorld(true);
  let meshes = 0;
  let triangles = 0;
  let closedMeshes = 0;
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let degenerateTriangles = 0;

  root.traverse((node) => {
    if (!(node as THREE.Mesh).isMesh) return;
    const mesh = node as THREE.Mesh;
    const result = analyseMesh(mesh.geometry as THREE.BufferGeometry);
    meshes += 1;
    triangles += result.triangles;
    boundaryEdges += result.boundaryEdges;
    nonManifoldEdges += result.nonManifoldEdges;
    degenerateTriangles += result.degenerateTriangles;
    if (result.closed) closedMeshes += 1;
  });

  const box = new THREE.Box3().setFromObject(root);
  const sizeMm =
    meshes > 0 && !box.isEmpty()
      ? {
          x: Math.round((box.max.x - box.min.x) * 10),
          y: Math.round((box.max.y - box.min.y) * 10),
          z: Math.round((box.max.z - box.min.z) * 10),
        }
      : null;

  return {
    meshes,
    triangles,
    closedMeshes,
    openMeshes: meshes - closedMeshes,
    boundaryEdges,
    nonManifoldEdges,
    degenerateTriangles,
    watertight: meshes > 0 && closedMeshes === meshes,
    sizeMm,
    limitations: [...PRINT_GEOMETRY_LIMITATIONS],
  };
}
