/**
 * Phase 6.2 — what the file actually is, decided from its bytes.
 *
 * The extension and the browser-reported MIME type are user-controlled, so they
 * are only a cross-check: a `.glb` that is really an HTML page must be rejected,
 * and a content-valid GLB is accepted even if it was renamed. This mirrors the
 * magic-byte rule already used for images in `src/image/imageFile.ts`.
 */
import { ImportError, importFailure } from './importErrors';

/** ASCII "glTF" read as a little-endian uint32: the first four bytes of a GLB. */
export const GLB_MAGIC = 0x46546c67;

/** The container kind this build can import. */
export type ModelFormat = 'glb';

/** Enough to see a JSON prefix without decoding a whole file into a string. */
const JSON_SNIFF_BYTES = 512;

/**
 * Returns the container format, or throws an `ImportError` explaining why the
 * bytes cannot be imported.
 *
 * A JSON glTF is recognised specifically so the message can say "convert it to
 * .glb" instead of the generic "not a model file" — Phase 6.2.2 adds that path.
 */
export function detectModelFormat(bytes: ArrayBuffer): ModelFormat {
  if (bytes.byteLength === 0) {
    throw importFailure('empty');
  }
  if (bytes.byteLength < 12) {
    throw importFailure('malformed', "Fayl GLB sarlavhasi uchun juda kichik.");
  }

  const view = new DataView(bytes);
  if (view.getUint32(0, true) === GLB_MAGIC) {
    return 'glb';
  }

  const prefix = new TextDecoder().decode(
    new Uint8Array(bytes, 0, Math.min(bytes.byteLength, JSON_SNIFF_BYTES)),
  ).trimStart();
  if (prefix.startsWith('{') && prefix.includes('"asset"')) {
    throw importFailure('gltf_not_supported');
  }

  throw importFailure('unsupported_format');
}

/** True when the file name suggests a glTF JSON instead of a binary container. */
export function looksLikeGltfFileName(fileName: string): boolean {
  return /\.gltf$/iu.test(fileName.trim());
}

/** Narrow helper so callers can rethrow only real import failures. */
export function isImportError(error: unknown): error is ImportError {
  return error instanceof ImportError;
}
