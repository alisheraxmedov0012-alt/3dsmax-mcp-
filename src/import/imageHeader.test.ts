import { describe, expect, it } from 'vitest';
import { readImageSize } from './imageHeader';
import { testPngBytes } from '../export/pngFixture';

/** A minimal JPEG: SOI, one APP0 segment, one SOF0 with the given size, EOI. */
function jpegBytes(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof0 = [
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]);
}

describe('readImageSize', () => {
  it('reads PNG dimensions from the header', () => {
    expect(readImageSize(testPngBytes(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it('reads JPEG dimensions from the first frame header', () => {
    expect(readImageSize(jpegBytes(1024, 768))).toEqual({ width: 1024, height: 768 });
  });

  it('rejects a PNG with a broken signature', () => {
    const bytes = testPngBytes(10, 10);
    bytes[1] = 0;
    expect(readImageSize(bytes)).toBeNull();
  });

  it('rejects a PNG whose IHDR is missing', () => {
    const bytes = testPngBytes(10, 10);
    bytes.set([0x00, 0x00, 0x00, 0x00], 12);
    expect(readImageSize(bytes)).toBeNull();
  });

  it('rejects a truncated file', () => {
    expect(readImageSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(readImageSize(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  it('rejects a JPEG whose segment runs past the end', () => {
    const bytes = jpegBytes(10, 10).subarray(0, 12);
    expect(readImageSize(bytes)).toBeNull();
  });

  it('rejects formats it does not read', () => {
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(readImageSize(webp)).toBeNull();
    expect(readImageSize(new Uint8Array(0))).toBeNull();
  });

  it('rejects a zero-sized image', () => {
    expect(readImageSize(testPngBytes(0, 0))).toBeNull();
  });
});
