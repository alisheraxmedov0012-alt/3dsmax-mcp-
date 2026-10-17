import { describe, expect, it } from 'vitest';
import { FURNITURE_DEFAULTS, FURNITURE_TYPES, validateFurnitureParams } from '../geometry/furniture';
import { buildFurnitureSpec, isBuildable } from './furnitureSpec';

/**
 * W13 — the AI spec must be able to drive every furniture type, and the result
 * must always be accepted by the geometry layer before it is applied.
 */
describe('buildFurnitureSpec', () => {
  it('builds valid parameters for all eight types', () => {
    for (const type of FURNITURE_TYPES) {
      const built = buildFurnitureSpec(type, null, null);
      expect(built, type).not.toBeNull();
      if (!built) continue;
      expect(built.type).toBe(type);
      // The geometry layer must accept what we are about to apply.
      expect(validateFurnitureParams(type, built.params), type).not.toBeNull();
    }
  });

  it('starts from the type defaults when the spec carries no dimensions', () => {
    const built = buildFurnitureSpec('wardrobe', null, null);
    expect(built).not.toBeNull();
    if (!built) return;
    expect(built.params.widthCm).toBe(FURNITURE_DEFAULTS.wardrobe.widthCm);
    expect(built.params.heightCm).toBe(FURNITURE_DEFAULTS.wardrobe.heightCm);
    expect(built.params.shelfCount).toBe(FURNITURE_DEFAULTS.wardrobe.shelfCount);
    expect(built.notes.join(' ')).toContain('standart');
  });

  it('applies provided dimensions and keeps the other channels at defaults', () => {
    const built = buildFurnitureSpec(
      'bed',
      { width_cm: 160, height_cm: 45, depth_cm: 200 },
      null,
    );
    expect(built).not.toBeNull();
    if (!built) return;
    expect(built.params.widthCm).toBe(160);
    expect(built.params.heightCm).toBe(45);
    expect(built.params.depthCm).toBe(200);
    expect(built.params.mattressHeightCm).toBe(FURNITURE_DEFAULTS.bed.mattressHeightCm);
    expect(validateFurnitureParams('bed', built.params)).not.toBeNull();
  });

  it('keeps bed axes literal: width is X, depth is Z, height is the frame height', () => {
    const built = buildFurnitureSpec(
      'bed',
      { width_cm: 160, height_cm: 40, depth_cm: 200 },
      null,
    );
    expect(built).not.toBeNull();
    if (!built) return;
    // Depth is the head-board-to-foot extent; height is *not* reinterpreted.
    expect(built.params.depthCm).toBe(200);
    expect(built.params.widthCm).toBe(160);
    expect(built.params.heightCm).toBe(40);
  });

  it('clamps out-of-range values and reports each adjustment', () => {
    const built = buildFurnitureSpec(
      'table',
      { width_cm: 999, height_cm: 75, depth_cm: 60 },
      null,
    );
    expect(built).not.toBeNull();
    if (!built) return;
    expect(built.params.widthCm).toBe(240); // table maximum
    expect(built.warnings.join(' ')).toContain('Kenglik');
    expect(validateFurnitureParams('table', built.params)).not.toBeNull();
  });

  it('applies type-specific details when they belong to the type', () => {
    const built = buildFurnitureSpec(
      'wardrobe',
      { width_cm: 180, height_cm: 200, depth_cm: 60 },
      { doorCount: 3, shelfCount: 5 },
    );
    expect(built).not.toBeNull();
    if (!built) return;
    expect(built.params.doorCount).toBe(3);
    expect(built.params.shelfCount).toBe(5);
  });

  it('ignores details that are not a channel of the type', () => {
    const built = buildFurnitureSpec(
      'table',
      { width_cm: 120, height_cm: 75, depth_cm: 60 },
      { drawerCount: 4 },
    );
    expect(built).not.toBeNull();
    if (!built) return;
    expect(built.params.drawerCount).toBeUndefined();
  });

  it('ignores a non-finite value with a warning instead of applying it', () => {
    const built = buildFurnitureSpec(
      'table',
      { width_cm: Number.NaN, height_cm: 75, depth_cm: 60 },
      null,
    );
    expect(built).not.toBeNull();
    if (!built) return;
    expect(Number.isFinite(built.params.widthCm)).toBe(true);
    expect(built.params.widthCm).toBe(FURNITURE_DEFAULTS.table.widthCm);
    expect(built.warnings.length).toBeGreaterThan(0);
  });

  it('replaces an invalid colour with the default and says so', () => {
    const built = buildFurnitureSpec('chair', null, null, 'not-a-colour');
    expect(built).not.toBeNull();
    if (!built) return;
    expect(built.params.color).toBe(FURNITURE_DEFAULTS.chair.color);
    expect(built.warnings.join(' ')).toContain('Rang');
  });

  it('accepts a valid colour', () => {
    const built = buildFurnitureSpec('sofa', null, null, '#FFFFFF');
    expect(built).not.toBeNull();
    if (!built) return;
    expect(built.params.color).toBe('#ffffff');
  });

  it('returns a fresh object, never a shared default', () => {
    const first = buildFurnitureSpec('table', { width_cm: 100, height_cm: 75, depth_cm: 60 }, null);
    const second = buildFurnitureSpec('table', null, null);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) return;
    expect(first.params).not.toBe(second.params);
    expect(first.params.widthCm).toBe(100);
    // Mutating one result must not change the module defaults.
    first.params.widthCm = 200;
    expect(FURNITURE_DEFAULTS.table.widthCm).toBe(120);
  });
});

describe('isBuildable', () => {
  it('accepts all eight types and rejects anything else', () => {
    for (const type of FURNITURE_TYPES) {
      expect(isBuildable(type)).toBe(true);
    }
    expect(isBuildable('spaceship')).toBe(false);
  });
});
