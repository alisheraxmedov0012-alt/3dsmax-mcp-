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
import type { MaterialAsset, TextureAssetRef, TextureMapRole } from './asset';
import { getMaterialPreset, resolvePresetSettings } from './presets';
import { textureSourceFromRef } from './textureSource';
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

/** A resolved runtime texture plus the disposer that releases it. */
export interface ResolvedMaterialTexture {
  texture: THREE.Texture;
  dispose: () => void;
}

export interface MaterialBuildDependencies {
  /**
   * Resolve a texture reference. Supplying this lets a caller plug in bitmap
   * assets (Phase 4.3) without changing the builder. Returning null marks the
   * map as missing; the material is still built without it.
   */
  resolveTexture?: (ref: TextureAssetRef) => ResolvedMaterialTexture | null;
  /** Bitmap size for built-in procedural maps; never persisted on the asset. */
  textureSize?: 128 | 512;
}

export interface BuiltAssetMaterial extends BuiltMaterial {
  /** Map slots that could not be resolved; empty for the built-in assets. */
  missingTextures: TextureMapRole[];
}

function defaultResolveTexture(
  ref: TextureAssetRef,
  textureScale: number,
  textureSize: 128 | 512 | undefined,
): ResolvedMaterialTexture | null {
  const source = textureSourceFromRef(ref);
  if (!source || source.kind !== 'procedural') {
    return null;
  }
  const textures = createProceduralTextures(source.textureKind, textureScale, textureSize);
  if (!textures) {
    return null;
  }
  return {
    texture: source.role === 'baseColor' ? textures.map : textures.normalMap,
    dispose: textures.dispose,
  };
}

/**
 * Enforce the role-based color space and wrap on a resolved texture.
 *
 * The policy is applied here, not trusted from the resolver, so a bitmap asset
 * imported in a later phase cannot accidentally be sampled as sRGB normal data.
 */
function applyTextureRole(texture: THREE.Texture, ref: TextureAssetRef): void {
  let needsUpdate = false;
  const colorSpace =
    ref.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (texture.colorSpace !== colorSpace) {
    texture.colorSpace = colorSpace;
    needsUpdate = true;
  }
  const wrap = ref.wrap === 'clamp' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  if (texture.wrapS !== wrap || texture.wrapT !== wrap) {
    texture.wrapS = wrap;
    texture.wrapT = wrap;
    needsUpdate = true;
  }
  // Three.js applies filter/wrap/colour-space state during upload, so a change
  // has to request one; an already-correct shared texture pays nothing.
  if (needsUpdate) {
    texture.needsUpdate = true;
  }
}

/**
 * Build a PBR material from a validated `MaterialAsset`.
 *
 * Additive to `buildPbrMaterial`: the legacy path is untouched, and an asset-less
 * caller keeps its current behaviour. Textures are resolved through injected
 * dependencies, so serializable asset data never references a Three.js object.
 *
 * `asset` must come from `validateMaterialAsset()` or the registry; the builder
 * does not re-validate it on every build.
 */
export function buildMaterialFromAsset(
  baseColor: string,
  asset: MaterialAsset,
  dependencies: MaterialBuildDependencies = {},
): BuiltAssetMaterial {
  const color =
    asset.colorPolicy === 'fixed' && asset.baseColor ? asset.baseColor : baseColor;
  const parameters: THREE.MeshStandardMaterialParameters = {
    color: new THREE.Color(color),
    metalness: asset.pbr.metalness,
    roughness: asset.pbr.roughness,
    opacity: asset.pbr.opacity,
    transparent: asset.pbr.opacity < 1,
  };

  const disposers: Array<() => void> = [];
  const missingTextures: TextureMapRole[] = [];

  const resolve = (ref: TextureAssetRef): THREE.Texture | null => {
    const resolved = dependencies.resolveTexture
      ? dependencies.resolveTexture(ref)
      : defaultResolveTexture(ref, asset.pbr.textureScale, dependencies.textureSize);
    if (!resolved) {
      missingTextures.push(ref.role);
      return null;
    }
    applyTextureRole(resolved.texture, ref);
    disposers.push(resolved.dispose);
    return resolved.texture;
  };

  const baseMap = asset.maps.baseColor ? resolve(asset.maps.baseColor) : null;
  if (baseMap) {
    parameters.map = baseMap;
  }
  const normalMap = asset.maps.normal ? resolve(asset.maps.normal) : null;
  if (normalMap) {
    parameters.normalMap = normalMap;
    parameters.normalScale = new THREE.Vector2(
      asset.pbr.normalStrength,
      asset.pbr.normalStrength,
    );
  }

  const material = new THREE.MeshStandardMaterial(parameters);

  let disposed = false;
  return {
    material,
    missingTextures,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      disposers.forEach((dispose) => dispose());
      material.dispose();
    },
  };
}
