/**
 * Phase 4.6 — runtime-only material metadata.
 *
 * A WeakMap keeps editor bookkeeping off `material.userData`. Three.js'
 * GLTFExporter serialises userData into `extras`, so runtime handles there would
 * leak into the GLB and make exports non-deterministic.
 */
import type * as THREE from 'three';

export interface SlotMaterialInfo {
  /** The slot's intrinsic preset, before any object-level override. */
  presetId: string;
  /** The slot/object base colour the material was built with. */
  color: string;
  /** Present only for universal slots; legacy materials follow the object colour. */
  scope?: 'slot';
}

const slotInfo = new WeakMap<THREE.Material, SlotMaterialInfo>();

export function setSlotMaterialInfo(
  material: THREE.Material,
  info: SlotMaterialInfo,
): void {
  slotInfo.set(material, info);
}

export function getSlotMaterialInfo(material: THREE.Material): SlotMaterialInfo | undefined {
  return slotInfo.get(material);
}
