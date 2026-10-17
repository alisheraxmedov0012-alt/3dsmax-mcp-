import { describe, expect, it } from 'vitest';
import type { AiDesignSpec } from '../api/client';
import {
  FURNITURE_TYPES,
  SUPPORTED_FURNITURE_TYPES,
  isSupportedFurnitureType,
  specToFurnitureParams,
  specToTableProposal,
} from './designSpec';

function makeSpec(overrides: Partial<AiDesignSpec> = {}): AiDesignSpec {
  return {
    furniture: 'table',
    dimensions: null,
    color: null,
    material_kind: null,
    style: null,
    confidence: 'low',
    notes: [],
    warnings: [],
    supported: true,
    ...overrides,
  };
}

describe('designSpec vocabulary', () => {
  it('lists the full W2 furniture vocabulary', () => {
    expect(FURNITURE_TYPES).toContain('table');
    expect(FURNITURE_TYPES).toContain('sofa');
    expect(FURNITURE_TYPES).toContain('wardrobe');
  });

  it('treats every type with a builder as buildable', () => {
    // W13: all eight geometry types are reachable from the AI contract.
    expect([...SUPPORTED_FURNITURE_TYPES].sort()).toEqual([...FURNITURE_TYPES].sort());
    for (const type of FURNITURE_TYPES) {
      expect(isSupportedFurnitureType(type)).toBe(true);
    }
  });

  it('maps dimensions and colour onto the table proposal shape', () => {
    const proposal = specToTableProposal(
      makeSpec({
        dimensions: { width_cm: 180, height_cm: 75, depth_cm: 60 },
        color: '#a9744f',
      }),
    );
    expect(proposal).toEqual({
      widthCm: 180,
      heightCm: 75,
      depthCm: 60,
      color: '#a9744f',
    });
  });

  it('leaves values undefined when the spec carries no dimensions', () => {
    const proposal = specToTableProposal(makeSpec({ dimensions: null }));
    expect(proposal.widthCm).toBeUndefined();
    expect(proposal.heightCm).toBeUndefined();
    expect(proposal.depthCm).toBeUndefined();
  });
});

describe('specToFurnitureParams', () => {
  it('maps a legacy table spec that has no details (backward compatible)', () => {
    const built = specToFurnitureParams(
      makeSpec({
        furniture: 'table',
        dimensions: { width_cm: 180, height_cm: 75, depth_cm: 60 },
        color: '#a9744f',
      }),
    );
    expect(built).not.toBeNull();
    if (!built) return;
    expect(built.type).toBe('table');
    expect(built.params.widthCm).toBe(180);
    expect(built.params.color).toBe('#a9744f');
  });

  it('returns null for a spec marked unsupported', () => {
    expect(specToFurnitureParams(makeSpec({ furniture: 'sofa', supported: false }))).toBeNull();
  });

  it('builds every supported type', () => {
    for (const type of FURNITURE_TYPES) {
      const built = specToFurnitureParams(makeSpec({ furniture: type }));
      expect(built, type).not.toBeNull();
      if (!built) continue;
      expect(built.type).toBe(type);
    }
  });
});
