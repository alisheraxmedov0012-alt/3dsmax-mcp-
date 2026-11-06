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

/** The kinds of model this build can import. */
export type ModelFormat = 'glb' | 'gltf' | 'obj';

/** Enough to recognise a JSON prefix or an OBJ statement list. */
const SNIFF_BYTES = 8192;

/** A statement OBJ readers use at the start of a line. */
const OBJ_STATEMENT = /^(?:v|vt|vn|vp|f|o|g|s|usemtl|mtllib|l|p)[ \t]/mu;

/**
 * Returns the format from the bytes, or throws an `ImportError` explaining why the
 * file cannot be imported.
 *
 * The extension is never consulted here: a `.obj` that is really a PNG must be
 * rejected, and a renamed model must still load. Detection order is by strength of
 * evidence — a binary magic number, then a JSON document with a glTF `asset`
 * block, then OBJ statements.
 */
export function detectModelFormat(bytes: ArrayBuffer): ModelFormat {
  if (bytes.byteLength === 0) {
    throw importFailure('empty');
  }

  if (bytes.byteLength >= 12 && new DataView(bytes).getUint32(0, true) === GLB_MAGIC) {
    return 'glb';
  }

  const prefix = new TextDecoder('utf-8').decode(
    new Uint8Array(bytes, 0, Math.min(bytes.byteLength, SNIFF_BYTES)),
  );
  const trimmed = prefix.replace(/^\uFEFF/u, '').trimStart();

  if (trimmed.startsWith('{')) {
    if (trimmed.includes('"asset"')) {
      return 'gltf';
    }
    throw importFailure('malformed', "JSON fayl, lekin glTF hujjati emas.");
  }

  if (OBJ_STATEMENT.test(prefix)) {
    return 'obj';
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
