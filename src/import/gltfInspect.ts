/**
 * Phase 6.2.2 — a `.gltf` document (JSON, no container).
 *
 * Same policy as the GLB path, with one difference: file references are recorded
 * instead of rejected, because a `.gltf` is *expected* to point at companion files.
 * The caller resolves them from the user's selection and calls back into
 * `guardGltfDocument`'s rules through `resolveGltfResources`.
 */
import type { GltfJson } from '../export/glbSummary';
import { guardGltfDocument, type GltfDocumentStats } from './gltfGuard';
import { importFailure } from './importErrors';
import { MAX_GLTF_JSON_BYTES, MAX_MODEL_BYTES } from './importLimits';

export interface GltfInspection {
  readonly bytes: number;
  readonly json: GltfJson;
  readonly stats: GltfDocumentStats;
}

/** Decodes strictly: invalid UTF-8 is a corrupt document, not something to repair. */
function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Validates an untrusted `.gltf` document and returns its external references. */
export function inspectGltf(bytes: ArrayBuffer): GltfInspection {
  if (bytes.byteLength > MAX_MODEL_BYTES) {
    throw importFailure(
      'too_large',
      `Fayl ${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MB ` +
        `(maksimum ${MAX_MODEL_BYTES / (1024 * 1024)} MB).`,
    );
  }
  if (bytes.byteLength > MAX_GLTF_JSON_BYTES) {
    throw importFailure('too_complex', 'glTF hujjati juda katta.');
  }

  const text = decodeUtf8(new Uint8Array(bytes));
  if (text === null) {
    throw importFailure('malformed', 'glTF fayli UTF-8 matn emas.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw importFailure('malformed', 'glTF JSON o‘qilmadi.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw importFailure('malformed', 'glTF hujjati obyekt emas.');
  }

  const json = parsed as GltfJson;
  const stats = guardGltfDocument(json, null, { externalUris: 'allow' });

  return { bytes: bytes.byteLength, json, stats };
}
