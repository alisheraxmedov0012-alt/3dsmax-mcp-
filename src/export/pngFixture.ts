/**
 * Test-only PNG fixture. Tests need a buffer whose IHDR describes real
 * dimensions; the production capture path is exercised in the browser probe.
 * The CRC is left zero because the readers under test validate the signature and
 * IHDR, not image integrity.
 */
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function testPngBytes(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33);
  bytes.set(SIGNATURE, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

export function testPngBlob(width: number, height: number): Blob {
  return new Blob([testPngBytes(width, height)], { type: 'image/png' });
}
