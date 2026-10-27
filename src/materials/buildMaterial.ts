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

/** Export-only knobs; interactive previews never pass these. */
export interface PbrMaterialBuildOptions {
  /** Bitmap size for the procedural maps. Omitted keeps the 128 px default. */
  textureSize?: 128 | 512;
}

function resolveMaterialTextures(
  input: MaterialSettingsInput | null | undefined,
  options: PbrMaterialBuildOptions,
): { settings: ReturnType<typeof resolvePresetSettings>; textures: ReturnType<typeof createProceduralTextures> } {
  const settings = resolvePresetSettings(input);
  const preset = getMaterialPreset(settings.materialId);
  return {
    settings,
    textures: createProceduralTextures(
      textureKindFor(preset.type),
      settings.textureScale,
      options.textureSize,
    ),
  };
}

/**
 * Build a material for the given base colour (the object's albedo) and material
 * settings. Base colour comes from the object's `params.color`, so the existing
 * colour control remains the single source of truth.
 */
export function buildPbrMaterial(
  baseColor: string,
  input?: MaterialSettingsInput | null,
  options: PbrMaterialBuildOptions = {},
): BuiltMaterial {
  const { settings, textures } = resolveMaterialTextures(input, options);

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

/**
 * Export-only: swap the procedural maps on an existing material for maps at
 * `textureSize`, leaving every other property (colour, metallic, roughness,
 * opacity, normalScale, render state, name) untouched.
 *
 * Used on the fresh materials of an export scene, never on preview materials.
 * Returns a disposer for the new maps, or null for a textureless preset.
 */
export function applyTextureResolution(
  material: THREE.MeshStandardMaterial,
  input: MaterialSettingsInput | null | undefined,
  textureSize: 128 | 512,
): (() => void) | null {
  const { textures } = resolveMaterialTextures(input, { textureSize });
  if (!textures) {
    return null;
  }
  material.map = textures.map;
  material.normalMap = textures.normalMap;
  material.needsUpdate = true;
  return textures.dispose;
}
