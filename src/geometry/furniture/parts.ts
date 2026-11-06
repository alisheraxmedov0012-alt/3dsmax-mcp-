/**
 * Small shared helper for building furniture out of named box parts.
 *
 * Every part is a box mesh with a stable name and `userData.partId`, so parts can
 * be addressed later (e.g. W4 per-part materials). This keeps the per-type
 * builders short and avoids repeating geometry/material bookkeeping, without
 * introducing a heavier abstraction.
 */
import * as THREE from 'three';
import { buildPbrMaterial } from '../../materials/buildMaterial';
import { DEFAULT_MATERIAL_ID, type MaterialSettingsInput } from '../../materials/types';
import { setSlotMaterialInfo } from '../../materials/materialRuntimeMetadata';
import {
  applyPhysicalBoxUvs,
  applyUvMapping,
  setUvDiagnostics,
  validateUvGeometry,
  type UvOrientation,
  type UvPlane,
  type UvRequestedMode,
} from '../../materials/uv';
import {
  createGeometry,
  GeometryKernelError,
  type CreateGeometryOptions,
  type GeometryRecipe,
} from '../kernel';

/**
 * Material settings a furniture builder accepts.
 *
 * This is the W4 PBR model: `materialId` selects a preset (which decides the
 * procedural texture), and the channels below it override it per object. Every
 * field is optional, so the original `{metalness, roughness}` callers keep
 * working unchanged and a builder called with no material still renders with the
 * default preset.
 */
export type PartMaterialOptions = MaterialSettingsInput;

/**
 * Options for the new kernel path. `physical-box` keeps the legacy 50 cm tiling
 * used by `box()`; `auto` selects the physical mapping suitable for the recipe;
 * other recipes keep their native UVs unless a physical mode is requested.
 */
export interface AddGeometryOptions extends CreateGeometryOptions {
  readonly uv?: UvRequestedMode;
  readonly uvOrientation?: UvOrientation;
  readonly uvTileCm?: number;
  readonly uvPlane?: UvPlane;
  readonly uvSeamOffset?: number;
  readonly uvFlipU?: boolean;
  readonly uvFlipV?: boolean;
}

/**
 * True only for a box whose faces still have the 24-vertex layout expected by
 * `applyPhysicalBoxUvs()`. A segmented box keeps its native UVs instead.
 */
function isUnsegmentedBox(recipe: GeometryRecipe): boolean {
  return (
    recipe.kind === 'box' &&
    (recipe.widthSegments ?? 1) === 1 &&
    (recipe.heightSegments ?? 1) === 1 &&
    (recipe.depthSegments ?? 1) === 1
  );
}

export interface BuiltFurniture {
  group: THREE.Group;
  dispose: () => void;
}

/** Ensures a dimension is a positive, finite number before it reaches geometry. */
export function safeSize(value: number, min = 0.5): number {
  return Number.isFinite(value) && value > 0 ? Math.max(value, min) : min;
}

/** Clamps a possibly-missing value into [min, max], falling back when non-finite. */
export function clampValue(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(Math.max(numeric, lower), upper);
}

export class PartBuilder {
  readonly group = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  private readonly built: ReturnType<typeof buildPbrMaterial>;

  constructor(groupName: string, color: string, material: PartMaterialOptions = {}) {
    this.group.name = groupName;
    // One PBR material per object, shared by all of its parts: this is where a
    // furniture piece picks up its preset and procedural texture. `buildPbrMaterial`
    // owns the texture lifetime, so it must be disposed through `built.dispose`.
    this.built = buildPbrMaterial(material.baseColor ?? color, material);
    this.material = this.built.material;
    this.material.name = `${groupName}-material`;
    setSlotMaterialInfo(this.material, {
      presetId: DEFAULT_MATERIAL_ID,
      color: material.baseColor ?? color,
    });
  }

  /**
   * Record the intrinsic slot preset/colour. Universal builds override the
   * material with an object-level preset; keeping the slot defaults lets the
   * real-time editor fall back correctly when that override is removed.
   */
  setSlotBase(presetId: string, color: string): void {
    setSlotMaterialInfo(this.material, { presetId, color, scope: 'slot' });
  }

  /** Overrides the default `<groupName>-material` name for product-facing assets. */
  setMaterialName(name: string): void {
    this.material.name = name;
  }

  /** Adds a box part centred at `position` (cm). */
  box(
    partId: string,
    size: [number, number, number],
    position: [number, number, number],
    rotation?: [number, number, number],
  ): THREE.Mesh {
    const [width, height, depth] = [
      safeSize(size[0]),
      safeSize(size[1]),
      safeSize(size[2]),
    ] as const;
    const geometry = new THREE.BoxGeometry(width, height, depth);
    applyPhysicalBoxUvs(geometry, [width, height, depth]);
    setUvDiagnostics(geometry, validateUvGeometry(geometry));
    return this.addMesh(partId, geometry, position, rotation);
  }

  /**
   * Adds a part from a declarative geometry recipe.
   *
   * The legacy `box()` path above is unchanged. Box recipes default to the same
   * physical UV tiling as `box()`; all other recipes keep the UVs produced by
   * Three.js (or the planar fallback used by custom geometry).
   */
  addGeometry(
    partId: string,
    recipe: GeometryRecipe,
    position: [number, number, number],
    rotation?: [number, number, number],
    options: AddGeometryOptions = {},
  ): THREE.Mesh {
    const {
      uv: requestedUv,
      uvOrientation,
      uvTileCm,
      uvPlane,
      uvSeamOffset,
      uvFlipU,
      uvFlipV,
      ...geometryOptions
    } = options;
    const uv =
      requestedUv ??
      (isUnsegmentedBox(recipe) ? 'physical-box' : 'geometry');

    if (uv === 'physical-box') {
      if (recipe.kind !== 'box') {
        throw new GeometryKernelError(
          'unsupported_recipe',
          'physical-box UV faqat box recipe uchun qo‘llanadi.',
        );
      }
      if (!isUnsegmentedBox(recipe)) {
        throw new GeometryKernelError(
          'unsupported_recipe',
          'physical-box UV segmented box uchun qo‘llanmaydi; uv: "geometry" dan foydalaning.',
        );
      }
    }
    if (
      uv === 'box' &&
      recipe.kind !== 'box' &&
      recipe.kind !== 'roundedBox' &&
      recipe.kind !== 'extrude' &&
      recipe.kind !== 'custom'
    ) {
      throw new GeometryKernelError(
        'unsupported_recipe',
        'box UV faqat box, roundedBox, extrude yoki custom recipe uchun qo‘llanadi.',
      );
    }
    if (
      uv === 'cylindrical' &&
      recipe.kind !== 'cylinder' &&
      recipe.kind !== 'capsule' &&
      recipe.kind !== 'lathe' &&
      recipe.kind !== 'tube'
    ) {
      throw new GeometryKernelError(
        'unsupported_recipe',
        'cylindrical UV faqat radial recipe uchun qo‘llanadi.',
      );
    }

    const geometry = createGeometry(recipe, geometryOptions);
    if (uv === 'physical-box' && recipe.kind === 'box') {
      const applied = applyPhysicalBoxUvs(geometry, [
        recipe.width,
        recipe.height,
        recipe.depth,
      ]);
      if (!applied) {
        geometry.dispose();
        throw new GeometryKernelError(
          'invalid_geometry',
          'physical-box UV qo‘llanmadi; geometry disposal qilindi.',
        );
      }
    } else if (uv !== 'geometry' && uv !== 'preserve') {
      const result = applyUvMapping(geometry, recipe, {
        mode: uv,
        ...(uvOrientation === undefined ? {} : { orientation: uvOrientation }),
        ...(uvTileCm === undefined ? {} : { tileCm: uvTileCm }),
        ...(uvPlane === undefined ? {} : { plane: uvPlane }),
        ...(uvSeamOffset === undefined ? {} : { seamOffset: uvSeamOffset }),
        ...(uvFlipU === undefined ? {} : { flipU: uvFlipU }),
        ...(uvFlipV === undefined ? {} : { flipV: uvFlipV }),
      });
      const expectedPhysical =
        uv !== 'auto' && result.mode !== 'preserve';
      if (expectedPhysical && !result.applied) {
        geometry.dispose();
        throw new GeometryKernelError(
          'invalid_geometry',
          `UV mapping (${uv}) qo‘llanmadi; geometry disposal qilindi.`,
        );
      }
    }

    setUvDiagnostics(geometry, validateUvGeometry(geometry));
    return this.addMesh(partId, geometry, position, rotation);
  }

  private addMesh(
    partId: string,
    geometry: THREE.BufferGeometry,
    position: [number, number, number],
    rotation?: [number, number, number],
  ): THREE.Mesh {
    this.geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = partId;
    mesh.userData.partId = partId;
    mesh.position.set(position[0], position[1], position[2]);
    if (rotation) {
      mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  dispose(): void {
    this.geometries.forEach((geometry) => geometry.dispose());
    // Releases the material and its (possibly shared) textures.
    this.built.dispose();
  }
}
