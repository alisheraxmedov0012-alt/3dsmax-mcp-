import { describe, expect, it } from 'vitest';
import { ALPHA_CORNER_TOLERANCE, analyzeAlphaProbe } from './alphaProbe';

function buffer(width: number, height: number, alpha: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 3; i < pixels.length; i += 4) {
    pixels[i] = alpha;
  }
  return pixels;
}

describe('analyzeAlphaProbe', () => {
  it('accepts a buffer whose corners are transparent', () => {
    const pixels = buffer(96, 54, 0);
    // An opaque object in the middle must not change the verdict.
    for (let y = 10; y < 40; y += 1) {
      for (let x = 20; x < 70; x += 1) {
        pixels[(y * 96 + x) * 4 + 3] = 255;
      }
    }
    expect(analyzeAlphaProbe(pixels, 96, 54)).toEqual({
      supported: true,
      cornerAlpha: [0, 0, 0, 0],
    });
  });

  it('rejects a buffer flattened onto an opaque background', () => {
    const pixels = buffer(96, 54, 255);
    const result = analyzeAlphaProbe(pixels, 96, 54);
    expect(result.supported).toBe(false);
    expect(result.cornerAlpha).toEqual([255, 255, 255, 255]);
    expect(result.reason).toMatch(/shaffof fonni saqlamayapti/);
  });

  it('tolerates rounding noise at the corners', () => {
    const pixels = buffer(96, 54, 0);
    pixels[3] = ALPHA_CORNER_TOLERANCE;
    expect(analyzeAlphaProbe(pixels, 96, 54).supported).toBe(true);
  });

  it('rejects a short buffer', () => {
    const result = analyzeAlphaProbe(new Uint8Array(16), 96, 54);
    expect(result.supported).toBe(false);
    expect(result.reason).toMatch(/to'liq emas/);
  });

  it('rejects invalid dimensions', () => {
    expect(analyzeAlphaProbe(new Uint8Array(64), 0, 54).supported).toBe(false);
    expect(analyzeAlphaProbe(new Uint8Array(64), 96, -1).supported).toBe(false);
  });
});
