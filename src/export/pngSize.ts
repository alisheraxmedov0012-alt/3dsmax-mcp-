/**
 * A4 — read the size of a PNG from its own bytes.
 *
 * Preview images and the embedded GLB textures are PNGs produced by the browser.
 * Reporting their real dimensions (instead of the requested ones) keeps package
 * metadata honest: a caller that asked for 512 px still sees 512 only if the
 * bitmap really is that size.
 */
export interface PngSize {
  widthPx: number;
  heightPx: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array | null | undefined): boolean {
  if (!bytes || bytes.length < 24) {
    return false;
  }
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

/**
 * Width/height from the `IHDR` chunk, or `null` when the buffer is not a PNG or
 * is too short to contain a complete header.
 */
export function pngSize(bytes: Uint8Array | null | undefined): PngSize | null {
  if (!bytes || !isPng(bytes)) {
    return null;
  }
  const type = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (type !== 'IHDR') {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const widthPx = view.getUint32(16);
  const heightPx = view.getUint32(20);
  if (widthPx === 0 || heightPx === 0) {
    return null;
  }
  return { widthPx, heightPx };
}
