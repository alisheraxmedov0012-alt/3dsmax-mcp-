/**
 * Shared upload path for every PBR map role.
 *
 * The same Phase 4.3 validation, normalization, authenticated upload and
 * response validation are used for base colour and for every advanced map; no
 * role gets a weaker path or a separate storage endpoint.
 */
import { ApiRequestError } from '../api/client';
import { uploadTextureAsset } from '../api/textureApi';
import { defaultTextureTargetSize, normalizeTextureForUpload } from '../image/textureNormalize';
import { MAX_TEXTURE_BYTES, validateTextureFileContent } from '../image/textureFile';
import { textureItemFromApi, type TextureLibraryItem } from '../materials/textureAssetApi';

export async function uploadTextureFile(
  file: File,
  token: string,
): Promise<TextureLibraryItem> {
  if (file.size > MAX_TEXTURE_BYTES) {
    throw new Error(
      `Fayl hajmi juda katta (maksimum ${MAX_TEXTURE_BYTES / (1024 * 1024)} MB).`,
    );
  }
  const buffer = await file.arrayBuffer();
  const validated = validateTextureFileContent({
    buffer,
    declaredMime: file.type,
  });
  if (!validated.ok) {
    throw new Error(validated.message);
  }

  const normalized = await normalizeTextureForUpload(file, validated, {
    maxDimension: defaultTextureTargetSize(),
  });
  const stem = file.name.replace(/\.[^.]+$/, '').trim() || 'texture';
  const raw = await uploadTextureAsset(normalized.blob, `${stem}.png`, token);
  return textureItemFromApi(raw);
}

export { ApiRequestError };
