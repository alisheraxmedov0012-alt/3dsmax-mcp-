/**
 * W7 pure colour sampling (no DOM), so the maths is unit-testable in Node.
 * The browser decode step lives in `referenceImage.ts`.
 */

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hex2(value: number): string {
  return clampByte(value).toString(16).padStart(2, '0');
}

/**
 * Average colour of an RGBA pixel buffer as `#rrggbb`.
 * Fully transparent pixels (alpha 0) are ignored; returns null when there is
 * nothing to sample.
 */
export function averageColorFromPixels(data: Uint8ClampedArray | Uint8Array): string | null {
  if (data.length < 4) {
    return null;
  }
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] === 0) {
      continue;
    }
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    count += 1;
  }
  if (count === 0) {
    return null;
  }
  return `#${hex2(r / count)}${hex2(g / count)}${hex2(b / count)}`;
}
