/**
 * Phase 6.1-B — OBJ + MTL writer.
 *
 * Three's OBJExporter writes geometry, object names and `usemtl` references but
 * no MTL file. This module adds a deterministic MTL companion and the PNG
 * sidecars it references. The approximation is intentional: MTL is a Phong-era
 * format, so roughness/metalness/AO/emissive maps stay in the GLB; the OBJ/MTL
 * pair carries base color and normal maps only.
 */
import * as THREE from 'three';
import { addMillimetreScaleRoot } from './sceneFileExport';
import { assertExportableScene } from './sceneExport';
import { assertFiniteGeometry } from './geometryGuard';
import { sha256Hex } from '../util/sha256';
import { encodeTexturePng, type TexturePngEncoder } from './texturePng';
import { inspectObjBytes } from './modelFormatStats';
import type { AssetPackageV2ModelStats } from './assetPackageV2Schema';

export type ObjTextureRole = 'baseColor' | 'normal';

export interface ObjTextureSidecar {
  /** Roles that reference this file, sorted and joined with `+`. */
  role: string;
  roles: ObjTextureRole[];
  file: string;
  bytes: Uint8Array;
  sha256: string;
}

export interface ObjMtlResult {
  objBytes: Uint8Array;
  mtlBytes: Uint8Array;
  textures: ObjTextureSidecar[];
  stats: AssetPackageV2ModelStats;
}

export interface ObjMtlOptions {
  textureEncoder?: TexturePngEncoder;
}

function safeMaterialName(value: string, fallback: string, used: Set<string>): string {
  const base =
    value
      .replace(/[^A-Za-z0-9._-]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 64) || fallback;
  let name = base;
  let suffix = 2;
  while (used.has(name)) {
    name = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(name);
  return name;
}

function materialColor(material: THREE.MeshStandardMaterial): [number, number, number] {
  const hex = material.color.getHexString();
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

function numberText(value: number): string {
  const rounded = Number(value.toFixed(6));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function collectMaterials(scene: THREE.Scene): THREE.MeshStandardMaterial[] {
  const materials = new Set<THREE.MeshStandardMaterial>();
  scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const entries = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of entries) {
      if (material instanceof THREE.MeshStandardMaterial) {
        materials.add(material);
      }
    }
  });
  return [...materials];
}

function sidecarPath(sha256: string, roles: readonly ObjTextureRole[]): string {
  return `textures/${sha256}-${[...roles].sort().join('+')}.png`;
}

/**
 * Export a scene to OBJ + MTL. The caller must pass a *fresh* export scene; this
 * function applies the millimetre scale root and renames export-only materials
 * (both mutations stay on that scene).
 */
export async function exportObjWithMtl(
  scene: THREE.Scene,
  options: ObjMtlOptions = {},
): Promise<ObjMtlResult> {
  assertFiniteGeometry(scene);
  assertExportableScene(scene);
  const encoder = options.textureEncoder ?? encodeTexturePng;
  const materials = collectMaterials(scene);
  const usedNames = new Set<string>();
  const names = new Map<THREE.MeshStandardMaterial, string>();
  materials.forEach((material, index) => {
    names.set(
      material,
      safeMaterialName(material.name, `material-${index + 1}`, usedNames),
    );
  });
  for (const [material, name] of names) {
    material.name = name;
  }

  const requests: Array<{ texture: THREE.Texture; role: ObjTextureRole; key: string }> = [];
  const seenRequests = new Set<string>();
  for (const material of materials) {
    const entries: Array<[ObjTextureRole, THREE.Texture | null]> = [
      ['baseColor', material.map],
      ['normal', material.normalMap],
    ];
    for (const [role, texture] of entries) {
      if (!texture) continue;
      const key = `${texture.uuid}:${role}`;
      if (seenRequests.has(key)) continue;
      seenRequests.add(key);
      requests.push({ texture, role, key });
    }
  }

  const encoded = new Map<string, { sha256: string; bytes: Uint8Array }>();
  const groups = new Map<
    string,
    { bytes: Uint8Array; roles: Set<ObjTextureRole> }
  >();
  for (const request of requests) {
    // Canvas/bitmap encoding is sequential: browser 2D canvases are shared
    // resources and the package is already a bounded, small set of maps.
    // eslint-disable-next-line no-await-in-loop
    const bytes = await encoder(request.texture);
    if (bytes.byteLength === 0) {
      throw new Error(`"${request.role}" teksturasi bo'sh PNG qaytardi.`);
    }
    const sha256 = sha256Hex(bytes);
    encoded.set(request.key, { sha256, bytes });
    const group = groups.get(sha256);
    if (group) {
      group.roles.add(request.role);
    } else {
      groups.set(sha256, { bytes, roles: new Set([request.role]) });
    }
  }

  const sidecarsBySha = new Map<string, ObjTextureSidecar>();
  for (const [sha256, group] of groups) {
    const roles = [...group.roles].sort();
    sidecarsBySha.set(sha256, {
      role: roles.join('+'),
      roles,
      file: sidecarPath(sha256, roles),
      bytes: group.bytes,
      sha256,
    });
  }
  const sidecars = [...sidecarsBySha.values()];

  const sidecarFor = (
    texture: THREE.Texture,
    role: ObjTextureRole,
  ): ObjTextureSidecar | undefined => {
    const sha = encoded.get(`${texture.uuid}:${role}`)?.sha256;
    return sha ? sidecarsBySha.get(sha) : undefined;
  };

  const mtlTextureRefs = new Map<
    THREE.MeshStandardMaterial,
    { baseColor?: ObjTextureSidecar; normal?: ObjTextureSidecar }
  >();
  for (const material of materials) {
    const refs: { baseColor?: ObjTextureSidecar; normal?: ObjTextureSidecar } = {};
    if (material.map) {
      refs.baseColor = sidecarFor(material.map, 'baseColor');
    }
    if (material.normalMap) {
      refs.normal = sidecarFor(material.normalMap, 'normal');
    }
    mtlTextureRefs.set(material, refs);
  }

  const mtlLines = [
    '# Generated by AI 3D Studio — OBJ/MTL approximation',
    '# Base color and normal maps are external PNG sidecars.',
    '# Roughness, metalness, AO and emissive maps remain GLB-only.',
    '',
  ];
  for (const material of materials) {
    const [r, g, b] = materialColor(material);
    const refs = mtlTextureRefs.get(material);
    const specular = numberText(Math.max(0.04, material.metalness));
    mtlLines.push(
      `newmtl ${material.name}`,
      'Ka 0 0 0',
      `Kd ${numberText(r)} ${numberText(g)} ${numberText(b)}`,
      `Ks ${specular} ${specular} ${specular}`,
      `Ns ${Math.round((1 - material.roughness) * 1000)}`,
      `d ${numberText(material.opacity)}`,
      'illum 2',
    );
    if (refs?.baseColor) {
      mtlLines.push(`map_Kd ../${refs.baseColor.file}`);
    }
    if (refs?.normal) {
      mtlLines.push(`map_Bump -bm ${numberText(material.normalScale.x)} ../${refs.normal.file}`);
    }
    mtlLines.push('');
  }
  const mtlBytes = new TextEncoder().encode(mtlLines.join('\n'));

  addMillimetreScaleRoot(scene);
  const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');
  const objText = new OBJExporter().parse(scene);
  const objBytes = new TextEncoder().encode(`mtllib model.mtl\n${objText}`);

  return {
    objBytes,
    mtlBytes,
    textures: sidecars,
    stats: inspectObjBytes(objBytes, mtlBytes),
  };
}
