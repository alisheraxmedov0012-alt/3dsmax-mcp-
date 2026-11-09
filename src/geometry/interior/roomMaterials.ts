/**
 * Phase 9A.2.5 — room material resolution.
 *
 * `RoomSpec.materials` stores per-slot parameters with the room; a
 * `RoomInstance` may override any slot for one placement. Both layers use the
 * existing material preset registry and `MaterialSettingsInput` channels, so
 * there is exactly one material pipeline.
 *
 * The physical tile resolution is the only room-specific rule: a slot's
 * real-world texture size comes from the instance override, then the stored
 * spec, then the selected preset, and finally the global 50 cm tile.
 */
import { getMaterialPreset } from '../../materials/presets';
import { DEFAULT_UV_TILE_CM, type MaterialSettingsInput } from '../../materials/types';
import type { RoomMaterialsSpec, RoomSlotMaterialSpec, RoomSpec } from './types';

/** The slot fields resolution needs; `ROOM_SLOTS` satisfies this shape. */
export interface RoomMaterialSlotRef {
  readonly id: string;
  readonly materialId: string;
}

function finiteTile(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

/** Real-world texture tile for one slot, in centimetres. */
export function resolveRoomSlotTileCm(
  slot: RoomMaterialSlotRef,
  spec: RoomSpec,
  instanceAssignment?: MaterialSettingsInput,
): number {
  const specMaterial = spec.materials?.[slot.id as keyof RoomMaterialsSpec];
  const effectivePresetId =
    instanceAssignment?.materialId ?? specMaterial?.materialId ?? slot.materialId;
  const trimTileCm =
    slot.id === 'baseboard'
      ? spec.trim?.baseboard?.tileCm
      : slot.id === 'crown-molding'
        ? spec.trim?.crownMolding?.tileCm
        : undefined;
  return (
    finiteTile(instanceAssignment?.physicalTileCm) ??
    finiteTile(specMaterial?.physicalTileCm) ??
    finiteTile(trimTileCm) ??
    finiteTile(getMaterialPreset(effectivePresetId).physicalTileCm) ??
    DEFAULT_UV_TILE_CM
  );
}

/** Material overrides for one slot; an instance assignment wins per channel. */
export function resolveRoomSlotMaterial(
  specMaterial: RoomSlotMaterialSpec | undefined,
  instanceAssignment: MaterialSettingsInput | undefined,
): MaterialSettingsInput | undefined {
  if (!specMaterial && !instanceAssignment) {
    return undefined;
  }
  const merged: MaterialSettingsInput = {
    ...(specMaterial as MaterialSettingsInput | undefined),
    ...instanceAssignment,
  };
  // Choosing a preset also applies its suggested base colour, matching what the
  // material panel shows. An explicit baseColor always wins.
  if (merged.materialId !== undefined && merged.baseColor === undefined) {
    const presetColor = getMaterialPreset(merged.materialId).color;
    if (presetColor) {
      merged.baseColor = presetColor;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export interface ResolvedRoomMaterials {
  /** Slot overrides to pass to `buildPlanWithDefinition`. */
  readonly overrides: Readonly<Record<string, MaterialSettingsInput>>;
  /** Per-slot physical UV tile in centimetres. */
  readonly tiles: Readonly<Record<string, number>>;
}

/**
 * Merge the stored spec layer with an instance layer for every definition
 * slot. Slots with no parameters are omitted from `overrides` and fall back to
 * the definition's own slot defaults (precedence step 3).
 */
export function resolveRoomMaterials(
  slots: readonly RoomMaterialSlotRef[],
  spec: RoomSpec,
  instanceAssignments?: Readonly<Record<string, MaterialSettingsInput>>,
): ResolvedRoomMaterials {
  const overrides: Record<string, MaterialSettingsInput> = {};
  const tiles: Record<string, number> = {};

  for (const slot of slots) {
    const specMaterial = spec.materials?.[slot.id as keyof RoomMaterialsSpec];
    const instanceAssignment = instanceAssignments?.[slot.id];
    const merged = resolveRoomSlotMaterial(specMaterial, instanceAssignment);
    if (merged) {
      overrides[slot.id] = merged;
    }
    tiles[slot.id] = resolveRoomSlotTileCm(slot, spec, instanceAssignment);
  }

  return {
    overrides: Object.freeze(overrides),
    tiles: Object.freeze(tiles),
  };
}
