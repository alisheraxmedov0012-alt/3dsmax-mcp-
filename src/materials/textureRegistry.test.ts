import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api/client';
import type { TextureAssetRef } from './asset';
import { TextureLoadError, TextureRegistry } from './textureRegistry';

const REF: TextureAssetRef = {
  id: 'tex-12345678',
  version: 1,
  role: 'baseColor',
  colorSpace: 'srgb',
  wrap: 'repeat',
};

function stubBitmap(width = 8, height = 8) {
  const close = vi.fn();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width, height, close })),
  );
  return close;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TextureRegistry', () => {
  it('shares a concurrent fetch and assigns sRGB/wrap/repeat', async () => {
    const close = stubBitmap();
    const loader = vi.fn(async () => new Blob(['png'], { type: 'image/png' }));
    const registry = new TextureRegistry(loader);

    const [first, second] = await Promise.all([
      registry.acquire(REF, { repeat: 2 }),
      registry.acquire(REF, { repeat: 2 }),
    ]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(first.wrapS).toBe(THREE.RepeatWrapping);
    expect(first.repeat.x).toBe(2);
    expect(registry.size()).toBe(1);

    registry.release(REF, { repeat: 2 });
    expect(registry.size()).toBe(1);
    registry.release(REF, { repeat: 2 });
    expect(registry.size()).toBe(0);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('disposes the GPU texture with the last reference', async () => {
    stubBitmap();
    const registry = new TextureRegistry(async () => new Blob(['png']));
    const texture = await registry.acquire(REF);
    const dispose = vi.spyOn(texture, 'dispose');
    registry.release(REF);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('keys different repeat values separately', async () => {
    stubBitmap();
    const loader = vi.fn(async () => new Blob(['png']));
    const registry = new TextureRegistry(loader);
    await registry.acquire(REF, { repeat: 1 });
    await registry.acquire(REF, { repeat: 2 });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(registry.size()).toBe(2);
    registry.release(REF, { repeat: 1 });
    registry.release(REF, { repeat: 2 });
    expect(registry.size()).toBe(0);
  });

  it('maps a 404 to a typed not_found error and does not cache it', async () => {
    const registry = new TextureRegistry(async () => {
      throw new ApiRequestError('texture_not_found', 'missing', 404);
    });
    await expect(registry.acquire(REF)).rejects.toMatchObject<Partial<TextureLoadError>>({
      code: 'not_found',
    });
    expect(registry.size()).toBe(0);
  });

  it('maps a decode failure and does not leak the bitmap', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        close();
        throw new Error('bad image');
      }),
    );
    const registry = new TextureRegistry(async () => new Blob(['png']));
    await expect(registry.acquire(REF)).rejects.toMatchObject<Partial<TextureLoadError>>({
      code: 'decode',
    });
    expect(registry.size()).toBe(0);
  });
});
