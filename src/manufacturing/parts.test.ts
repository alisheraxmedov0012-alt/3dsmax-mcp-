import { describe, expect, it } from 'vitest';
import { buildFurniture } from '../geometry/furniture/buildFurniture';
import { createFurnitureParams, FURNITURE_TYPES } from '../geometry/furniture/types';
import {
  PANEL_KINDS,
  groupParts,
  measureParts,
  minDimensionCm,
  partCountByKind,
  partKindFromId,
  partTypeOf,
  totalPartCount,
  type MeasuredPart,
} from './parts';

function part(partId: string, kind: string, x: number, y: number, z: number): MeasuredPart {
  return { partId, kind: kind as MeasuredPart['kind'], sizeXCm: x, sizeYCm: y, sizeZCm: z };
}

describe('partKindFromId', () => {
  it('strips the type prefix and numeric suffix', () => {
    expect(partKindFromId('table', 'table-leg-1')).toBe('leg');
    expect(partKindFromId('wardrobe', 'wardrobe-shelf-4')).toBe('shelf');
    expect(partKindFromId('table', 'table-top')).toBe('top');
    expect(partKindFromId('bed', 'bed-headboard')).toBe('headboard');
    expect(partKindFromId('shelf', 'shelf-side-2')).toBe('side');
  });

  it('falls back to unknown for an unrecognised id', () => {
    expect(partKindFromId('table', 'table-mystery-3')).toBe('unknown');
    expect(partKindFromId('table', 'nonsense')).toBe('unknown');
  });
});

describe('partTypeOf', () => {
  it('classifies posts, blocks, upholstery and panels', () => {
    expect(partTypeOf('leg')).toBe('post');
    expect(partTypeOf('arm')).toBe('post');
    expect(partTypeOf('body')).toBe('block');
    expect(partTypeOf('mattress')).toBe('upholstery');
    expect(partTypeOf('top')).toBe('panel');
    expect(partTypeOf('shelf')).toBe('panel');
  });
});

describe('groupParts', () => {
  it('merges only identical kind+size parts and counts them', () => {
    const groups = groupParts([
      part('table-leg-1', 'leg', 6, 71, 6),
      part('table-leg-2', 'leg', 6, 71, 6),
      part('table-leg-3', 'leg', 6, 71, 6),
      part('table-leg-4', 'leg', 6, 71, 6),
      part('table-top', 'top', 120, 4, 60),
    ]);
    expect(groups).toHaveLength(2);
    const legs = groups.find((g) => g.kind === 'leg');
    expect(legs?.quantity).toBe(4);
    const top = groups.find((g) => g.kind === 'top');
    expect(top?.quantity).toBe(1);
    expect(totalPartCount(groups)).toBe(5);
  });

  it('never merges different sizes of the same kind', () => {
    const groups = groupParts([
      part('shelf-board-1', 'board', 76, 2, 28),
      part('shelf-board-2', 'board', 76, 2, 30),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.quantity === 1)).toBe(true);
  });

  it('reports counts per kind', () => {
    const groups = groupParts([
      part('wardrobe-side-1', 'side', 2, 200, 60),
      part('wardrobe-side-2', 'side', 2, 200, 60),
      part('wardrobe-door-1', 'door', 87, 195, 1.2),
    ]);
    expect(partCountByKind(groups)).toEqual({ side: 2, door: 1 });
  });
});

describe('measureParts on real geometry', () => {
  it('measures every part of every furniture type with finite sizes', () => {
    for (const type of FURNITURE_TYPES) {
      const built = buildFurniture(type, createFurnitureParams(type));
      try {
        const parts = measureParts(type, built.group);
        expect(parts.length).toBeGreaterThan(1);
        for (const entry of parts) {
          expect(Number.isFinite(entry.sizeXCm)).toBe(true);
          expect(entry.sizeXCm).toBeGreaterThan(0);
          expect(entry.kind).not.toBe('unknown');
        }
      } finally {
        built.dispose();
      }
    }
  });

  it('measures the table as one top plus four identical legs', () => {
    const built = buildFurniture('table', createFurnitureParams('table'));
    try {
      const groups = groupParts(measureParts('table', built.group));
      const top = groups.find((g) => g.kind === 'top');
      const legs = groups.find((g) => g.kind === 'leg');
      expect(top?.quantity).toBe(1);
      expect(legs?.quantity).toBe(4);
      // Measured from geometry: 120 cm wide, 4 cm thick, 60 cm deep.
      expect(top?.sizeXCm).toBeCloseTo(120, 3);
      expect(minDimensionCm(top!)).toBeCloseTo(4, 3);
    } finally {
      built.dispose();
    }
  });

  it('keeps every panel kind in the declared list', () => {
    for (const type of FURNITURE_TYPES) {
      const built = buildFurniture(type, createFurnitureParams(type));
      try {
        for (const entry of measureParts(type, built.group)) {
          if (partTypeOf(entry.kind) === 'panel') {
            expect(PANEL_KINDS).toContain(entry.kind);
          }
        }
      } finally {
        built.dispose();
      }
    }
  });
});
