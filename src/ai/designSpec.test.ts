import { describe, expect, it } from 'vitest';
import type { AiDesignSpec } from '../api/client';
import {
  FURNITURE_TYPES,
  SUPPORTED_FURNITURE_TYPES,
  isSupportedFurnitureType,
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

  it('only treats table as buildable until W2 lands', () => {
    expect(SUPPORTED_FURNITURE_TYPES).toEqual(['table']);
    expect(isSupportedFurnitureType('table')).toBe(true);
    expect(isSupportedFurnitureType('chair')).toBe(false);
    expect(isSupportedFurnitureType('sofa')).toBe(false);
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
