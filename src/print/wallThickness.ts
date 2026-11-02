/**
 * B3 — minimum wall thickness, as a labelled approximation.
 *
 * Method: for sampled triangles, cast a ray from the face centroid along the
 * inward surface normal and take the distance to the first opposite surface.
 * That is a defensible local thickness for box-like parts and for most extruded
 * furniture panels, and it is exactly how a "wall" is usually understood.
 *
 * It is **not** a slicer measurement:
 * - only surface normals are probed, so a thin rib whose faces are not sampled
 *   can be missed;
 * - curved thin features and layer direction are not modelled;
 * - an open mesh lets the ray escape, so that mesh reports no measurement.
 *
 * The caller must label the result as an estimate and must not present it as a
 * print guarantee.
 */
import * as THREE from 'three';

export interface MeshWallThickness {
  name: string;
  /** Minimum measured thickness in mm, or `null` when no ray hit the far side. */
  minMm: number | null;
  samples: number;
  hits: number;
}

export interface WallThicknessResult {
  minMm: number | null;
  meshes: MeshWallThickness[];
  sampledTriangles: number;
  totalTriangles: number;
  method: string;
  limitations: string[];
}

export const WALL_THICKNESS_METHOD =
  "Sirt normali bo'ylab nur (birinchi qarama-qarshi sirtgacha bo'lgan masofa)";

export const WALL_THICKNESS_LIMITATIONS: readonly string[] = [
  "Devor qalinligi faqat sirt normali bo'ylab nurlar bilan taxmin qilinadi — slicer o'lchovi emas.",
  "Egri yupqa qismlar, qatlam yo'nalishi va nozzle diametri hisobga olinmaydi.",
  "Ochiq meshlarda nur tashqariga chiqib ketishi mumkin; bunday mesh uchun natija yo'q.",
];

const RAY_ORIGIN_OFFSET_CM = 1e-3;
const MIN_HIT_CM = 2e-3;
const MAX_RAY_CM = 1e6;
const DEFAULT_SAMPLE_LIMIT = 2000;

export interface WallThicknessOptions {
  /** Upper bound on probed triangles across the whole model. */
  sampleLimit?: number;
}

function isWorldVisible(object: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object;
  while (node) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
}

function worldVertex(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number,
  matrix: THREE.Matrix4,
  target: THREE.Vector3,
): THREE.Vector3 {
  return target
    .set(position.getX(index), position.getY(index), position.getZ(index))
    .applyMatrix4(matrix);
}

/**
 * Measure an approximate minimum wall thickness for every mesh under `root`.
 * The caller owns `root`; nothing here mutates geometry or materials.
 */
export function measureMinWallThickness(
  root: THREE.Object3D,
  options: WallThicknessOptions = {},
): WallThicknessResult {
  root.updateMatrixWorld(true);

  const meshes: Array<{
    mesh: THREE.Mesh;
    position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
    indices: number[];
    triangles: number;
  }> = [];

  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !isWorldVisible(mesh)) return;
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    const position = geometry?.getAttribute?.('position') as
      | THREE.BufferAttribute
      | THREE.InterleavedBufferAttribute
      | undefined;
    if (!position) return;
    const indexAttribute = geometry?.getIndex();
    const indices: number[] = [];
    if (indexAttribute) {
      for (let i = 0; i < indexAttribute.count; i += 1) indices.push(indexAttribute.getX(i));
    } else {
      for (let i = 0; i < position.count; i += 1) indices.push(i);
    }
    const triangles = Math.floor(indices.length / 3);
    if (triangles === 0) return;
    meshes.push({ mesh, position, indices, triangles });
  });

  const totalTriangles = meshes.reduce((sum, entry) => sum + entry.triangles, 0);
  if (totalTriangles === 0) {
    return {
      minMm: null,
      meshes: [],
      sampledTriangles: 0,
      totalTriangles: 0,
      method: WALL_THICKNESS_METHOD,
      limitations: [...WALL_THICKNESS_LIMITATIONS],
    };
  }

  const sampleLimit = Math.max(1, options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT);
  const perMeshLimit = Math.max(25, Math.floor(sampleLimit / Math.max(1, meshes.length)));

  const raycaster = new THREE.Raycaster();
  raycaster.far = MAX_RAY_CM;
  const results: MeshWallThickness[] = [];
  let sampledTriangles = 0;

  for (const entry of meshes) {
    const stride = Math.max(1, Math.ceil(entry.triangles / perMeshLimit));
    const probeMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const probe = new THREE.Mesh(entry.mesh.geometry as THREE.BufferGeometry, probeMaterial);
    probe.matrixAutoUpdate = false;
    probe.matrixWorld.copy(entry.mesh.matrixWorld);

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const centroid = new THREE.Vector3();
    const direction = new THREE.Vector3();

    let minCm = Infinity;
    let samples = 0;
    let hits = 0;

    for (let triangle = 0; triangle < entry.triangles; triangle += stride) {
      worldVertex(entry.position, entry.indices[triangle * 3], entry.mesh.matrixWorld, a);
      worldVertex(entry.position, entry.indices[triangle * 3 + 1], entry.mesh.matrixWorld, b);
      worldVertex(entry.position, entry.indices[triangle * 3 + 2], entry.mesh.matrixWorld, c);

      normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
      if (normal.lengthSq() <= 1e-18) {
        continue;
      }
      normal.normalize();
      centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      centroid.addScaledVector(normal, -RAY_ORIGIN_OFFSET_CM);
      direction.copy(normal).negate();
      raycaster.set(centroid, direction);

      const intersections = raycaster.intersectObject(probe, false);
      samples += 1;
      for (const intersection of intersections) {
        if (intersection.distance > MIN_HIT_CM && intersection.distance < minCm) {
          minCm = intersection.distance;
          hits += 1;
          break;
        }
      }
    }

    probeMaterial.dispose();
    sampledTriangles += samples;
    results.push({
      name: entry.mesh.name || `mesh-${results.length + 1}`,
      // Add back the small inward offset so a 20 mm wall measures 20 mm, not 19.99.
      minMm: Number.isFinite(minCm)
        ? Math.round((minCm + RAY_ORIGIN_OFFSET_CM) * 10 * 100) / 100
        : null,
      samples,
      hits,
    });
  }

  const measured = results.filter((entry) => entry.minMm !== null) as Array<
    MeshWallThickness & { minMm: number }
  >;
  const minMm =
    measured.length > 0 ? Math.min(...measured.map((entry) => entry.minMm)) : null;

  return {
    minMm,
    meshes: results,
    sampledTriangles,
    totalTriangles,
    method: WALL_THICKNESS_METHOD,
    limitations: [...WALL_THICKNESS_LIMITATIONS],
  };
}
