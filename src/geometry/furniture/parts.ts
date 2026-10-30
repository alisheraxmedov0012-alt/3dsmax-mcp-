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
import type { MaterialSettingsInput } from '../../materials/types';
import { applyPhysicalBoxUvs } from '../../materials/uv';

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
    this.built = buildPbrMaterial(color, material);
    this.material = this.built.material;
    this.material.name = `${groupName}-material`;
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
