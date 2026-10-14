import { describe, expect, it } from 'vitest';
import { createTechnicalDrawingSvg, measurePartBoxes } from './technicalDrawing';
import { buildFurniture } from '../geometry/furniture/buildFurniture';
import {
  FURNITURE_TYPE_LABELS,
  createFurnitureParams,
  FURNITURE_TYPES,
} from '../geometry/furniture/types';

function drawing(type: Parameters<typeof createTechnicalDrawingSvg>[0]) {
  const result = createTechnicalDrawingSvg(type, createFurnitureParams(type));
  if (!result.ok) {
    throw new Error(`drawing failed for ${type}: ${result.reason}`);
  }
  return result;
}

describe('createTechnicalDrawingSvg', () => {
  it('produces valid SVG with the three views and a title block', () => {
    const { svg } = drawing('table');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('Old korinish');
    expect(svg).toContain('Yon korinish');
    expect(svg).toContain('Yuqoridan korinish');
    expect(svg).toContain('Turi: Stol');
    expect(svg).toContain('m');
    // A title/limitation note is always present.
    expect(svg).toContain('Dastlabki chizma');
  });

  it('reports measured overall dimensions in millimetres', () => {
    const { overall } = drawing('table');
    expect(overall.widthMm).toBeCloseTo(1200, 0);
    expect(overall.heightMm).toBeCloseTo(750, 0);
    expect(overall.depthMm).toBeCloseTo(600, 0);
  });

  it('draws one outline per measured part per view', () => {
    const built = buildFurniture('table', createFurnitureParams('table'));
    let partCount = 0;
    try {
      partCount = measurePartBoxes(built.group).length;
    } finally {
      built.dispose();
    }
    expect(partCount).toBe(5);

    const { svg } = drawing('table');
    // 3 view frames + 3 × parts outlines, plus the background rect.
    const rects = (svg.match(/<rect /g) ?? []).length;
    expect(rects).toBeGreaterThanOrEqual(1 + 3 + 3 * partCount);
  });

  it('produces a drawing for every furniture type', () => {
    for (const type of FURNITURE_TYPES) {
      const { svg, overall } = drawing(type);
      expect(svg).toContain(FURNITURE_TYPE_LABELS[type]);
      for (const value of [overall.widthMm, overall.heightMm, overall.depthMm]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
    }
  });

  it('can omit part outlines', () => {
    const withOutlines = createTechnicalDrawingSvg('table', createFurnitureParams('table'));
    const withoutOutlines = createTechnicalDrawingSvg('table', createFurnitureParams('table'), {
      includePartOutlines: false,
    });
    if (!withOutlines.ok || !withoutOutlines.ok) {
      throw new Error('unexpected failure');
    }
    const count = (svg: string) => (svg.match(/<rect /g) ?? []).length;
    expect(count(withoutOutlines.svg)).toBeLessThan(count(withOutlines.svg));
  });

  it('escapes XML-special characters in the title', () => {
    const result = createTechnicalDrawingSvg('table', createFurnitureParams('table'), {
      title: 'A & B <stol>',
    });
    if (!result.ok) {
      throw new Error('unexpected failure');
    }
    expect(result.svg).toContain('A &amp; B &lt;stol&gt;');
    expect(result.svg).not.toContain('<stol>');
  });

  it('rejects invalid parameters with a clear reason', () => {
    const result = createTechnicalDrawingSvg('table', {
      ...createFurnitureParams('table'),
      widthCm: Number.NaN,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);

    const negative = createTechnicalDrawingSvg('sofa', {
      ...createFurnitureParams('sofa'),
      heightCm: -5,
    });
    expect(negative.ok).toBe(false);
  });
});
