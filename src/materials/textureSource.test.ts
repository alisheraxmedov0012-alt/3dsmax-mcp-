import { describe, expect, it } from 'vitest';
import type { TextureAssetRef } from './asset';
import {
  PROCEDURAL_TEXTURE_KINDS,
  parseProceduralTextureId,
  proceduralTextureId,
  textureSourceFromRef,
} from './textureSource';

function ref(overrides: Partial<TextureAssetRef> = {}): TextureAssetRef {
  return {
    id: 'procedural:wood:color',
    version: 1,
    role: 'baseColor',
    colorSpace: 'srgb',
    wrap: 'repeat',
    ...overrides,
  };
}

describe('procedural texture ids', () => {
  it('round-trips every built-in kind and role', () => {
    for (const kind of PROCEDURAL_TEXTURE_KINDS) {
      const base = proceduralTextureId(kind, 'baseColor');
      const normal = proceduralTextureId(kind, 'normal');
      expect(base).toBe(`procedural:${kind}:color`);
      expect(parseProceduralTextureId(base)).toEqual({ textureKind: kind, role: 'baseColor' });
      expect(parseProceduralTextureId(normal)).toEqual({ textureKind: kind, role: 'normal' });
    }
  });

  it('rejects malformed and unknown procedural ids', () => {
    expect(parseProceduralTextureId('procedural:wood')).toBeNull();
    expect(parseProceduralTextureId('procedural:brick:color')).toBeNull();
    expect(parseProceduralTextureId('procedural:wood:bump')).toBeNull();
    expect(parseProceduralTextureId('textures:oak')).toBeNull();
  });
});

describe('textureSourceFromRef', () => {
  it('describes a procedural base colour source', () => {
    expect(textureSourceFromRef(ref())).toEqual({
      kind: 'procedural',
      textureKind: 'wood',
      role: 'baseColor',
      colorSpace: 'srgb',
    });
  });

  it('describes a procedural normal source as linear', () => {
    expect(
      textureSourceFromRef(
        ref({
          id: 'procedural:grain:normal',
          role: 'normal',
          colorSpace: 'linear',
        }),
      ),
    ).toMatchObject({ kind: 'procedural', textureKind: 'grain', role: 'normal' });
  });

  it('rejects a procedural id stored in the wrong role slot', () => {
    expect(textureSourceFromRef(ref({ id: 'procedural:wood:normal' }))).toBeNull();
  });

  it('rejects a malformed procedural id instead of treating it as a bitmap', () => {
    expect(textureSourceFromRef(ref({ id: 'procedural:brick:color' }))).toBeNull();
  });

  it('describes a non-procedural reference as a bitmap source', () => {
    expect(
      textureSourceFromRef(
        ref({ id: 'textures:oak-1', version: 3, role: 'normal', colorSpace: 'linear' }),
      ),
    ).toEqual({
      kind: 'bitmap',
      assetId: 'textures:oak-1',
      assetVersion: 3,
      role: 'normal',
      colorSpace: 'linear',
    });
  });
});
