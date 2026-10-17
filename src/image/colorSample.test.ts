import { describe, expect, it } from 'vitest';
import { averageColorFromPixels } from './colorSample';

function rgba(pixels: number[][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a], index) => {
    data[index * 4] = r;
    data[index * 4 + 1] = g;
    data[index * 4 + 2] = b;
    data[index * 4 + 3] = a;
  });
  return data;
}

describe('averageColorFromPixels', () => {
  it('returns the average of opaque pixels as #rrggbb', () => {
    expect(
      averageColorFromPixels(
        rgba([
          [0, 0, 0, 255],
          [255, 255, 255, 255],
        ]),
      ),
    ).toBe('#808080');
  });

  it('ignores fully transparent pixels', () => {
    expect(
      averageColorFromPixels(
        rgba([
          [255, 0, 0, 255],
          [0, 0, 255, 0],
        ]),
      ),
    ).toBe('#ff0000');
  });

  it('returns null when there is nothing to sample', () => {
    expect(averageColorFromPixels(new Uint8ClampedArray(0))).toBeNull();
    expect(averageColorFromPixels(rgba([[10, 10, 10, 0]]))).toBeNull();
  });

  it('clamps and pads hex bytes', () => {
    expect(averageColorFromPixels(rgba([[1, 2, 3, 255]]))).toBe('#010203');
  });
});
