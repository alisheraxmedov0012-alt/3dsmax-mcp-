import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { MaterialAssetMaps, TextureAssetRef, TextureMapRole } from './asset';
import type { TextureProvider } from './textureRegistry';
import { ObjectTextureMapLoader, type TextureMapStatus } from './textureMapLoader';

function ref(role: TextureMapRole, id = `tex-${role}`): TextureAssetRef {
  return {
    id,
    version: 1,
    role,
    colorSpace: role === 'baseColor' || role === 'emissive' ? 'srgb' : 'linear',
    wrap: 'repeat',
  };
}

function texture(name: string): THREE.Texture {
  const value = new THREE.Texture();
  value.name = name;
  return value;
}

function loaderWith(provider: TextureProvider) {
  const applied: Array<{ role: TextureMapRole; name: string }> = [];
  const statuses: Array<TextureMapStatus | null> = [];
  const loader = new ObjectTextureMapLoader({
    provider,
    apply: (role, value) => applied.push({ role, name: value.name }),
    onStatus: (status) => statuses.push(status),
  });
  return { loader, applied, statuses };
}

describe('ObjectTextureMapLoader', () => {
  it('loads every role independently and reports ready', async () => {
    const provider: TextureProvider = {
      acquire: vi.fn(async (value: TextureAssetRef) => texture(value.role)),
      release: vi.fn(),
    };
    const { loader, applied, statuses } = loaderWith(provider);
    const maps: MaterialAssetMaps = { normal: ref('normal'), roughness: ref('roughness') };

    loader.sync(maps, 1);
    await Promise.resolve();
    await Promise.resolve();

    expect(applied.map((entry) => entry.role).sort()).toEqual(['normal', 'roughness']);
    expect(statuses[0]).toEqual({ state: 'loading' });
    expect(statuses[statuses.length - 1]).toEqual({ state: 'ready' });
    expect(provider.release).not.toHaveBeenCalled();

    loader.dispose();
    expect(provider.release).toHaveBeenCalledTimes(2);
  });

  it('keeps loading other maps when one role fails', async () => {
    const provider: TextureProvider = {
      acquire: vi.fn(async (value: TextureAssetRef) => {
        if (value.role === 'normal') {
          throw new Error('normal missing');
        }
        return texture(value.role);
      }),
      release: vi.fn(),
    };
    const { loader, applied, statuses } = loaderWith(provider);

    loader.sync({ normal: ref('normal'), roughness: ref('roughness') }, 1);
    await Promise.resolve();
    await Promise.resolve();

    expect(applied).toEqual([{ role: 'roughness', name: 'roughness' }]);
    expect(statuses[statuses.length - 1]).toMatchObject({ state: 'error', message: 'normal missing' });
    loader.dispose();
    expect(provider.release).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale request and releases the texture it produced', async () => {
    const pending: Array<{
      ref: TextureAssetRef;
      resolve: (value: THREE.Texture) => void;
      reject: (error: unknown) => void;
    }> = [];
    const provider: TextureProvider = {
      acquire: vi.fn(
        (value: TextureAssetRef) =>
          new Promise<THREE.Texture>((resolve, reject) => {
            pending.push({ ref: value, resolve, reject });
          }),
      ),
      release: vi.fn(),
    };
    const { loader, applied, statuses } = loaderWith(provider);

    loader.sync({ normal: ref('normal', 'old') }, 1);
    loader.sync({ normal: ref('normal', 'new') }, 1);
    expect(pending).toHaveLength(2);

    pending[0].resolve(texture('old'));
    await Promise.resolve();
    await Promise.resolve();
    expect(applied).toEqual([]);
    expect(provider.release).toHaveBeenCalledWith(pending[0].ref, { repeat: 1 });

    pending[1].resolve(texture('new'));
    await Promise.resolve();
    await Promise.resolve();
    expect(applied).toEqual([{ role: 'normal', name: 'new' }]);
    expect(statuses[statuses.length - 1]).toEqual({ state: 'ready' });
    loader.dispose();
  });

  it('releases the previous texture when the map is removed', async () => {
    const provider: TextureProvider = {
      acquire: vi.fn(async () => texture('rough')),
      release: vi.fn(),
    };
    const { loader, statuses } = loaderWith(provider);

    loader.sync({ roughness: ref('roughness') }, 1);
    await Promise.resolve();
    await Promise.resolve();
    loader.sync(undefined, 1);

    expect(provider.release).toHaveBeenCalledTimes(1);
    expect(statuses[statuses.length - 1]).toBeNull();
    loader.dispose();
    expect(provider.release).toHaveBeenCalledTimes(1);
  });

  it('does not reload unchanged references', async () => {
    const provider: TextureProvider = {
      acquire: vi.fn(async () => texture('ao')),
      release: vi.fn(),
    };
    const { loader } = loaderWith(provider);
    const maps: MaterialAssetMaps = { ao: ref('ao') };

    loader.sync(maps, 1);
    await Promise.resolve();
    await Promise.resolve();
    loader.sync(maps, 1);

    expect(provider.acquire).toHaveBeenCalledTimes(1);
    loader.dispose();
  });

  it('reloads when the repeat changes', async () => {
    const provider: TextureProvider = {
      acquire: vi.fn(async () => texture('ao')),
      release: vi.fn(),
    };
    const { loader } = loaderWith(provider);
    const maps: MaterialAssetMaps = { ao: ref('ao') };

    loader.sync(maps, 1);
    await Promise.resolve();
    await Promise.resolve();
    loader.sync(maps, 2);

    expect(provider.acquire).toHaveBeenCalledTimes(2);
    expect(provider.release).toHaveBeenCalledTimes(1);
    loader.dispose();
  });
});
