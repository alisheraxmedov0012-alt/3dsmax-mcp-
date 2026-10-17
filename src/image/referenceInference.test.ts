import { describe, expect, it } from 'vitest';
import { inferDesignSpec, specToFurnitureParams } from './referenceInference';
import { isSupportedDesignFurniture, SUPPORTED_DESIGN_FURNITURE_TYPES } from './designSpec';
import { validateFurnitureParams } from '../geometry/furniture/params';

const sample = { aspectRatio: 1.5, averageColor: '#a9744f' };

describe('inferDesignSpec', () => {
  it('refuses to produce a spec without a known reference dimension', () => {
    const result = inferDesignSpec({
      type: 'table',
      sample,
      referenceWidthCm: null,
      reference: 'widthCm',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_reference');
  });

  it('refuses a non-finite or out-of-range reference', () => {
    const nan = inferDesignSpec({
      type: 'table',
      sample,
      referenceWidthCm: Number.NaN,
      reference: 'widthCm',
    });
    expect(nan.ok).toBe(false);

    const huge = inferDesignSpec({
      type: 'sofa',
      sample,
      referenceWidthCm: 5000,
      reference: 'widthCm',
    });
    expect(huge.ok).toBe(false);
    if (!huge.ok) expect(huge.reason).toBe('invalid_reference');
  });

  it('produces a low-confidence, supported spec with honest warnings', () => {
    const result = inferDesignSpec({
      type: 'sofa',
      sample,
      referenceWidthCm: 200,
      reference: 'widthCm',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.spec.furniture).toBe('sofa');
    expect(result.spec.confidence).toBe('low');
    expect(result.spec.supported).toBe(true);
    // The known dimension is honoured exactly; the other axis is a proportion.
    expect(result.spec.dimensions?.width_cm).toBe(200);
    expect(result.spec.dimensions?.height_cm).toBeCloseTo(200 / 1.5, 1);
    // It must be explicit that this is approximate and not AI/CV.
    expect(result.spec.warnings.join(' ')).toContain('taxminan');
    expect(result.spec.warnings.join(' ')).toMatch(/AI emas/);
    // The sampled colour is carried through.
    expect(result.spec.color).toBe('#a9744f');
  });

  it('never returns an exact-looking dimension for the depth it cannot know', () => {
    const result = inferDesignSpec({
      type: 'wardrobe',
      sample,
      referenceWidthCm: 180,
      reference: 'widthCm',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.warnings.join(' ')).toContain('Chuqurlik');
  });

  it('is NaN-safe for a broken aspect ratio', () => {
    const result = inferDesignSpec({
      type: 'table',
      sample: { aspectRatio: Number.NaN, averageColor: null },
      referenceWidthCm: 120,
      reference: 'widthCm',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const value of Object.values(result.spec.dimensions ?? {})) {
      expect(Number.isFinite(value as number)).toBe(true);
    }
  });
});

describe('specToFurnitureParams', () => {
  it('produces parameters accepted by the W2 validator', () => {
    const result = inferDesignSpec({
      type: 'table',
      sample,
      referenceWidthCm: 120,
      reference: 'widthCm',
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.spec.dimensions) return;

    const params = specToFurnitureParams(result.spec.furniture, result.spec.dimensions);
    const validated = validateFurnitureParams('table', params);
    expect(validated).not.toBeNull();
    expect(validated?.widthCm).toBe(120);
  });
});

describe('design spec vocabulary', () => {
  it('supports every W2 furniture type', () => {
    for (const type of SUPPORTED_DESIGN_FURNITURE_TYPES) {
      expect(isSupportedDesignFurniture(type)).toBe(true);
    }
    expect(isSupportedDesignFurniture('spaceship' as never)).toBe(false);
  });
});
