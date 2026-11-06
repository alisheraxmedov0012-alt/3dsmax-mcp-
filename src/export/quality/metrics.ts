import * as THREE from 'three';
import { validateDegenerate } from '../../geometry/kernel/validation/validateDegenerate';
import { validateNormals } from '../../geometry/kernel/validation/validateNormals';
import { validateUvGeometry } from '../../materials/uv';
import { validateTangentAttribute } from '../tangents';
import type { QualityMetrics, TextureMetric } from './types';

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

function textureBytes(texture: THREE.Texture, width: number, height: number): number {
  const source = texture.source?.data as
    | { byteLength?: number; size?: number }
    | ArrayBuffer
    | Uint8Array
    | undefined;
  if (source instanceof ArrayBuffer) return source.byteLength;
  if (source instanceof Uint8Array) return source.byteLength;
  if (source && typeof source === 'object') {
    if (typeof source.byteLength === 'number') return source.byteLength;
    if (typeof source.size === 'number') return source.size;
  }
  const image = texture.image as { data?: { byteLength?: number } } | null | undefined;
  if (image?.data && typeof image.data.byteLength === 'number') return image.data.byteLength;
  return Math.max(0, width * height * 4);
}

/**
 * Read-only measurement of a built export scene.
 *
 * Geometry facts come from the project's existing validators. Texture payload
 * bytes are an estimate (`width * height * 4`) when the runtime image only
 * exposes pixels; the exporter later re-checks the produced file's actual image
 * chunks.
 */
export function collectQualityMetrics(root: THREE.Object3D): QualityMetrics {
  const geometryByUuid = new Map<string, THREE.BufferGeometry>();
  const geometryFlags = new Map<string, { requiresUv: boolean; normalMapped: boolean }>();
  const textureByUuid = new Map<string, THREE.Texture>();
  const materialByUuid = new Map<string, THREE.Material>();
  const unsupportedMaterialIds = new Set<string>();
  const invalidTextureIds = new Set<string>();

  let meshes = 0;
  let normalMappedMeshes = 0;
  let missingMaterialReferences = 0;

  root.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    meshes += 1;
    geometryByUuid.set(mesh.geometry.uuid, mesh.geometry);

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
      }
      if (materialHasTexture(material)) requiresUv = true;
      if (materialHasNormalMap(material)) normalMapped = true;

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

    if (normalMapped) normalMappedMeshes += 1;
    const flags = geometryFlags.get(mesh.geometry.uuid) ?? {
      requiresUv: false,
      normalMapped: false,
    };
    flags.requiresUv ||= requiresUv;
    flags.normalMapped ||= normalMapped;
    geometryFlags.set(mesh.geometry.uuid, flags);
  });

  let triangles = 0;
  let vertices = 0;
  let degenerateTriangles = 0;
  let invalidGeometries = 0;
  let nonFiniteVertices = 0;
  let uvMissingForTextured = 0;
  let uvNonFinite = 0;
  let uvCountMismatch = 0;
  let uvMaxAbs = 0;
  let missingNormals = 0;
  let nonFiniteNormals = 0;
  let invalidNormalLengths = 0;
  let missingTangents = 0;
  let invalidTangents = 0;
  let bufferBytes = 0;

  for (const [uuid, geometry] of geometryByUuid) {
    const flags = geometryFlags.get(uuid) ?? { requiresUv: false, normalMapped: false };
    const degenerate = validateDegenerate(geometry);
    triangles += degenerate.triangleCount;
    degenerateTriangles += degenerate.degenerateTriangles;
    nonFiniteVertices += degenerate.nonFiniteVertices;
    if (!degenerate.valid) invalidGeometries += 1;

    const position = geometry.getAttribute('position');
    if (position) vertices += position.count;
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

  const textures: TextureMetric[] = [...textureByUuid.values()]
    .map((texture) => {
      const { width, height } = imageSize(texture);
      return {
        id: texture.uuid,
        name: texture.name || texture.uuid,
        width,
        height,
        estimatedBytes: textureBytes(texture, width, height),
        format: textureFormat(texture),
        missingImage: width <= 0 || height <= 0,
      };
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
    triangles,
    vertices,
    meshes,
    objects: root.children.filter((child) => child.visible).length,
    uniqueGeometries: geometryByUuid.size,
    degenerateTriangles,
    invalidGeometries,
    nonFiniteVertices,
    textures,
    texturePayloadBytes,
    texturePixels,
    maxTextureWidth,
    maxTextureHeight,
    materialCount: materialByUuid.size,
    missingMaterialReferences,
    invalidTextureReferences: invalidTextureIds.size,
    unsupportedMaterials: unsupportedMaterialIds.size,
    uvMissingForTextured,
    uvNonFinite,
    uvCountMismatch,
    uvMaxAbs,
    missingNormals,
    nonFiniteNormals,
    invalidNormalLengths,
    normalMappedMeshes,
    missingTangents,
    invalidTangents,
    estimatedFileBytes: 12 + bufferBytes + texturePayloadBytes + jsonOverhead,
  };
}
