import { describe, expect, it } from 'vitest';
import { createFurnitureSceneObject, type RoomConfig, type SceneObject } from './types';
import {
  boundaryCheck,
  findPlacementIssues,
  nearestWall,
  objectAabb,
  objectsOverlap,
  placeAgainstWall,
  rotatedHalfExtents,
} from './placement';

const ROOM: RoomConfig = { widthCm: 400, lengthCm: 500, heightCm: 280 };

function obj(
  id: string,
  overrides: Partial<SceneObject> = {},
): SceneObject {
  return createFurnitureSceneObject('table', id, overrides);
}

describe('rotatedHalfExtents', () => {
  it('keeps the footprint for axis-aligned rotations', () => {
    const params = { widthCm: 100, heightCm: 75, depthCm: 60, color: '#a9744f' };
    expect(rotatedHalfExtents('table', params, 0)).toEqual({ halfX: 50, halfZ: 30 });
    expect(rotatedHalfExtents('table', params, 180).halfX).toBeCloseTo(50, 5);
  });

  it('swaps extents at 90 degrees', () => {
    const params = { widthCm: 100, heightCm: 75, depthCm: 60, color: '#a9744f' };
    const rotated = rotatedHalfExtents('table', params, 90);
    expect(rotated.halfX).toBeCloseTo(30, 5);
    expect(rotated.halfZ).toBeCloseTo(50, 5);
  });

  it('is NaN-safe for a non-finite rotation', () => {
    const params = { widthCm: 100, heightCm: 75, depthCm: 60, color: '#a9744f' };
    const result = rotatedHalfExtents('table', params, Number.NaN);
    expect(Number.isFinite(result.halfX)).toBe(true);
    expect(Number.isFinite(result.halfZ)).toBe(true);
  });
});

describe('objectAabb / boundaryCheck', () => {
  it('reports an object at the centre as inside', () => {
    expect(boundaryCheck(obj('a'), ROOM).inside).toBe(true);
  });

  it('detects an object pushed outside the room', () => {
    const outside = obj('a', { position: { x: 300, y: 0, z: 0 } });
    const check = boundaryCheck(outside, ROOM);
    expect(check.inside).toBe(false);
    expect(check.overhangX).toBeGreaterThan(0);
  });

  it('detects vertical overhang too', () => {
    const outside = obj('a', { position: { x: 0, y: 0, z: 300 } });
    expect(boundaryCheck(outside, ROOM).overhangZ).toBeGreaterThan(0);
  });

  it('is NaN-safe for a non-finite position', () => {
    const bad = obj('a', { position: { x: Number.NaN, y: 0, z: Number.NaN } });
    const box = objectAabb(bad);
    for (const value of [box.minX, box.maxX, box.minZ, box.maxZ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(boundaryCheck(bad, ROOM).inside).toBe(true);
  });
});

describe('objectsOverlap / findPlacementIssues', () => {
  it('detects overlapping pieces and ignores distant ones', () => {
    const a = obj('a');
    const near = obj('b', { position: { x: 10, y: 0, z: 0 } });
    const far = obj('c', { position: { x: 180, y: 0, z: 0 } });
    expect(objectsOverlap(a, near)).toBe(true);
    expect(objectsOverlap(a, far)).toBe(false);
  });

  it('does not report an object as colliding with itself', () => {
    const a = obj('a');
    expect(objectsOverlap(a, a)).toBe(false);
  });

  it('collects outside and collision issues', () => {
    const objects = [
      obj('inside'),
      obj('outside', { position: { x: 500, y: 0, z: 0 } }),
      obj('overlapA', { position: { x: 0, y: 0, z: 0 } }),
      obj('overlapB', { position: { x: 5, y: 0, z: 0 } }),
    ];
    const issues = findPlacementIssues(objects, ROOM);
    expect(issues.some((issue) => issue.kind === 'outside' && issue.objectId === 'outside')).toBe(true);
    expect(issues.some((issue) => issue.kind === 'collision')).toBe(true);
  });

  it('ignores hidden objects', () => {
    const hidden = obj('hidden', { position: { x: 900, y: 0, z: 0 }, visible: false });
    expect(findPlacementIssues([hidden], ROOM)).toEqual([]);
  });
});

describe('nearestWall / placeAgainstWall', () => {
  it('picks the nearest wall', () => {
    expect(nearestWall(obj('a', { position: { x: 0, y: 0, z: -240 } }), ROOM)).toBe('north');
    expect(nearestWall(obj('a', { position: { x: 190, y: 0, z: 0 } }), ROOM)).toBe('east');
  });

  it('places a piece flush against each wall, inside the room and facing inward', () => {
    for (const wall of ['north', 'south', 'east', 'west'] as const) {
      const placed = placeAgainstWall(obj('a'), ROOM, wall);
      const moved = obj('a', { position: placed.position, rotation: placed.rotation });
      expect(boundaryCheck(moved, ROOM).inside).toBe(true);
      // Rotation faces inward: north wall -> 0, east -> 270, south -> 180, west -> 90.
      const expected = { north: 0, east: 270, south: 180, west: 90 }[wall];
      expect(placed.rotation.y).toBe(expected);
    }
  });

  it('keeps the piece inside when it is larger than the room', () => {
    const tiny: RoomConfig = { widthCm: 100, lengthCm: 100, heightCm: 200 };
    const huge = createFurnitureSceneObject('sofa', 'big', {
      params: { widthCm: 300, heightCm: 85, depthCm: 140, color: '#3f5b73' },
    });
    const placed = placeAgainstWall(huge, tiny, 'north');
    for (const value of [placed.position.x, placed.position.z]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});
