/**
 * Phase 4.6 — mutate existing Three.js materials in place.
 *
 * The scene model is the source of truth; this module projects it onto the
 * materials that are already attached to a built object. Nothing here creates or
 * disposes geometry, so dragging a slider cannot allocate a new BufferGeometry or
 * replace a material instance.
 */
import * as THREE from 'three';
import { getMaterialPreset, resolvePresetSettings } from './presets';
import {
  DEFAULT_MATERIAL_ID,
  textureKindFor,
  type MaterialSettingsInput,
} from './types';
import { getProceduralState, syncProceduralTextures } from './buildMaterial';
import { DEFAULT_TEXTURE_SIZE } from './textures';
import { getSlotMaterialInfo } from './materialRuntimeMetadata';
import type { ObjectMaterial } from '../scene/types';

export interface ObjectMaterialTarget {
  material: ObjectMaterial;
  params: { color: string };
}

function setColorIfChanged(color: THREE.Color, value: string): void {
  const next = new THREE.Color(value);
  if (color.r !== next.r || color.g !== next.g || color.b !== next.b) {
    color.copy(next);
  }
}

function setNumberIfChanged(
  target: THREE.MeshStandardMaterial,
  key: 'metalness' | 'roughness' | 'opacity' | 'emissiveIntensity' | 'aoMapIntensity',
  value: number,
): void {
  if (target[key] !== value) {
    target[key] = value;
  }
}

function setMapIfChanged(
  target: THREE.MeshStandardMaterial,
  key: 'map' | 'normalMap' | 'roughnessMap' | 'metalnessMap' | 'aoMap' | 'emissiveMap',
  value: THREE.Texture | null,
): boolean {
  if (target[key] !== value) {
    target[key] = value;
    return true;
  }
  return false;
}

/**
 * Apply one object's material model to an existing MeshStandardMaterial.
 *
 * Returns true when a shader-relevant property changed (a map slot or
 * transparency), so the caller can set `needsUpdate` once.
 */
export function applyMaterialSettings(
  target: THREE.MeshStandardMaterial,
  object: ObjectMaterialTarget,
): boolean {
  const slot = getSlotMaterialInfo(target);
  const presetId =
    object.material.materialId ??
    (slot?.scope === 'slot' ? slot.presetId : DEFAULT_MATERIAL_ID);
  const input: MaterialSettingsInput = { ...object.material, materialId: presetId };
  const settings = resolvePresetSettings(input);
  const preset = getMaterialPreset(presetId);
  const maps = object.material.maps;
  let needsUpdate = false;

  const stateBefore = getProceduralState(target);
  // Premium products bake albedo and ORM into 2K maps. Keep that resolution
  // when projecting settings onto an already-built premium material; the editor
  // path would otherwise regenerate the 128 px viewer set and drop the ORM.
  const premiumMaps = object.material.premiumTextures === true && preset.premiumMaps === true;
  const kind = premiumMaps
    ? (preset.textureKind ?? textureKindFor(preset.type))
    : textureKindFor(preset.type);
  const size = premiumMaps
    ? (preset.textureSize ?? stateBefore?.size ?? DEFAULT_TEXTURE_SIZE)
    : DEFAULT_TEXTURE_SIZE;
  syncProceduralTextures(target, kind, settings.textureScale, size);
  const state = getProceduralState(target);
  const ormMap = state?.textures?.ormMap ?? null;

  // A bitmap always wins over the procedural fallback. Without one, restore the
  // procedural texture (or remove the slot) so deleting a map is immediate.
  if (!maps?.baseColor) {
    needsUpdate = setMapIfChanged(target, 'map', state?.textures?.map ?? null) || needsUpdate;
  }
  if (!maps?.normal) {
    needsUpdate = setMapIfChanged(target, 'normalMap', state?.textures?.normalMap ?? null) || needsUpdate;
  }
  if (!maps?.roughness && !maps?.orm) {
    needsUpdate = setMapIfChanged(target, 'roughnessMap', ormMap) || needsUpdate;
  }
  if (!maps?.metalness && !maps?.orm) {
    needsUpdate = setMapIfChanged(target, 'metalnessMap', ormMap) || needsUpdate;
  }

  const baseColor =
    object.material.baseColor ??
    (slot?.scope === 'slot' ? slot.color : undefined) ??
    object.params.color;
  // A premium map already carries the albedo; tinting it would double-darken.
  setColorIfChanged(target.color, maps?.baseColor || premiumMaps ? '#ffffff' : baseColor);

  setNumberIfChanged(target, 'metalness', settings.metalness);
  setNumberIfChanged(target, 'roughness', settings.roughness);
  setNumberIfChanged(target, 'opacity', settings.opacity);
  setNumberIfChanged(target, 'emissiveIntensity', settings.emissiveIntensity);
  setNumberIfChanged(target, 'aoMapIntensity', settings.aoIntensity);

  if (target.normalScale.x !== settings.normalStrength) {
    target.normalScale.set(settings.normalStrength, settings.normalStrength);
  }

  const transparent = settings.opacity < 1;
  if (target.transparent !== transparent) {
    target.transparent = transparent;
    needsUpdate = true;
  }

  if (!maps?.roughness && !maps?.orm && !ormMap && target.roughnessMap) {
    needsUpdate = setMapIfChanged(target, 'roughnessMap', null) || needsUpdate;
  }
  if (!maps?.metalness && !maps?.orm && !ormMap && target.metalnessMap) {
    needsUpdate = setMapIfChanged(target, 'metalnessMap', null) || needsUpdate;
  }
  if (!maps?.ao && !maps?.orm && !ormMap && target.aoMap) {
    needsUpdate = setMapIfChanged(target, 'aoMap', null) || needsUpdate;
  }
  if (!maps?.emissive) {
    if (target.emissiveMap) {
      needsUpdate = setMapIfChanged(target, 'emissiveMap', null) || needsUpdate;
    }
    setColorIfChanged(
      target.emissive,
      object.material.emissiveColor ?? '#000000',
    );
  } else {
    setColorIfChanged(target.emissive, object.material.emissiveColor ?? '#ffffff');
  }

  return needsUpdate;
}

/** Apply in place to every unique MeshStandardMaterial under `root`. */
export function updateObjectMaterials(
  root: THREE.Object3D,
  object: ObjectMaterialTarget,
): number {
  const seen = new Set<THREE.Material>();
  let updated = 0;
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
      if (!(material instanceof THREE.MeshStandardMaterial)) {
        continue;
      }
      if (applyMaterialSettings(material, object)) {
        material.needsUpdate = true;
      }
      updated += 1;
    }
  });
  return updated;
}
