import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { encodeTexturePng } from './texturePng';
import { testPngBytes } from './pngFixture';

function canvasWithPng(bytes: Uint8Array<ArrayBuffer>): {
  width: number;
  height: number;
  toBlob: (callback: (blob: Blob | null) => void, type?: string) => void;
} {
  return {
    width: 4,
    height: 4,
    toBlob(callback) {
      callback(new Blob([bytes], { type: 'image/png' }));
    },
  };
}

describe('encodeTexturePng', () => {
  it('returns the PNG bytes of a canvas-backed texture', async () => {
    const png = testPngBytes(4, 4);
    const texture = new THREE.Texture(
      canvasWithPng(png) as unknown as HTMLCanvasElement,
    );
    await expect(encodeTexturePng(texture)).resolves.toEqual(png);
  });

  it('rejects a texture without an image', async () => {
    await expect(encodeTexturePng(new THREE.Texture())).rejects.toThrow(
      /o'lchami|imkoni/,
    );
  });
});
