/**
 * W6 layout presets.
 *
 * A preset produces **real furniture objects** (the W2 types) positioned and
 * rotated inside a room of the given size — not decorative names or images. The
 * objects go through the existing scene model, so they are validated, rendered,
 * saved and exported exactly like hand-placed pieces.
 *
 * All presets are pure (no Three.js) and deterministic given an id factory.
 */
import type { FurnitureParams, FurnitureType } from '../geometry/furniture/types';
import { createFurnitureParams } from '../geometry/furniture/types';
import { placeAgainstWall } from './placement';
import { createFurnitureSceneObject, type RoomConfig, type SceneObject } from './types';

export type LayoutPresetId = 'empty' | 'living' | 'bedroom' | 'office';

export const LAYOUT_PRESETS: readonly LayoutPresetId[] = ['empty', 'living', 'bedroom', 'office'];

export const LAYOUT_PRESET_LABELS: Record<LayoutPresetId, string> = {
  empty: "Bo'sh xona",
  living: 'Yashash xonasi',
  bedroom: 'Yotoqxona',
  office: 'Ish xonasi',
};

export interface LayoutItem {
  type: FurnitureType;
  /** Optional parameter overrides (e.g. a bigger sofa). */
  params?: Partial<FurnitureParams>;
  /** Fraction of the room width/length for the centre (0..1), or a wall anchor. */
  anchor: { kind: 'wall'; wall: 'north' | 'south' | 'east' | 'west'; along: number } | { kind: 'centre' };
  index: number;
}

export interface LayoutPresetSpec {
  id: LayoutPresetId;
  items: LayoutItem[];
}

/**
 * Preset definitions. Positions are resolved against the actual room size so the
 * same preset works in a small or large room.
 */
export const LAYOUT_PRESET_SPECS: Record<LayoutPresetId, LayoutPresetSpec> = {
  empty: { id: 'empty', items: [] },
  living: {
    id: 'living',
    items: [
      { type: 'sofa', anchor: { kind: 'wall', wall: 'north', along: 0.5 }, index: 1 },
      { type: 'table', params: { widthCm: 120, heightCm: 45, depthCm: 60 }, anchor: { kind: 'centre' }, index: 2 },
      { type: 'shelf', params: { widthCm: 80, heightCm: 180, depthCm: 30 }, anchor: { kind: 'wall', wall: 'west', along: 0.6 }, index: 3 },
      { type: 'armchair', anchor: { kind: 'wall', wall: 'east', along: 0.5 }, index: 4 },
    ],
  },
  bedroom: {
    id: 'bedroom',
    items: [
      { type: 'bed', anchor: { kind: 'wall', wall: 'north', along: 0.5 }, index: 1 },
      { type: 'wardrobe', params: { widthCm: 180, heightCm: 200, depthCm: 60 }, anchor: { kind: 'wall', wall: 'west', along: 0.5 }, index: 2 },
      { type: 'dresser', anchor: { kind: 'wall', wall: 'east', along: 0.6 }, index: 3 },
    ],
  },
  office: {
    id: 'office',
    items: [
      { type: 'table', params: { widthCm: 140, heightCm: 75, depthCm: 70 }, anchor: { kind: 'wall', wall: 'north', along: 0.5 }, index: 1 },
      { type: 'chair', anchor: { kind: 'centre' }, index: 2 },
      { type: 'shelf', params: { widthCm: 90, heightCm: 200, depthCm: 32 }, anchor: { kind: 'wall', wall: 'west', along: 0.5 }, index: 3 },
      { type: 'shelf', params: { widthCm: 60, heightCm: 120, depthCm: 40 }, anchor: { kind: 'wall', wall: 'east', along: 0.7 }, index: 4 },
    ],
  },
};

export function isLayoutPresetId(value: unknown): value is LayoutPresetId {
  return typeof value === 'string' && (LAYOUT_PRESETS as readonly string[]).includes(value);
}

/**
 * Build the objects for a preset in the given room. Objects are placed at the
 * room centre first and then snapped to their anchor wall (or left centred), so
 * the placement helper keeps them inside the room and facing inward.
 */
export function createLayoutObjects(
  preset: LayoutPresetId,
  room: RoomConfig,
  idFactory: () => string,
): SceneObject[] {
  const spec = LAYOUT_PRESET_SPECS[preset];
  return spec.items.map((item) => {
    // Fresh defaults per object, then apply the preset overrides in place.
    const params: FurnitureParams = Object.assign(createFurnitureParams(item.type), item.params);
    const object: SceneObject = createFurnitureSceneObject(item.type, idFactory(), { params });
    if (item.anchor.kind === 'wall') {
      // Offset the piece along the wall before snapping so multiple pieces on the
      // same wall do not stack. `along` is a fraction of the room span (0..1).
      const onX = item.anchor.wall === 'north' || item.anchor.wall === 'south';
      const offset = (onX ? room.widthCm : room.lengthCm) * (item.anchor.along - 0.5);
      object.position = onX ? { x: offset, y: 0, z: 0 } : { x: 0, y: 0, z: offset };
      const placed = placeAgainstWall(object, room, item.anchor.wall);
      object.position = placed.position;
      object.rotation = placed.rotation;
    }
    return object;
  });
}
