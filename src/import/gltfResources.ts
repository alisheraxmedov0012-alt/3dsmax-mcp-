/**
 * Phase 6.2.2 — resolving a `.gltf`'s companion files against the selection.
 *
 * The document says *what* it needs; this module decides whether the user actually
 * supplied it, using only `ResourceMap`. Two severities:
 *
 * - **buffers are blocking.** Without its `.bin` there is no geometry, so a missing
 *   or ambiguous buffer stops the import with the names that are missing.
 * - **images are degradable.** A texture that cannot be used is dropped *from the
 *   material references* rather than from the array, so the model still loads with
 *   its factor colours, and the loss is reported instead of hidden.
 *
 * A dropped image is never decoded, which is also how a decompression bomb is
 * neutralised: the header is read first and an oversized or unreadable image is
 * discarded before any decoder sees it.
 */
import type { GltfJson } from '../export/glbSummary';
import type { ExternalReference } from './gltfGuard';
import { importFailure } from './importErrors';
import { readImageSize } from './imageHeader';
import {
  MAX_TEXTURE_DIMENSION,
  MAX_TEXTURE_IMAGE_BYTES,
  MAX_TOTAL_TEXTURE_PIXELS,
} from './importLimits';
import type { ResourceMap } from './resourceMap';

export type DroppedImageReason = 'missing' | 'ambiguous' | 'invalid' | 'too_large';

export interface DroppedImage {
  readonly index: number;
  readonly uri: string;
  readonly reason: DroppedImageReason;
  readonly candidates: readonly string[];
}

export interface ResolvedGltfResources {
  readonly total: number;
  readonly resolved: number;
  readonly missing: readonly string[];
  readonly ambiguous: readonly string[];
  readonly droppedImages: readonly DroppedImage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when the bytes are a PNG/JPEG inside the per-image limits. */
function imageIsUsable(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_TEXTURE_IMAGE_BYTES) {
    return false;
  }
  const size = readImageSize(bytes);
  if (!size) {
    return false;
  }
  return size.width <= MAX_TEXTURE_DIMENSION && size.height <= MAX_TEXTURE_DIMENSION;
}

/**
 * Resolves every external reference.
 *
 * Throws for a buffer problem (geometry would be missing); collects image problems
 * for the caller to report and strip.
 */
export function resolveGltfResources(
  references: readonly ExternalReference[],
  map: ResourceMap,
): ResolvedGltfResources {
  const missing: string[] = [];
  const ambiguous: string[] = [];
  const droppedImages: DroppedImage[] = [];
  let resolved = 0;
  let totalPixels = 0;

  for (const reference of references) {
    const found = map.lookup(reference.uri);

    if (!found.ok) {
      if (reference.kind === 'buffer') {
        // Geometry cannot be rebuilt without its buffer, so this is fatal and the
        // message names the file the user needs to add.
        if (found.reason === 'ambiguous') {
          throw importFailure(
            'ambiguous_resource',
            `"${reference.uri}" bir nechta faylga mos keladi: ${found.candidates.join(', ')}.`,
          );
        }
        if (found.reason === 'invalid') {
          // A scheme or a traversal attempt is a policy violation, not a file the
          // user forgot to select.
          throw importFailure(
            'external_resource',
            `Bufer manbasi qabul qilinmaydi: "${reference.uri}".`,
          );
        }
        throw importFailure(
          'missing_resource',
          `Bufer topilmadi: "${reference.uri}". .bin faylini ham tanlang.`,
        );
      }
      if (found.reason === 'ambiguous') {
        ambiguous.push(reference.uri);
        droppedImages.push({
          index: reference.index,
          uri: reference.uri,
          reason: 'ambiguous',
          candidates: found.candidates,
        });
      } else {
        missing.push(reference.uri);
        droppedImages.push({
          index: reference.index,
          uri: reference.uri,
          reason: found.reason === 'invalid' ? 'invalid' : 'missing',
          candidates: [],
        });
      }
      continue;
    }

    if (reference.kind === 'buffer') {
      const declared = reference.byteLength ?? 0;
      if (found.bytes.byteLength < declared) {
        // The file is smaller than the document claims: the accessor bounds were
        // validated against the declaration, so neither can be trusted now.
        throw importFailure(
          'malformed',
          `"${found.path}" fayli ${found.bytes.byteLength} bayt, model esa ` +
            `${declared} bayt talab qiladi.`,
        );
      }
      resolved += 1;
      continue;
    }

    if (!imageIsUsable(found.bytes)) {
      droppedImages.push({
        index: reference.index,
        uri: reference.uri,
        reason: 'too_large',
        candidates: [],
      });
      continue;
    }
    const size = readImageSize(found.bytes);
    const pixels = size ? size.width * size.height : 0;
    if (totalPixels + pixels > MAX_TOTAL_TEXTURE_PIXELS) {
      droppedImages.push({
        index: reference.index,
        uri: reference.uri,
        reason: 'too_large',
        candidates: [],
      });
      continue;
    }
    totalPixels += pixels;
    resolved += 1;
  }

  return {
    total: references.length,
    resolved,
    missing,
    ambiguous,
    droppedImages,
  };
}

function stripTextureRef(holder: Record<string, unknown>, key: string, dead: ReadonlySet<number>): void {
  const value = holder[key];
  if (isRecord(value) && typeof value.index === 'number' && dead.has(value.index)) {
    delete holder[key];
  }
}

/**
 * Removes every material reference to a texture whose image was dropped.
 *
 * Deleting the *reference* (not the array entry) keeps all indices stable, so the
 * rest of the document — including the references that did resolve — stays valid.
 * The material then falls back to its factor colour, which is what a renderer
 * without that map would show anyway.
 */
export function stripDroppedImageReferences(
  json: GltfJson,
  dropped: readonly DroppedImage[],
): GltfJson {
  if (dropped.length === 0) {
    return json;
  }

  const deadImages = new Set(dropped.map((image) => image.index));
  const deadTextures = new Set<number>();
  for (const [index, texture] of (json.textures ?? []).entries()) {
    if (typeof texture.source === 'number' && deadImages.has(texture.source)) {
      deadTextures.add(index);
    }
  }
  if (deadTextures.size === 0) {
    return json;
  }

  const clone = JSON.parse(JSON.stringify(json)) as GltfJson;
  const materials = (clone.materials ?? []) as unknown as Array<Record<string, unknown>>;

  for (const material of materials) {
    const pbr = material.pbrMetallicRoughness;
    if (isRecord(pbr)) {
      stripTextureRef(pbr, 'baseColorTexture', deadTextures);
      stripTextureRef(pbr, 'metallicRoughnessTexture', deadTextures);
    }
    stripTextureRef(material, 'normalTexture', deadTextures);
    stripTextureRef(material, 'occlusionTexture', deadTextures);
    stripTextureRef(material, 'emissiveTexture', deadTextures);

    // Extension texture slots (clearcoat, sheen, transmission, …) use the same
    // `{index}` shape one level deeper.
    const extensions = material.extensions;
    if (isRecord(extensions)) {
      for (const extension of Object.values(extensions)) {
        if (!isRecord(extension)) {
          continue;
        }
        for (const key of Object.keys(extension)) {
          stripTextureRef(extension, key, deadTextures);
        }
      }
    }
  }

  return clone;
}
