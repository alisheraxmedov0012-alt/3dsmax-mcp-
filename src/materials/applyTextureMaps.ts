/**
 * Phase 4.5 — apply a resolved texture to the PBR map slot(s) of a material.
 *
 * This is the single place where a map role becomes a Three.js material
 * property, shared by the asset builder, the viewport and the GLB exporter.
 * Three.js samples roughness from the green channel, metalness from the blue
 * channel and occlusion from the red channel, which is exactly the glTF ORM
 * convention, so one packed ORM texture can serve all three slots.
 */
import * as THREE from 'three';
import type { TextureMapRole } from './asset';

export interface ApplyTextureMapOptions {
  /** Normal-map strength; only used for the `normal` role. */
  normalStrength?: number;
  /** Emissive multiplier; only used for the `emissive` role. */
  emissiveIntensity?: number;
  /** Emissive tint; omitted means white when an emissive map is present. */
  emissiveColor?: string;
  /** AO multiplier applied to the AO or ORM red channel. */
  aoIntensity?: number;
  /**
   * Tint the base colour white so a baseColor bitmap is not multiplied by the
   * object colour. The viewer/exporter do this; the asset builder preserves an
   * explicitly fixed asset colour.
   */
  whiteBaseColor?: boolean;
}

/**
 * Roles in application order. `orm` goes first so a dedicated roughness,
 * metalness or AO map always wins over the packed channels.
 */
export const TEXTURE_MAP_APPLY_ORDER: readonly TextureMapRole[] = [
  'orm',
  'baseColor',
  'normal',
  'roughness',
  'metalness',
  'ao',
  'emissive',
];

function asStandardMaterial(material: THREE.Material): THREE.MeshStandardMaterial | null {
  return material instanceof THREE.MeshStandardMaterial ? material : null;
}

export function applyTextureMapToMaterial(
  material: THREE.MeshStandardMaterial,
  role: TextureMapRole,
  texture: THREE.Texture,
  options: ApplyTextureMapOptions = {},
): void {
  switch (role) {
    case 'baseColor':
      material.map = texture;
      if (options.whiteBaseColor !== false) {
        material.color.set('#ffffff');
      }
      break;
    case 'normal': {
      material.normalMap = texture;
      const strength = options.normalStrength ?? 1;
      material.normalScale.set(strength, strength);
      break;
    }
    case 'roughness':
      material.roughnessMap = texture;
      break;
    case 'metalness':
      material.metalnessMap = texture;
      break;
    case 'ao':
      // Three.js r186 resolves AO UVs from `texture.channel` (0 = `uv`), so the
      // primary UV set is used and no secondary attribute is required.
      texture.channel = 0;
      material.aoMap = texture;
      material.aoMapIntensity = options.aoIntensity ?? 1;
      break;
    case 'orm':
      texture.channel = 0;
      material.aoMap = texture;
      material.aoMapIntensity = options.aoIntensity ?? 1;
      material.roughnessMap = texture;
      material.metalnessMap = texture;
      break;
    case 'emissive':
      material.emissiveMap = texture;
      material.emissive.set(options.emissiveColor ?? '#ffffff');
      material.emissiveIntensity = options.emissiveIntensity ?? 1;
      break;
    default:
      break;
  }
  // Adding/removing a map changes the shader defines, so a recompile is required.
  material.needsUpdate = true;
}

/** Apply one map to every unique MeshStandardMaterial under `root`. */
export function applyTextureMapToGroup(
  root: THREE.Object3D,
  role: TextureMapRole,
  texture: THREE.Texture,
  options: ApplyTextureMapOptions = {},
): number {
  const seen = new Set<THREE.Material>();
  let applied = 0;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material || seen.has(material)) {
        continue;
      }
      seen.add(material);
      const standard = asStandardMaterial(material);
      if (!standard) {
        continue;
      }
      applyTextureMapToMaterial(standard, role, texture, options);
      applied += 1;
    }
  });
  return applied;
}

/** Deterministic key for the maps an object currently carries. */
export function textureMapsKey(
  maps: Partial<
    Record<TextureMapRole, { id: string; version: number; wrap?: string; colorSpace?: string }>
  >,
  repeat: number,
): string {
  const parts: string[] = [];
  for (const role of TEXTURE_MAP_APPLY_ORDER) {
    const ref = maps[role];
    if (ref) {
      parts.push(`${role}:${ref.id}@${ref.version}:${ref.wrap ?? 'repeat'}`);
    }
  }
  return `${parts.join('|')}#${repeat}`;
}

/** Roles present in a map collection, in application order. */
export function presentTextureMapRoles(
  maps: Partial<Record<TextureMapRole, unknown>> | undefined,
): TextureMapRole[] {
  if (!maps) {
    return [];
  }
  return TEXTURE_MAP_APPLY_ORDER.filter((role) => maps[role] !== undefined);
}
