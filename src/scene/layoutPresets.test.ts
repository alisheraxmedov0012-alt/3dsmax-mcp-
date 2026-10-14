import { describe, expect, it } from 'vitest';
import {
  LAYOUT_PRESETS,
  LAYOUT_PRESET_SPECS,
  createLayoutObjects,
  isLayoutPresetId,
} from './layoutPresets';
import { findPlacementIssues } from './placement';
import type { RoomConfig } from './types';

const ROOM: RoomConfig = { widthCm: 500, lengthCm: 600, heightCm: 280 };

function ids() {
  let counter = 0;
  return () => `id-${++counter}`;
}

describe('layout presets', () => {
  it('lists the documented presets', () => {
    expect(LAYOUT_PRESETS).toEqual(['empty', 'living', 'bedroom', 'office']);
    expect(isLayoutPresetId('living')).toBe(true);
    expect(isLayoutPresetId('garage')).toBe(false);
  });

  it('produces real furniture objects for the non-empty presets', () => {
    for (const preset of ['living', 'bedroom', 'office'] as const) {
      const objects = createLayoutObjects(preset, ROOM, ids());
      expect(objects.length).toBe(LAYOUT_PRESET_SPECS[preset].items.length);
      expect(objects.length).toBeGreaterThan(0);
      for (const object of objects) {
        // A real object with valid params and a finite transform.
        expect(object.params.widthCm).toBeGreaterThan(0);
        for (const v of [object.position.x, object.position.y, object.position.z]) {
          expect(Number.isFinite(v)).toBe(true);
        }
      }
    }
  });

  it('produces no objects for the empty preset', () => {
    expect(createLayoutObjects('empty', ROOM, ids())).toEqual([]);
  });

  it('keeps every preset object inside the room with no overlaps', () => {
    for (const preset of ['living', 'bedroom', 'office'] as const) {
      const objects = createLayoutObjects(preset, ROOM, ids());
      const issues = findPlacementIssues(objects, ROOM);
      expect(issues).toEqual([]);
    }
  });

  it('works in a smaller room too', () => {
    const small: RoomConfig = { widthCm: 300, lengthCm: 320, heightCm: 250 };
    const objects = createLayoutObjects('office', small, ids());
    for (const object of objects) {
      for (const v of [object.position.x, object.position.z]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('uses the id factory for unique ids', () => {
    const objects = createLayoutObjects('living', ROOM, ids());
    const unique = new Set(objects.map((object) => object.id));
    expect(unique.size).toBe(objects.length);
  });
});
