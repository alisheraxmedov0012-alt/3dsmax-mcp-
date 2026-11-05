import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api/client';
import type { TextureAssetRef, TextureMapRole } from './asset';
import { TextureLoadError, TextureRegistry } from './textureRegistry';

function ref(role: TextureMapRole, overrides: Partial<TextureAssetRef> = {}): TextureAssetRef {
  return {
    id: 'tex-shared',
    version: 1,
    role,
    colorSpace: role === 'baseColor' || role === 'emissive' ? 'srgb' : 'linear',
    wrap: 'repeat',
    ...overrides,
  };
}

function stubBitmap() {
  const close = vi.fn();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 4, height: 4, close })),
  );
  return close;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TextureRegistry roles', () => {
  it('keys the same bytes per role and colour space', async () => {
    stubBitmap();
    const loader = vi.fn(async () => new Blob(['png']));
    const registry = new TextureRegistry(loader);

    const base = await registry.acquire(ref('baseColor'));
    const normal = await registry.acquire(ref('normal'));
    const roughness = await registry.acquire(ref('roughness'));

    expect(loader).toHaveBeenCalledTimes(3);
    expect(base.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(normal.colorSpace).toBe(THREE.NoColorSpace);
    expect(roughness.colorSpace).toBe(THREE.NoColorSpace);
    expect(base).not.toBe(normal);
    expect(registry.size()).toBe(3);

    registry.release(ref('baseColor'));
    registry.release(ref('normal'));
    registry.release(ref('roughness'));
    expect(registry.size()).toBe(0);
  });

  it('keys versions and wrap modes separately', async () => {
    stubBitmap();
    const loader = vi.fn(async () => new Blob(['png']));
    const registry = new TextureRegistry(loader);

    const v1 = await registry.acquire(ref('orm', { version: 1 }));
    await registry.acquire(ref('orm', { version: 2 }));
    const clamped = await registry.acquire(ref('orm', { wrap: 'clamp' }));

    expect(loader).toHaveBeenCalledTimes(3);
    expect(registry.size()).toBe(3);
    expect(v1.wrapS).toBe(THREE.RepeatWrapping);
    expect(clamped.wrapS).toBe(THREE.ClampToEdgeWrapping);

    registry.release(ref('orm', { version: 1 }));
    registry.release(ref('orm', { version: 2 }));
    registry.release(ref('orm', { wrap: 'clamp' }));
    expect(registry.size()).toBe(0);
  });

  it('shares one entry between concurrent acquires of the same role', async () => {
    stubBitmap();
    const loader = vi.fn(async () => new Blob(['png']));
    const registry = new TextureRegistry(loader);
    const roleRef = ref('ao');

    const [first, second] = await Promise.all([
      registry.acquire(roleRef, { repeat: 2 }),
      registry.acquire(roleRef, { repeat: 2 }),
    ]);
    expect(first).toBe(second);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(registry.size()).toBe(1);

    // The second acquire still owns a reference.
    registry.release(roleRef, { repeat: 2 });
    expect(registry.size()).toBe(1);
    registry.release(roleRef, { repeat: 2 });
    expect(registry.size()).toBe(0);
  });

  it('disposes the texture and closes the bitmap for every role', async () => {
    const close = stubBitmap();
    const registry = new TextureRegistry(async () => new Blob(['png']));
    const roles: TextureMapRole[] = ['roughness', 'metalness', 'ao', 'orm', 'emissive'];
    const textures = await Promise.all(roles.map((role) => registry.acquire(ref(role))));
    const spies = textures.map((texture) => vi.spyOn(texture, 'dispose'));
    for (const role of roles) {
      registry.release(ref(role));
    }
    for (const spy of spies) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
    expect(close).toHaveBeenCalledTimes(roles.length);
    expect(registry.size()).toBe(0);
  });

  it('keeps a failing role from blocking another role', async () => {
    stubBitmap();
    const loader = vi.fn(async (id: string) => {
      if (id === 'missing') {
        throw new ApiRequestError('texture_not_found', 'missing', 404);
      }
      return new Blob(['png']);
    });
    const registry = new TextureRegistry(loader);

    const failing = registry.acquire(ref('normal', { id: 'missing' }));
    const working = registry.acquire(ref('roughness', { id: 'tex-good' }));

    await expect(failing).rejects.toMatchObject<Partial<TextureLoadError>>({
      code: 'not_found',
    });
    await expect(working).resolves.toBeInstanceOf(THREE.Texture);
    expect(registry.size()).toBe(1);
    registry.release(ref('roughness', { id: 'tex-good' }));
  });
});
