import { describe, expect, it } from 'vitest';
import {
  baseColorTextureRef,
  textureItemFromApi,
  TextureAssetMappingError,
} from './textureAssetApi';

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'tex-12345678',
    version: 1,
    filename: 'oak.png',
    mime_type: 'image/png',
    width: 1024,
    height: 512,
    byte_size: 4096,
    content_hash: 'sha256:abc',
    source: { kind: 'bitmap', generator: null },
    ...overrides,
  };
}

describe('textureItemFromApi', () => {
  it('maps snake_case to the MaterialAsset TextureAsset shape', () => {
    const item = textureItemFromApi(raw());
    expect(item.filename).toBe('oak.png');
    expect(item.asset).toEqual({
      id: 'tex-12345678',
      version: 1,
      mimeType: 'image/png',
      width: 1024,
      height: 512,
      byteSize: 4096,
      contentHash: 'sha256:abc',
      source: { kind: 'bitmap' },
    });
  });

  it('falls back to a readable label when the server omits a filename', () => {
    const item = textureItemFromApi(raw({ filename: undefined }));
    expect(item.filename).toBe('Texture tex-1234');
  });

  it('rejects invalid or non-PNG responses', () => {
    for (const invalid of [
      raw({ width: 0 }),
      raw({ byte_size: 0 }),
      raw({ content_hash: '' }),
      raw({ mime_type: 'image/svg+xml' }),
      raw({ mime_type: 'image/jpeg' }),
      null,
      'nope',
    ]) {
      expect(() => textureItemFromApi(invalid as never)).toThrow(TextureAssetMappingError);
    }
  });

  it('builds a baseColor ref with sRGB and repeat', () => {
    const item = textureItemFromApi(raw());
    expect(baseColorTextureRef(item.asset)).toEqual({
      id: 'tex-12345678',
      version: 1,
      role: 'baseColor',
      colorSpace: 'srgb',
      wrap: 'repeat',
    });
  });
});
