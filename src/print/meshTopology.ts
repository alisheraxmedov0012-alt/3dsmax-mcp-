/**
 * B1 — topology analysis of one mesh.
 *
 * The checks here are deliberately honest about what edge incidence can prove:
 * edge incidence detects boundaries, non-manifold edges and inconsistent winding
 * for triangle meshes. It does **not** prove manifoldness at vertices, absence of
 * self-intersections, or that separate parts do not overlap. Those remain
 * `NOT_CHECKED` in the report.
 */
import * as THREE from 'three';

const WELD_SCALE = 100000; // five decimal places of a centimetre
const EPSILON_AREA_CM2 = 1e-10;

export interface MeshTopology {
  name: string;
  triangles: number;
  vertices: number;
  weldedVertices: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  degenerateTriangles: number;
  duplicateTriangles: number;
  inconsistentWindingEdges: number;
  components: number;
  closed: boolean;
  manifold: boolean;
  /** True when the index buffer is not a whole number of triangles. */
  incompleteTriangles: boolean;
  /** Finite, in-range vertices. */
  finite: boolean;
  nonFiniteVertices: number;
  invalidIndices: number;
  missingNormals: boolean;
  invalidNormals: number;
  /** Triangles whose average vertex normal points opposite the face normal. */
  opposedNormals: number;
  /** Local signed volume in cm³; only meaningful for a closed mesh. */
  signedVolumeCm3: number | null;
  /** Signed volume magnitude in mm³, after the world transform's scale. */
  volumeMm3: number | null;
  inverted: boolean;
  negativeScale: boolean;
  bounds: THREE.Box3 | null;
}

function emptyTopology(name: string): MeshTopology {
  return {
    name,
    triangles: 0,
    vertices: 0,
    weldedVertices: 0,
    boundaryEdges: 0,
    nonManifoldEdges: 0,
    degenerateTriangles: 0,
    duplicateTriangles: 0,
    inconsistentWindingEdges: 0,
    components: 0,
    closed: false,
    manifold: false,
    incompleteTriangles: false,
    finite: true,
    nonFiniteVertices: 0,
    invalidIndices: 0,
    missingNormals: false,
    invalidNormals: 0,
    opposedNormals: 0,
    signedVolumeCm3: null,
    volumeMm3: null,
    inverted: false,
    negativeScale: false,
    bounds: null,
  };
}

function weldKey(x: number, y: number, z: number): string {
  return `${Math.round(x * WELD_SCALE)},${Math.round(y * WELD_SCALE)},${Math.round(z * WELD_SCALE)}`;
}

class UnionFind {
  private readonly parent = new Map<number, number>();

  add(value: number): void {
    if (!this.parent.has(value)) {
      this.parent.set(value, value);
    }
  }

  find(value: number): number {
    const parent = this.parent.get(value);
    if (parent === undefined || parent === value) {
      return value;
    }
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this.parent.set(rootB, rootA);
    }
  }

  componentCount(): number {
    const roots = new Set<number>();
    for (const value of this.parent.keys()) {
      roots.add(this.find(value));
    }
    return roots.size;
  }
}

/** Inspect one mesh. The caller must have updated world matrices. */
export function analyzeMeshTopology(mesh: THREE.Mesh, fallbackName: string): MeshTopology {
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
  const name = mesh.name || fallbackName;
  const report = emptyTopology(name);

  const position = geometry?.getAttribute?.('position') as
    | THREE.BufferAttribute
    | THREE.InterleavedBufferAttribute
    | undefined;
  if (!position || position.count === 0) {
    report.missingNormals = true;
    return report;
  }
  report.vertices = position.count;

  const bounds = new THREE.Box3().setFromObject(mesh);
  const finiteBounds = [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].every(
    (value) => Number.isFinite(value),
  );
  report.bounds = bounds.isEmpty() || !finiteBounds ? null : bounds;
  report.negativeScale = mesh.matrixWorld.determinant() < 0;

  for (let index = 0; index < position.count; index += 1) {
    if (
      !Number.isFinite(position.getX(index)) ||
      !Number.isFinite(position.getY(index)) ||
      !Number.isFinite(position.getZ(index))
    ) {
      report.nonFiniteVertices += 1;
    }
  }
  if (report.nonFiniteVertices > 0) {
    report.finite = false;
    return report;
  }

  const indexAttribute = geometry?.getIndex();
  const indices: number[] = [];
  if (indexAttribute) {
    for (let i = 0; i < indexAttribute.count; i += 1) {
      indices.push(indexAttribute.getX(i));
    }
  } else {
    for (let i = 0; i < position.count; i += 1) indices.push(i);
  }
  report.incompleteTriangles = indices.length % 3 !== 0;
  report.triangles = Math.floor(indices.length / 3);

  for (const value of indices) {
    if (!Number.isInteger(value) || value < 0 || value >= position.count) {
      report.invalidIndices += 1;
    }
  }

  const normal = geometry?.getAttribute?.('normal') as
    | THREE.BufferAttribute
    | THREE.InterleavedBufferAttribute
    | undefined;
  if (!normal) {
    report.missingNormals = true;
  } else {
    if (normal.count !== position.count) {
      report.invalidNormals += Math.abs(normal.count - position.count);
    }
    for (let i = 0; i < normal.count; i += 1) {
      if (
        !Number.isFinite(normal.getX(i)) ||
        !Number.isFinite(normal.getY(i)) ||
        !Number.isFinite(normal.getZ(i))
      ) {
        report.invalidNormals += 1;
      }
    }
  }

  if (report.invalidIndices > 0 || report.incompleteTriangles) {
    // Topology built from invalid indices would be meaningless.
    return report;
  }

  const weldedIds = new Map<string, number>();
  const positions: THREE.Vector3[] = [];
  const idFor = (vertexIndex: number): number => {
    const x = position.getX(vertexIndex);
    const y = position.getY(vertexIndex);
    const z = position.getZ(vertexIndex);
    const key = weldKey(x, y, z);
    const existing = weldedIds.get(key);
    if (existing !== undefined) return existing;
    const id = positions.length;
    weldedIds.set(key, id);
    positions.push(new THREE.Vector3(x, y, z));
    return id;
  };

  const edgeUse = new Map<string, number>();
  const directedUse = new Map<string, number>();
  const triangleKeys = new Set<string>();
  const unionFind = new UnionFind();
  let signedVolumeCm3 = 0;

  for (let triangle = 0; triangle < report.triangles; triangle += 1) {
    const a = idFor(indices[triangle * 3]);
    const b = idFor(indices[triangle * 3 + 1]);
    const c = idFor(indices[triangle * 3 + 2]);

    const pa = positions[a];
    const pb = positions[b];
    const pc = positions[c];
    const crossX = (pb.y - pa.y) * (pc.z - pa.z) - (pb.z - pa.z) * (pc.y - pa.y);
    const crossY = (pb.z - pa.z) * (pc.x - pa.x) - (pb.x - pa.x) * (pc.z - pa.z);
    const crossZ = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
    const doubleArea = Math.hypot(crossX, crossY, crossZ);

    if (a === b || b === c || a === c || doubleArea / 2 <= EPSILON_AREA_CM2) {
      report.degenerateTriangles += 1;
      continue;
    }

    unionFind.add(a);
    unionFind.add(b);
    unionFind.add(c);
    unionFind.union(a, b);
    unionFind.union(b, c);

    const key = [a, b, c].sort((left, right) => left - right).join(':');
    if (triangleKeys.has(key)) {
      report.duplicateTriangles += 1;
    } else {
      triangleKeys.add(key);
    }

    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const undirected = from < to ? `${from}:${to}` : `${to}:${from}`;
      edgeUse.set(undirected, (edgeUse.get(undirected) ?? 0) + 1);
      const directed = `${from}:${to}`;
      directedUse.set(directed, (directedUse.get(directed) ?? 0) + 1);
    }

    // Outward-wound triangles make a positive signed volume.
    signedVolumeCm3 +=
      (pa.x * (pb.y * pc.z - pb.z * pc.y) +
        pa.y * (pb.z * pc.x - pb.x * pc.z) +
        pa.z * (pb.x * pc.y - pb.y * pc.x)) /
      6;
  }

  for (const [edge, count] of edgeUse) {
    if (count === 1) {
      report.boundaryEdges += 1;
    } else if (count > 2) {
      report.nonManifoldEdges += 1;
    } else if (count === 2) {
      // Two uses of an edge must run in opposite directions. Both directions
      // are checked because the key is stored as min:max, not as written.
      const [from, to] = edge.split(':');
      const forward = directedUse.get(`${from}:${to}`) ?? 0;
      const backward = directedUse.get(`${to}:${from}`) ?? 0;
      if (forward === 2 || backward === 2) {
        report.inconsistentWindingEdges += 1;
      }
    }
  }

  report.weldedVertices = positions.length;
  report.components = unionFind.componentCount();
  report.closed =
    report.triangles > 0 &&
    report.boundaryEdges === 0 &&
    report.nonManifoldEdges === 0 &&
    report.degenerateTriangles === 0;
  report.manifold = report.nonManifoldEdges === 0 && report.inconsistentWindingEdges === 0;

  if (report.closed) {
    report.signedVolumeCm3 = signedVolumeCm3;
    const determinant = Math.abs(mesh.matrixWorld.determinant());
    report.volumeMm3 = Math.abs(signedVolumeCm3) * determinant * 1000; // cm³ -> mm³
    report.inverted = signedVolumeCm3 < 0;
  }

  return report;
}
