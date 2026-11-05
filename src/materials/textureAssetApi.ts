/**
 * Map the backend's snake_case texture response onto MaterialAsset v1 types.
 *
 * The server response is untrusted like any other input: it is validated with
 * `validateTextureAsset()` before the UI or renderer sees it. Only the fields
 * the renderer needs are kept; binary data never enters this model.
 */
import type { TextureAssetApiResponse } from '../api/textureApi';
import {
  TEXTURE_ROLE_COLOR_SPACE,
  validateTextureAsset,
  type TextureAsset,
  type TextureAssetRef,
} from './asset';

export class TextureAssetMappingError extends Error {
  readonly code = 'invalid_texture_response';

  constructor(message: string) {
    super(message);
    this.name = 'TextureAssetMappingError';
  }
}

export interface TextureLibraryItem {
  readonly asset: TextureAsset;
  readonly filename: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate one API entry; throws `TextureAssetMappingError` on bad data. */
export function textureItemFromApi(raw: unknown): TextureLibraryItem {
  if (!isRecord(raw)) {
    throw new TextureAssetMappingError("Tekstura javobi obyekt emas.");
  }
  const source = isRecord(raw.source)
    ? { kind: raw.source.kind, generator: raw.source.generator }
    : raw.source;
  const candidate = {
    id: raw.id,
    version: raw.version,
    mimeType: raw.mime_type,
    width: raw.width,
    height: raw.height,
    byteSize: raw.byte_size,
    contentHash: raw.content_hash,
    source,
  };
  const validated = validateTextureAsset(candidate);
  if (!validated.ok) {
    throw new TextureAssetMappingError(validated.message);
  }
  if (validated.asset.mimeType !== 'image/png') {
    throw new TextureAssetMappingError(
      "Server teksturasi PNG formatida bo'lishi kerak.",
    );
  }
  const filename =
    typeof raw.filename === 'string' && raw.filename.trim() !== ''
      ? raw.filename
      : `Texture ${validated.asset.id.slice(0, 8)}`;
  return { asset: validated.asset, filename };
}

/** A baseColor reference for scene storage (refs only, never bytes). */
export function baseColorTextureRef(asset: TextureAsset): TextureAssetRef {
  return {
    id: asset.id,
    version: asset.version,
    role: 'baseColor',
    colorSpace: TEXTURE_ROLE_COLOR_SPACE.baseColor,
    wrap: 'repeat',
  };
}

export type { TextureAssetApiResponse };
