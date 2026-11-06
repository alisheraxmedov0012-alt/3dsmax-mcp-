/**
 * Golden regression for the standard quality-harness export.
 *
 * Geometry/count changes are exact failures; file size gets a small tolerance
 * so harmless metadata bytes do not fail the gate. Budget and Blender checks are
 * compared only when that measurement is available.
 */

const STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  NOT_VERIFIED: 'NOT VERIFIED',
});

const JSON_CHUNK = 0x4e4f534a;

function readJsonChunk(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) return null;
  const total = view.getUint32(8, true);
  let offset = 12;
  while (offset + 8 <= total && offset + 8 <= view.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (type === JSON_CHUNK) {
      try {
        return JSON.parse(
          new TextDecoder().decode(new Uint8Array(bytes.buffer, bytes.byteOffset + offset + 8, length)),
        );
      } catch {
        return null;
      }
    }
    offset += 8 + length;
  }
  return null;
}

function primitiveTriangles(primitive, accessors) {
  const position = accessors?.[primitive?.attributes?.POSITION];
  const indices = primitive?.indices !== undefined ? accessors?.[primitive.indices] : undefined;
  if (!position) return 0;
  return Math.floor((indices?.count ?? position.count) / 3);
}

/** Read scene and unique-geometry counts from the actual GLB bytes. */
export function parseGlbMetrics(bytes) {
  const json = readJsonChunk(bytes);
  if (!json) return null;

  const materials = Array.isArray(json.materials) ? json.materials : [];
  const accessors = Array.isArray(json.accessors) ? json.accessors : [];
  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  const nodes = Array.isArray(json.nodes) ? json.nodes : [];

  const meshStats = meshes.map((mesh) => {
    let triangles = 0;
    let vertices = 0;
    let normalMapped = false;
    let tangentCovered = true;
    let primitives = 0;
    for (const primitive of mesh.primitives ?? []) {
      primitives += 1;
      triangles += primitiveTriangles(primitive, accessors);
      vertices += accessors?.[primitive?.attributes?.POSITION]?.count ?? 0;
      const material = materials[primitive?.material];
      if (material?.normalTexture) {
        normalMapped = true;
        if (primitive?.attributes?.TANGENT === undefined) tangentCovered = false;
      }
    }
    return { triangles, vertices, normalMapped, tangentCovered, primitives };
  });

  let uniqueGeometryTriangles = 0;
  let uniqueGeometryVertices = 0;
  let primitives = 0;
  for (const stats of meshStats) {
    uniqueGeometryTriangles += stats.triangles;
    uniqueGeometryVertices += stats.vertices;
    primitives += stats.primitives;
  }

  let sceneTriangles = 0;
  let sceneVertices = 0;
  let meshNodes = 0;
  let nodeWeightedPrimitives = 0;
  let normalMappedMeshNodes = 0;
  let tangentCoveredNormalMappedMeshNodes = 0;
  let instancedMeshNodes = 0;
  let instancedInstances = 0;

  for (const node of nodes) {
    if (typeof node.mesh !== 'number' || !meshStats[node.mesh]) continue;
    const stats = meshStats[node.mesh];
    const instancing = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
    const instanceAccessor = instancing ? accessors[Object.values(instancing)[0]] : undefined;
    const instances = Math.max(1, instanceAccessor?.count ?? 1);
    meshNodes += 1;
    sceneTriangles += stats.triangles * instances;
    sceneVertices += stats.vertices * instances;
    nodeWeightedPrimitives += stats.primitives * instances;
    if (instancing) {
      instancedMeshNodes += 1;
      instancedInstances += instances;
    }
    if (stats.normalMapped) {
      normalMappedMeshNodes += 1;
      if (stats.tangentCovered) tangentCoveredNormalMappedMeshNodes += 1;
    }
  }

  return {
    bytes: bytes.byteLength,
    meshDefinitions: meshes.length,
    meshNodes,
    sceneNodes: nodes.length,
    primitives,
    nodeWeightedPrimitives,
    uniqueGeometryTriangles,
    uniqueGeometryVertices,
    sceneTriangles,
    sceneVertices,
    materials: materials.length,
    images: Array.isArray(json.images) ? json.images.length : 0,
    textures: Array.isArray(json.textures) ? json.textures.length : 0,
    normalMappedMeshNodes,
    tangentCoveredNormalMappedMeshNodes,
    instancedMeshNodes,
    instancedInstances,
  };
}

function getPath(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

function metricPass(actual, expected, tolerance) {
  if (tolerance === undefined) return actual === expected;
  const delta = Math.abs(actual - expected);
  return delta <= tolerance.absolute || delta <= Math.abs(expected) * tolerance.relative;
}

const METRICS = [
  { path: 'glb.bytes', tolerance: { absolute: 4096, relative: 0.02 } },
  { path: 'glb.meshDefinitions' },
  { path: 'glb.meshNodes' },
  { path: 'glb.sceneNodes' },
  { path: 'glb.primitives' },
  { path: 'glb.nodeWeightedPrimitives' },
  { path: 'glb.uniqueGeometryTriangles' },
  { path: 'glb.uniqueGeometryVertices' },
  { path: 'glb.sceneTriangles' },
  { path: 'glb.sceneVertices' },
  { path: 'glb.materials' },
  { path: 'glb.images' },
  { path: 'glb.textures' },
  { path: 'glb.normalMappedMeshNodes' },
  { path: 'glb.tangentCoveredNormalMappedMeshNodes' },
  { path: 'glb.instancedMeshNodes' },
  { path: 'glb.instancedInstances' },
  { path: 'budget.uniqueGeometries' },
  { path: 'budget.uniqueGeometryTriangles' },
  { path: 'budget.uniqueGeometryVertices' },
  { path: 'budget.meshNodes' },
  { path: 'budget.sceneTriangles' },
  { path: 'budget.sceneVertices' },
  { path: 'budget.objectGroups' },
  { path: 'budget.sceneNodes' },
  { path: 'budget.instancedMeshNodes' },
  { path: 'budget.instancedInstances' },
  { path: 'khronos.errors' },
  { path: 'khronos.warnings' },
  { path: 'blender.objects' },
  { path: 'blender.meshes' },
  { path: 'blender.vertices' },
  { path: 'blender.triangles' },
  { path: 'blender.materials' },
  { path: 'blender.images' },
  { path: 'blender.uvLayers' },
  { path: 'blender.zeroAreaPolygons' },
];

/** Compare actual measurements to a versioned baseline. */
export function compareGolden(actual, baseline) {
  if (!baseline) {
    return {
      status: STATUS.NOT_VERIFIED,
      reason: 'Golden baseline is unavailable.',
      baselineVersion: null,
      checks: [],
      failures: [],
      notVerified: [],
    };
  }

  const checks = [];
  const failures = [];
  const notVerified = [];

  for (const spec of METRICS) {
    if (getPath(baseline, spec.path) === undefined) continue;
    const expected = getPath(baseline, spec.path);
    const actualValue = getPath(actual, spec.path);
    if (actualValue === undefined || actualValue === null) {
      checks.push({ path: spec.path, expected, actual: null, status: STATUS.NOT_VERIFIED });
      notVerified.push(spec.path);
      continue;
    }
    const pass = metricPass(actualValue, expected, spec.tolerance);
    const status = pass ? STATUS.PASS : STATUS.FAIL;
    checks.push({ path: spec.path, expected, actual: actualValue, status });
    if (!pass) {
      failures.push(`${spec.path}: expected ${expected}, got ${actualValue}`);
    }
  }

  return {
    status: failures.length > 0 ? STATUS.FAIL : STATUS.PASS,
    reason: failures.length > 0 ? failures[0] : null,
    baselineVersion: baseline.version ?? null,
    checks,
    failures,
    notVerified,
  };
}
