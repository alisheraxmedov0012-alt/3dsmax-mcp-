/**
 * Build a Three.js PBR material from the W4 material settings.
 *
 * This is the only place where the (Three.js-free) material model meets Three.js.
 * It resolves/validates the settings, looks up the preset to decide which
 * procedural texture to generate, and produces a `MeshStandardMaterial` — the
 * same material type already used by the Stage 6 renderer and the GLB exporter,
 * so textures, metalness/roughness and opacity are all preserved on export.
 */
import * as THREE from 'three';
import { getMaterialPreset, resolvePresetSettings } from './presets';
import { createProceduralTextures, textureKindFor } from './textures';
import type { MaterialSettingsInput } from './types';

export interface BuiltMaterial {
  material: THREE.MeshStandardMaterial;
  dispose: () => void;
}

/**
 * Build a material for the given base colour (the object's albedo) and material
 * settings. Base colour comes from the object's `params.color`, so the existing
 * colour control remains the single source of truth.
 */
export function buildPbrMaterial(
  baseColor: string,
  input?: MaterialSettingsInput | null,
): BuiltMaterial {
  const settings = resolvePresetSettings(input);
  const preset = getMaterialPreset(settings.materialId);

  const textures = createProceduralTextures(
    textureKindFor(preset.type),
    settings.textureScale,
  );

  const parameters: THREE.MeshStandardMaterialParameters = {
    color: new THREE.Color(baseColor),
    metalness: settings.metalness,
    roughness: settings.roughness,
    opacity: settings.opacity,
    transparent: settings.opacity < 1,
  };

  if (textures) {
    parameters.map = textures.map;
    parameters.normalMap = textures.normalMap;
    parameters.normalScale = new THREE.Vector2(settings.normalStrength, settings.normalStrength);
  }

  const material = new THREE.MeshStandardMaterial(parameters);

  return {
    material,
    dispose: () => {
      textures?.dispose();
      material.dispose();
    },
  };
}
