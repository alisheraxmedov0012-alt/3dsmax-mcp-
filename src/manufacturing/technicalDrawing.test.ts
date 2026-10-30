import { describe, expect, it } from 'vitest';
import {
  chooseDrawingScale,
  createTechnicalDrawingSvg,
  measurePartBoxes,
} from './technicalDrawing';
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

  it('wraps the long title-block note inside the sheet', () => {
    const result = drawing('dresser');
    const note =
      'Dastlabki chizma: toleranslar, birlashma detallari va ishlab chiqarish standartlari tekshirilmagan.';
    const textNodes = [...result.svg.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map(
      (match) => match[1],
    );

    expect(textNodes).not.toContain(note);
    expect(textNodes.join(' ')).toContain('Dastlabki chizma');
    expect(textNodes.join(' ')).toContain('tekshirilmagan.');
  });

  it('declares the sheet in millimetres so the stated scale has physical meaning', () => {
    const { svg } = drawing('table');
    expect(svg).toMatch(/<svg[^>]*width="\d+mm"/);
    expect(svg).toMatch(/<svg[^>]*height="\d+mm"/);
    expect(svg).toContain('viewBox="0 0 ');
  });

  it('lists the part names and counts so the drawing is not just outlines', () => {
    const { svg } = drawing('table');
    expect(svg).toContain('Detallar:');
    expect(svg).toContain('Oyoq ×4');
    expect(svg).toContain('Ust paneli ×1');
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

/** Every `<text>` payload, in document order. */
function texts(svg: string): string[] {
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
}

function counts(svg: string) {
  return {
    lines: (svg.match(/<line /g) ?? []).length,
    polygons: (svg.match(/<polygon /g) ?? []).length,
    rects: (svg.match(/<rect /g) ?? []).length,
  };
}

describe('C2 — dimensioning', () => {
  it('draws dimension lines with arrowheads and witness lines', () => {
    const { svg, overall } = drawing('table');
    const c = counts(svg);

    // Four dimension chains: 2 witness lines + 1 dimension line each. The front
    // view carries width and height, the side view depth, the top view depth.
    expect(c.lines).toBe(12);
    expect(c.polygons).toBe(8);

    // The measured values appear as dimension text, in real millimetres.
    const labels = texts(svg);
    expect(labels).toContain(`${overall.widthMm} mm`);
    expect(labels).toContain(`${overall.heightMm} mm`);
    expect(labels).toContain(`${overall.depthMm} mm`);
  });

  it('reports the dimensions it measured, not rounded stand-ins', () => {
    for (const type of FURNITURE_TYPES) {
      const { svg, overall } = drawing(type);
      const labels = texts(svg);
      const dimensionTexts = labels.filter((t) => /^\d+(\.\d+)? mm$/.test(t));
      // Four dimension chains are drawn, and every measured overall value is
      // present. Values that coincide (a chair is as deep as it is wide) merge
      // in the text, so only the set is asserted.
      expect(dimensionTexts).toHaveLength(4);
      expect(labels).toContain(`${overall.widthMm} mm`);
      expect(labels).toContain(`${overall.heightMm} mm`);
      expect(labels).toContain(`${overall.depthMm} mm`);
    }
  });

  it('keeps every dimension line outside the view frames', () => {
    for (const type of FURNITURE_TYPES) {
      const result = drawing(type);
      const frames = Object.values(result.layout.views);

      // Dimension lines are the solid 1px strokes; witness lines are dashed.
      const dimLines = [...result.svg.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" stroke="#8f9aa6" stroke-width="1" \/>/g)]
        .map((m) => ({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] }));
      expect(dimLines).toHaveLength(4);

      for (const line of dimLines) {
        const vertical = Math.abs(line.x1 - line.x2) < 0.01;
        for (const frame of frames) {
          const insideX = line.x1 > frame.x && line.x1 < frame.x + frame.widthPx;
          const insideY = line.y1 > frame.y && line.y1 < frame.y + frame.heightPx;
          if (vertical) {
            // A vertical dimension must sit left or right of every frame.
            expect(insideX && insideY).toBe(false);
          } else {
            expect(insideX && insideY).toBe(false);
          }
        }
      }
    }
  });
});

describe('C2 — orthographic alignment', () => {
  it('aligns the side view with the front view and the top view under it', () => {
    for (const type of FURNITURE_TYPES) {
      const { views } = drawing(type).layout;

      // Side view: same vertical band as the front view.
      expect(views.side.y).toBeCloseTo(views.front.y, 6);
      expect(views.side.heightPx).toBeCloseTo(views.front.heightPx, 6);
      // To its right, without touching.
      expect(views.side.x).toBeGreaterThan(views.front.x + views.front.widthPx);

      // Top view: same horizontal band as the front view.
      expect(views.top.x).toBeCloseTo(views.front.x, 6);
      expect(views.top.widthPx).toBeCloseTo(views.front.widthPx, 6);
      // Below it, without touching.
      expect(views.top.y).toBeGreaterThan(views.front.y + views.front.heightPx);
    }
  });

  it('draws the geometry at the physical scale stated in the title block', () => {
    const result = drawing('table');
    expect(result.scale.ratio).toBe('1:5');
    const denominator = 5;
    expect(result.layout.views.front.widthPx).toBeCloseTo(result.overall.widthMm / denominator, 4);
    expect(result.layout.views.front.heightPx).toBeCloseTo(
      result.overall.heightMm / denominator,
      4,
    );
    expect(result.layout.views.side.widthPx).toBeCloseTo(result.overall.depthMm / denominator, 4);
    expect(result.layout.views.top.heightPx).toBeCloseTo(result.overall.depthMm / denominator, 4);
  });

  it('uses one scale for every view', () => {
    const sofa = drawing('sofa');
    const { views, widthPx: sheetWidth, heightPx: sheetHeight } = sofa.layout;
    const { pxPerMm } = sofa.scale;
    expect(views.front.widthPx).toBeCloseTo(views.front.widthMm * pxPerMm, 4);
    expect(views.front.heightPx).toBeCloseTo(views.front.heightMm * pxPerMm, 4);
    expect(views.side.widthPx).toBeCloseTo(views.side.widthMm * pxPerMm, 4);
    expect(views.top.heightPx).toBeCloseTo(views.top.heightMm * pxPerMm, 4);
    // The sheet is big enough to hold everything.
    for (const view of Object.values(views)) {
      expect(view.x + view.widthPx).toBeLessThan(sheetWidth);
      expect(view.y + view.heightPx).toBeLessThan(sheetHeight);
    }
  });

  it('states the scale it used and keeps dimensions in real millimetres', () => {
    const result = drawing('wardrobe');
    expect(result.scale.standard).toBe(true);
    expect(result.scale.ratio).toMatch(/^1:\d+(\.\d+)?$/);
    expect(result.svg).toContain(`Masshtab: ${result.scale.ratio}`);
    // The ratio must never leak into a dimension value.
    expect(result.svg).not.toContain(`1:${result.overall.widthMm}`);
  });
});

describe('C2 — scale selection', () => {
  it('picks the largest standard scale that fits', () => {
    // 200x200 mm fits at full size; the rest step down as the piece grows.
    expect(chooseDrawingScale(200, 200, 200, 200).ratio).toBe('1:1');
    expect(chooseDrawingScale(300, 300, 300, 300).ratio).toBe('1:2');
    expect(chooseDrawingScale(1200, 750, 600, 600).ratio).toBe('1:5');
    expect(chooseDrawingScale(2000, 850, 900, 900).ratio).toBe('1:5');
    expect(chooseDrawingScale(1800, 2000, 600, 600).ratio).toBe('1:10');
  });

  it('falls back to the true ratio when even 1:100 is too coarse', () => {
    const scale = chooseDrawingScale(200_000, 200_000, 200_000, 200_000);
    expect(scale.standard).toBe(false);
    expect(scale.pxPerMm).toBeLessThan(1 / 100);
    expect(scale.ratio.startsWith('1:')).toBe(true);
  });

  it('never divides by zero on a degenerate piece', () => {
    const scale = chooseDrawingScale(0, 0, 0, 0);
    expect(Number.isFinite(scale.pxPerMm)).toBe(true);
    expect(scale.pxPerMm).toBeGreaterThan(0);
  });
});

describe('C2 — extremes and invalid input', () => {
  it('draws the smallest and largest allowed pieces', () => {
    const cases = [
      createTechnicalDrawingSvg('table', {
        ...createFurnitureParams('table'),
        widthCm: 60,
        heightCm: 40,
        depthCm: 40,
      }),
      createTechnicalDrawingSvg('wardrobe', {
        ...createFurnitureParams('wardrobe'),
        widthCm: 300,
        heightCm: 260,
        depthCm: 90,
      }),
      createTechnicalDrawingSvg('bed', {
        ...createFurnitureParams('bed'),
        widthCm: 220,
        depthCm: 220,
        headboardHeightCm: 150,
      }),
    ];

    for (const result of cases) {
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.svg.startsWith('<svg')).toBe(true);
      expect(result.layout.widthPx).toBeGreaterThan(0);
      expect(result.layout.heightPx).toBeGreaterThan(0);
      // Views stay inside the sheet at every size.
      for (const view of Object.values(result.layout.views)) {
        expect(view.x).toBeGreaterThanOrEqual(0);
        expect(view.y).toBeGreaterThanOrEqual(0);
        expect(view.x + view.widthPx).toBeLessThanOrEqual(result.layout.widthPx);
        expect(view.y + view.heightPx).toBeLessThanOrEqual(result.layout.heightPx);
      }
    }
  });

  it('handles extreme aspect ratios without collapsing a view', () => {
    const wide = createTechnicalDrawingSvg('table', {
      ...createFurnitureParams('table'),
      widthCm: 200,
      heightCm: 40,
      depthCm: 40,
    });
    const tall = createTechnicalDrawingSvg('shelf', {
      ...createFurnitureParams('shelf'),
      widthCm: 40,
      heightCm: 240,
      depthCm: 20,
    });

    for (const [result, axis] of [
      [wide, 'widthPx'],
      [tall, 'heightPx'],
    ] as const) {
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const front = result.layout.views.front;
      // A non-degenerate frame on both axes, whatever the ratio.
      expect(front.widthPx).toBeGreaterThan(4);
      expect(front.heightPx).toBeGreaterThan(4);
      expect(front[axis]).toBeGreaterThan(4);
    }
  });

  it('reports a specific reason instead of drawing a bogus sheet', () => {
    const nan = createTechnicalDrawingSvg('table', {
      ...createFurnitureParams('table'),
      widthCm: Number.NaN,
    });
    expect(nan.ok).toBe(false);
    if (!nan.ok) expect(nan.reason).toContain('parametrlari');

    const outOfRange = createTechnicalDrawingSvg('wardrobe', {
      ...createFurnitureParams('wardrobe'),
      heightCm: 5000,
    });
    expect(outOfRange.ok).toBe(false);
    if (!outOfRange.ok) expect(outOfRange.reason).toContain('parametrlari');
  });

  it('still honours the title and part-outline options', () => {
    const result = createTechnicalDrawingSvg('table', createFurnitureParams('table'), {
      title: 'Oshxona stoli',
      date: '2026-10-24',
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.svg).toContain('Oshxona stoli');
    expect(result.svg).toContain('Sana: 2026-10-24');

    const plain = createTechnicalDrawingSvg('table', createFurnitureParams('table'), {
      includePartOutlines: false,
    });
    if (!plain.ok) throw new Error(plain.reason);
    expect(counts(plain.svg).rects).toBeLessThan(counts(result.svg).rects);
  });
});

describe('C2 — text placement', () => {
  interface Box {
    label: string;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }

  /**
   * Approximate text boxes. Width is estimated from the character count and font
   * size, which is enough to catch the real risk here: a dimension value landing
   * on top of a view label.
   */
  function textBoxes(svg: string): Box[] {
    const boxes: Box[] = [];
    for (const m of svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)) {
      const attrs = m[1];
      const text = m[2];
      const attr = (name: string) => {
        const found = new RegExp(`${name}="([^"]*)"`).exec(attrs);
        return found ? found[1] : undefined;
      };
      const x = Number(attr('x'));
      const y = Number(attr('y'));
      const size = Number(attr('font-size'));
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(size)) continue;
      const rotated = attrs.includes('rotate(-90');
      const w = text.length * size * 0.55;
      if (rotated) {
        boxes.push({ label: text, x0: x - size / 2, y0: y - w / 2, x1: x + size / 2, y1: y + w / 2 });
      } else {
        boxes.push({ label: text, x0: x - w / 2, y0: y - size, x1: x + w / 2, y1: y + 2 });
      }
    }
    return boxes;
  }

  it('never lets two text labels overlap', () => {
    for (const type of FURNITURE_TYPES) {
      const { svg } = drawing(type);
      const boxes = textBoxes(svg);
      expect(boxes.length).toBeGreaterThan(10);

      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i];
          const b = boxes[j];
          const overlaps =
            a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
          expect(
            overlaps,
            `"${a.label}" overlaps "${b.label}" in the ${type} drawing`,
          ).toBe(false);
        }
      }
    }
  });

  it('keeps the dimension value above its view label', () => {
    const { svg, layout } = drawing('wardrobe');
    const boxes = textBoxes(svg);
    const front = layout.views.front;
    const dim = boxes.find((b) => b.label === `${front.widthMm} mm`);
    const label = boxes.find((b) => b.label === 'Old korinish');
    expect(dim).toBeDefined();
    expect(label).toBeDefined();
    if (!dim || !label) return;
    // The dimension's text is above the frame bottom; the label is below it.
    expect(dim.y1).toBeLessThan(label.y0);
  });
});
