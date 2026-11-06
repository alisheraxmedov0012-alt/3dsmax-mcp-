import * as THREE from 'three';
import { validateDegenerate } from '../../geometry/kernel/validation/validateDegenerate';
import { validateNormals } from '../../geometry/kernel/validation/validateNormals';
import { validateUvGeometry } from '../../materials/uv';
import { validateTangentAttribute } from '../tangents';
import { analyzeUvQuality } from './uvDiagnostics';
import type {
  MeasurementCertainty,
  QualityMetrics,
  TextureMetric,
  UvDensityMetric,
  UvDiagnostic,
} from './types';

const TEXTURE_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'alphaMap',
  'bumpMap',
  'displacementMap',
  'lightMap',
] as const;

function materialsOf(material: THREE.Material | THREE.Material[] | undefined): THREE.Material[] {
  if (!material) return [];
  return (Array.isArray(material) ? material : [material]).filter(Boolean);
}

function textureOf(material: THREE.Material, key: string): THREE.Texture | null {
  const value = (material as unknown as Record<string, unknown>)[key];
  return value instanceof THREE.Texture ? value : null;
}

function materialHasTexture(material: THREE.Material): boolean {
  return TEXTURE_KEYS.some((key) => textureOf(material, key) !== null);
}

function materialHasNormalMap(material: THREE.Material): boolean {
  return textureOf(material, 'normalMap') !== null;
}

function imageSize(texture: THREE.Texture): { width: number; height: number } {
  const image = texture.image as
    | { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number }
    | null
    | undefined;
  const width = Number(image?.width ?? image?.naturalWidth ?? 0);
  const height = Number(image?.height ?? image?.naturalHeight ?? 0);
  return {
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
  };
}

function textureFormat(texture: THREE.Texture): string {
  const explicit =
    (texture.userData?.mimeType as string | undefined) ??
    (texture.source?.data as { type?: string } | undefined)?.type ??
    (texture.image as { type?: string } | null | undefined)?.type;
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    return explicit.replace(/^image\//u, '').toLowerCase();
  }
  // Procedural canvases and decoded bitmap sources are written as PNG by the
  // exporter; the source container is not a user-facing texture format.
  const image = texture.image as { getContext?: unknown } | null | undefined;
  if (image && typeof image.getContext === 'function') return 'png';
  if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) {
    return 'png';
  }
  return 'unknown';
}

function textureBytes(
  texture: THREE.Texture,
  width: number,
  height: number,
): { bytes: number; source: 'exact' | 'estimated' | 'unavailable' } {
  const source = texture.source?.data as
    | { byteLength?: number; size?: number }
    | ArrayBuffer
    | Uint8Array
    | undefined;
  if (source instanceof ArrayBuffer) return { bytes: source.byteLength, source: 'exact' };
  if (source instanceof Uint8Array) return { bytes: source.byteLength, source: 'exact' };
  if (source && typeof source === 'object') {
    if (typeof source.byteLength === 'number') return { bytes: source.byteLength, source: 'exact' };
    if (typeof source.size === 'number') return { bytes: source.size, source: 'exact' };
  }
  const image = texture.image as { data?: { byteLength?: number } } | null | undefined;
  if (image?.data && typeof image.data.byteLength === 'number') {
    return { bytes: image.data.byteLength, source: 'estimated' };
  }
  if (width > 0 && height > 0) {
    return { bytes: width * height * 4, source: 'estimated' };
  }
  return { bytes: 0, source: 'unavailable' };
}

function materialDiagnostics(material: THREE.Material): {
  invalidBaseColor: boolean;
  invalidPbr: boolean;
  invalidAlpha: boolean;
} {
  const color = (material as THREE.MeshStandardMaterial).color;
  const invalidBaseColor =
    !(color instanceof THREE.Color) ||
    ![color.r, color.g, color.b].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    );

  let invalidPbr = false;
  if (material instanceof THREE.MeshStandardMaterial) {
    invalidPbr =
      !Number.isFinite(material.metalness) ||
      !Number.isFinite(material.roughness) ||
      material.metalness < 0 ||
      material.metalness > 1 ||
      material.roughness < 0 ||
      material.roughness > 1;
  }

  const opacity = material.opacity;
  const alphaTest = (material as THREE.Material & { alphaTest?: number }).alphaTest ?? 0;
  const invalidAlpha =
    !Number.isFinite(opacity) ||
    opacity < 0 ||
    opacity > 1 ||
    !Number.isFinite(alphaTest) ||
    alphaTest < 0 ||
    alphaTest > 1;

  return { invalidBaseColor, invalidPbr, invalidAlpha };
}

function worldArea(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): number {
  const position = geometry.getAttribute('position');
  if (!position) return 0;
  const index = geometry.getIndex();
  const triangleCount = index ? index.count / 3 : position.count / 3;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  let area = 0;

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const ia = index ? index.getX(triangle * 3) : triangle * 3;
    const ib = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
    const ic = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
    a.fromBufferAttribute(position, ia).applyMatrix4(matrix);
    b.fromBufferAttribute(position, ib).applyMatrix4(matrix);
    c.fromBufferAttribute(position, ic).applyMatrix4(matrix);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    area += ab.cross(ac).length() / 2;
  }
  return area;
}

function aggregateDensity(values: number[]): UvDensityMetric | null {
  if (values.length === 0) return null;
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    certainty: 'approximate',
    unit: 'texels/cm',
  };
}

function textureCertainty(metrics: readonly TextureMetric[]): MeasurementCertainty {
  if (metrics.some((texture) => texture.payloadSource === 'unavailable')) {
    return 'not_verified';
  }
  if (metrics.some((texture) => texture.payloadSource === 'estimated')) {
    return 'approximate';
  }
  return 'exact';
}

/**
 * Read-only measurement of a built export scene.
 *
 * Unique geometry metrics describe the data that is stored once; scene metrics
 * describe every visible mesh node, including repeated geometry and InstancedMesh
 * counts. The primary complexity budget uses the scene totals.
 */
export function collectQualityMetrics(root: THREE.Object3D): QualityMetrics {
  root.updateMatrixWorld(true);

  const geometryByUuid = new Map<string, THREE.BufferGeometry>();
  const geometryFlags = new Map<string, { requiresUv: boolean; normalMapped: boolean }>();
  const geometryNames = new Map<string, string[]>();
  const geometryTexturePixels = new Map<string, number | null>();
  const geometryWorldArea = new Map<string, number | null>();
  const meshEntries: Array<{ geometryUuid: string; instances: number }> = [];
  const textureByUuid = new Map<string, THREE.Texture>();
  const materialByUuid = new Map<string, THREE.Material>();
  const unsupportedMaterialIds = new Set<string>();
  const invalidTextureIds = new Set<string>();
  const invalidBaseColorIds = new Set<string>();
  const invalidPbrIds = new Set<string>();
  const invalidAlphaIds = new Set<string>();

  let meshNodes = 0;
  let normalMappedMeshNodes = 0;
  let sceneNodes = 0;
  let instancedMeshNodes = 0;
  let instancedInstances = 0;
  let missingMaterialReferences = 0;

  root.traverseVisible((object) => {
    if (object !== root) sceneNodes += 1;
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    meshNodes += 1;
    geometryByUuid.set(mesh.geometry.uuid, mesh.geometry);

    const names = geometryNames.get(mesh.geometry.uuid) ?? [];
    if (mesh.name) names.push(mesh.name);
    geometryNames.set(mesh.geometry.uuid, names);

    const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh === true;
    const instances = instanced ? Math.max(1, (mesh as THREE.InstancedMesh).count) : 1;
    if (instanced) {
      instancedMeshNodes += 1;
      instancedInstances += instances;
    }
    meshEntries.push({ geometryUuid: mesh.geometry.uuid, instances });

    if (!geometryWorldArea.has(mesh.geometry.uuid)) {
      const matrix = mesh.matrixWorld.clone();
      if (instanced) {
        const instanceMatrix = new THREE.Matrix4();
        (mesh as THREE.InstancedMesh).getMatrixAt(0, instanceMatrix);
        matrix.multiply(instanceMatrix);
      }
      geometryWorldArea.set(mesh.geometry.uuid, worldArea(mesh.geometry, matrix));
    }

    const materials = materialsOf(mesh.material);
    if (materials.length === 0) {
      missingMaterialReferences += 1;
      return;
    }

    let requiresUv = false;
    let normalMapped = false;
    for (const material of materials) {
      materialByUuid.set(material.uuid, material);
      if (
        !(material instanceof THREE.MeshStandardMaterial) &&
        !(material instanceof THREE.MeshBasicMaterial)
      ) {
        unsupportedMaterialIds.add(material.uuid);
      } else {
        const diagnostics = materialDiagnostics(material);
        if (diagnostics.invalidBaseColor) invalidBaseColorIds.add(material.uuid);
        if (diagnostics.invalidPbr) invalidPbrIds.add(material.uuid);
        if (diagnostics.invalidAlpha) invalidAlphaIds.add(material.uuid);
      }

      if (materialHasTexture(material)) requiresUv = true;
      if (materialHasNormalMap(material)) normalMapped = true;

      const baseMap = textureOf(material, 'map');
      if (baseMap) {
        const { width, height } = imageSize(baseMap);
        if (width > 0 && height > 0) {
          const pixels = width * height;
          const previous = geometryTexturePixels.get(mesh.geometry.uuid) ?? 0;
          geometryTexturePixels.set(
            mesh.geometry.uuid,
            Math.max(previous ?? 0, pixels),
          );
        }
      }

      for (const key of TEXTURE_KEYS) {
        const texture = textureOf(material, key);
        if (!texture) continue;
        textureByUuid.set(texture.uuid, texture);
        const { width, height } = imageSize(texture);
        if (width <= 0 || height <= 0) {
          invalidTextureIds.add(texture.uuid);
        }
      }
    }

    if (normalMapped) normalMappedMeshNodes += 1;
    const flags = geometryFlags.get(mesh.geometry.uuid) ?? {
      requiresUv: false,
      normalMapped: false,
    };
    flags.requiresUv ||= requiresUv;
    flags.normalMapped ||= normalMapped;
    geometryFlags.set(mesh.geometry.uuid, flags);
  });

  let uniqueGeometryTriangles = 0;
  let uniqueGeometryVertices = 0;
  let degenerateTriangles = 0;
  let invalidGeometries = 0;
  let nonFiniteVertices = 0;
  let uvMissingForTextured = 0;
  let normalMappedWithoutUv = 0;
  let uvNonFinite = 0;
  let uvCountMismatch = 0;
  let uvMaxAbs = 0;
  let uvDegenerateTriangles = 0;
  let uvOverlapCandidates = 0;
  let uvOverlapNotVerified = false;
  const uvDiagnostics: UvDiagnostic[] = [];
  const densityValues: number[] = [];
  const geometryStats = new Map<string, { triangles: number; vertices: number }>();
  let missingNormals = 0;
  let nonFiniteNormals = 0;
  let invalidNormalLengths = 0;
  let missingTangents = 0;
  let invalidTangents = 0;
  let bufferBytes = 0;

  for (const [uuid, geometry] of geometryByUuid) {
    const flags = geometryFlags.get(uuid) ?? { requiresUv: false, normalMapped: false };
    const degenerate = validateDegenerate(geometry);
    const position = geometry.getAttribute('position');
    const vertices = position?.count ?? 0;
    geometryStats.set(uuid, { triangles: degenerate.triangleCount, vertices });
    uniqueGeometryTriangles += degenerate.triangleCount;
    uniqueGeometryVertices += vertices;
    degenerateTriangles += degenerate.degenerateTriangles;
    nonFiniteVertices += degenerate.nonFiniteVertices;
    if (!degenerate.valid) invalidGeometries += 1;

    for (const attribute of Object.values(geometry.attributes)) {
      const array = (attribute as { array?: { byteLength?: number } }).array;
      if (array && typeof array.byteLength === 'number') bufferBytes += array.byteLength;
    }
    const index = geometry.getIndex();
    if (index) bufferBytes += index.array.byteLength;

    const normals = validateNormals(geometry, { requireNormals: true });
    if (!normals.hasNormals) missingNormals += 1;
    nonFiniteNormals += normals.nonFinite;
    invalidNormalLengths += normals.zeroLength + normals.nonUnit;

    const uv = validateUvGeometry(geometry);
    if (!uv.hasUv) {
      if (flags.requiresUv) uvMissingForTextured += 1;
      if (flags.normalMapped) normalMappedWithoutUv += 1;
    } else {
      uvNonFinite += uv.nonFiniteCount;
      if (uv.uvCount !== uv.positionCount) uvCountMismatch += 1;
      if (uv.minU !== null && uv.maxU !== null && uv.minV !== null && uv.maxV !== null) {
        uvMaxAbs = Math.max(
          uvMaxAbs,
          Math.abs(uv.minU),
          Math.abs(uv.maxU),
          Math.abs(uv.minV),
          Math.abs(uv.maxV),
        );
      }

      const diagnostic = analyzeUvQuality(geometry, {
        meshNames: geometryNames.get(uuid) ?? [],
        texturePixels: geometryTexturePixels.get(uuid) ?? null,
        worldArea: geometryWorldArea.get(uuid) ?? null,
      });
      uvDiagnostics.push(diagnostic);
      uvDegenerateTriangles += diagnostic.degenerateTriangles;
      uvOverlapCandidates += diagnostic.overlapCandidates;
      if (diagnostic.overlapStatus === 'not_verified') uvOverlapNotVerified = true;
      if (diagnostic.texelDensity) densityValues.push(diagnostic.texelDensity.average);
    }

    if (flags.normalMapped) {
      const tangent = validateTangentAttribute(geometry);
      if (!tangent.hasTangents) {
        const canGenerate =
          Boolean(geometry.getIndex()) &&
          Boolean(position) &&
          normals.hasNormals &&
          uv.hasUv &&
          uv.uvCount === uv.positionCount;
        if (!canGenerate) missingTangents += 1;
      } else if (!tangent.valid) {
        invalidTangents += 1;
      }
    }
  }

  let sceneTriangles = 0;
  let sceneVertices = 0;
  for (const entry of meshEntries) {
    const stats = geometryStats.get(entry.geometryUuid);
    if (!stats) continue;
    sceneTriangles += stats.triangles * entry.instances;
    sceneVertices += stats.vertices * entry.instances;
  }

  const textures: TextureMetric[] = [...textureByUuid.values()]
    .map((texture) => {
      const { width, height } = imageSize(texture);
      const payload = textureBytes(texture, width, height);
      return {
        id: texture.uuid,
        name: texture.name || texture.uuid,
        width,
        height,
        estimatedBytes: payload.bytes,
        payloadSource: width <= 0 || height <= 0 ? 'unavailable' : payload.source,
        format: textureFormat(texture),
        missingImage: width <= 0 || height <= 0,
      } satisfies TextureMetric;
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  const texturePayloadBytes = textures.reduce((sum, texture) => sum + texture.estimatedBytes, 0);
  const texturePixels = textures.reduce(
    (sum, texture) => sum + texture.width * texture.height,
    0,
  );
  const maxTextureWidth = textures.reduce((max, texture) => Math.max(max, texture.width), 0);
  const maxTextureHeight = textures.reduce((max, texture) => Math.max(max, texture.height), 0);
  const jsonOverhead = Math.max(
    2048,
    Math.round(bufferBytes * 0.08 + texturePayloadBytes * 0.02),
  );

  return {
    uniqueGeometries: geometryByUuid.size,
    uniqueGeometryTriangles,
    uniqueGeometryVertices,
    meshNodes,
    sceneTriangles,
    sceneVertices,
    objectGroups: root.children.filter((child) => child.visible).length,
    sceneNodes,
    instancedMeshNodes,
    instancedInstances,
    degenerateTriangles,
    invalidGeometries,
    nonFiniteVertices,
    textures,
    texturePayloadBytes,
    texturePayloadCertainty: textureCertainty(textures),
    texturePixels,
    maxTextureWidth,
    maxTextureHeight,
    materialCount: materialByUuid.size,
    missingMaterialReferences,
    invalidTextureReferences: invalidTextureIds.size,
    unsupportedMaterials: unsupportedMaterialIds.size,
    invalidBaseColors: invalidBaseColorIds.size,
    invalidPbrMaterials: invalidPbrIds.size,
    invalidAlphaMaterials: invalidAlphaIds.size,
    uvMissingForTextured,
    normalMappedWithoutUv,
    uvNonFinite,
    uvCountMismatch,
    uvMaxAbs,
    uvDegenerateTriangles,
    uvOverlapCandidates,
    uvOverlapStatus:
      uvDiagnostics.length === 0 || uvOverlapNotVerified ? 'not_verified' : 'approximate',
    uvTexelDensity: aggregateDensity(densityValues),
    uvDiagnostics: uvDiagnostics.sort((left, right) =>
      (left.meshNames[0] ?? '').localeCompare(right.meshNames[0] ?? ''),
    ),
    missingNormals,
    nonFiniteNormals,
    invalidNormalLengths,
    normalMappedMeshNodes,
    missingTangents,
    invalidTangents,
    estimatedFileBytes: 12 + bufferBytes + texturePayloadBytes + jsonOverhead,
  };
}
