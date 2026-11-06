import * as THREE from 'three';

/**
 * Tangent generation for glTF normal-mapped meshes.
 *
 * Three.js `BufferGeometry.computeTangents()` implements the per-vertex
 * Lengyel method: it accumulates the UV-derived S/T directions per vertex,
 * Gram-Schmidt orthogonalises them against the normal and stores the handedness
 * in W. It keeps the geometry indexed, unlike the MikkTSpace helper in
 * `BufferGeometryUtils`, which de-indexes it. The glTF 2.0 TANGENT attribute
 * needs exactly the four components this produces.
 *
 * The built-in implementation deliberately skips degenerate UV triangles and
 * leaves their vertices with a zero tangent. A zero-length tangent is invalid in
 * glTF, so every generated vertex is checked and repaired with a stable
 * orthogonal fallback. Only meshes whose material actually references a normal
 * map are processed; ordinary primitives keep their attribute layout.
 */

const TANGENT_EPSILON = 1e-8;
const NORMALIZE_TOLERANCE = 1e-6;

export type TangentSkipReason = 'already-present' | 'non-indexed' | 'missing-attributes';

export interface TangentResult {
  applied: boolean;
  sanitizedVertices: number;
  reason?: TangentSkipReason;
}

export interface TangentGenerationReport {
  meshesUsingNormalMap: number;
  tangentsGenerated: number;
  tangentsAlreadyPresent: number;
  skippedNoNormalMap: number;
  skippedNonIndexed: number;
  skippedMissingAttributes: number;
  sanitizedVertices: number;
}

function materialUsesNormalMap(material: THREE.Material | THREE.Material[] | undefined): boolean {
  if (!material) return false;
  const materials = Array.isArray(material) ? material : [material];
  return materials.some((entry) => Boolean((entry as THREE.MeshStandardMaterial).normalMap));
}

/** A deterministic tangent orthogonal to the normal, used when UVs are degenerate. */
function fallbackTangent(nx: number, ny: number, nz: number): [number, number, number] {
  let x = Number.isFinite(nx) ? nx : 0;
  let y = Number.isFinite(ny) ? ny : 1;
  let z = Number.isFinite(nz) ? nz : 0;
  const normalLength = Math.hypot(x, y, z);
  if (normalLength < TANGENT_EPSILON) {
    x = 0;
    y = 1;
    z = 0;
  } else {
    x /= normalLength;
    y /= normalLength;
    z /= normalLength;
  }

  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  let hx = 0;
  let hy = 0;
  let hz = 0;
  if (ax <= ay && ax <= az) {
    hx = 1;
  } else if (ay <= az) {
    hy = 1;
  } else {
    hz = 1;
  }

  let tx = hy * z - hz * y;
  let ty = hz * x - hx * z;
  let tz = hx * y - hy * x;
  const tangentLength = Math.hypot(tx, ty, tz);
  if (tangentLength < TANGENT_EPSILON) {
    return [1, 0, 0];
  }
  tx /= tangentLength;
  ty /= tangentLength;
  tz /= tangentLength;
  return [tx, ty, tz];
}

/**
 * Normalise XYZ, force W to exactly +1 or -1, and repair zero/NaN vectors.
 * Returns the number of vertices that needed a fallback or a sign correction.
 */
export function sanitizeTangentAttribute(geometry: THREE.BufferGeometry): number {
  const tangent = geometry.getAttribute('tangent') as THREE.BufferAttribute | undefined;
  if (!tangent || tangent.itemSize !== 4) {
    return 0;
  }
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  let sanitized = 0;

  for (let index = 0; index < tangent.count; index += 1) {
    const x = tangent.getX(index);
    const y = tangent.getY(index);
    const z = tangent.getZ(index);
    const w = tangent.getW(index);
    const length = Math.hypot(x, y, z);

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z) ||
      !Number.isFinite(length) ||
      length < TANGENT_EPSILON
    ) {
      const [fx, fy, fz] =
        normal && index < normal.count
          ? fallbackTangent(normal.getX(index), normal.getY(index), normal.getZ(index))
          : [1, 0, 0];
      tangent.setXYZW(index, fx, fy, fz, 1);
      sanitized += 1;
      continue;
    }

    const inverse = 1 / length;
    const sign = w < 0 ? -1 : 1;
    if (Math.abs(length - 1) > NORMALIZE_TOLERANCE || (w !== 1 && w !== -1)) {
      sanitized += 1;
    }
    tangent.setXYZW(index, x * inverse, y * inverse, z * inverse, sign);
  }

  tangent.needsUpdate = true;
  return sanitized;
}

/** Add a valid four-component TANGENT attribute to one geometry when possible. */
export function addTangentsToGeometry(geometry: THREE.BufferGeometry): TangentResult {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  if (
    !position ||
    !normal ||
    !uv ||
    normal.count !== position.count ||
    uv.count !== position.count
  ) {
    return { applied: false, sanitizedVertices: 0, reason: 'missing-attributes' };
  }
  if (geometry.getAttribute('tangent')) {
    return { applied: false, sanitizedVertices: 0, reason: 'already-present' };
  }
  if (!geometry.getIndex()) {
    // Three's implementation needs an index to average shared vertices.
    return { applied: false, sanitizedVertices: 0, reason: 'non-indexed' };
  }

  geometry.computeTangents();
  const tangent = geometry.getAttribute('tangent') as THREE.BufferAttribute | undefined;
  if (!tangent || tangent.itemSize !== 4 || tangent.count !== position.count) {
    return { applied: false, sanitizedVertices: 0, reason: 'missing-attributes' };
  }

  return {
    applied: true,
    sanitizedVertices: sanitizeTangentAttribute(geometry),
  };
}

/**
 * Add tangents only to visible meshes whose material references a normal map.
 * Existing tangents from imported files are left untouched.
 */
export function ensureTangentsForNormalMappedMeshes(
  root: THREE.Object3D,
): TangentGenerationReport {
  const report: TangentGenerationReport = {
    meshesUsingNormalMap: 0,
    tangentsGenerated: 0,
    tangentsAlreadyPresent: 0,
    skippedNoNormalMap: 0,
    skippedNonIndexed: 0,
    skippedMissingAttributes: 0,
    sanitizedVertices: 0,
  };

  root.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) {
      return;
    }
    if (!materialUsesNormalMap(mesh.material)) {
      report.skippedNoNormalMap += 1;
      return;
    }

    report.meshesUsingNormalMap += 1;
    const result = addTangentsToGeometry(mesh.geometry);
    if (result.applied) {
      report.tangentsGenerated += 1;
      report.sanitizedVertices += result.sanitizedVertices;
      return;
    }
    if (result.reason === 'already-present') {
      report.tangentsAlreadyPresent += 1;
    } else if (result.reason === 'non-indexed') {
      report.skippedNonIndexed += 1;
    } else {
      report.skippedMissingAttributes += 1;
    }
  });

  return report;
}
