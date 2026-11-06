/**
 * Phase 6.2 — container + document inspection for an untrusted `.glb`.
 *
 * Split out from `parseModel` so the policy can be tested without a loader: this
 * module answers "is this file acceptable?" and nothing else. The GLB container
 * itself is read by `parseGlbContainer` in `src/export/glbSummary.ts`, which the
 * packaging code already uses — there is exactly one GLB reader in the project.
 */
import { parseGlbContainer } from '../export/glbSummary';
import { importFailure } from './importErrors';
import { guardGltfDocument, type GltfDocumentStats } from './gltfGuard';
import { MAX_GLTF_JSON_BYTES, MAX_MODEL_BYTES } from './importLimits';

export interface GlbInspection {
  /** Total file size. */
  bytes: number;
  jsonChunkBytes: number;
  stats: GltfDocumentStats;
}

/**
 * Validates an untrusted GLB and returns the facts the UI reports.
 *
 * Size is checked before parsing, the container before the document, and the
 * document before anything is handed to a loader.
 */
export function inspectGlb(bytes: ArrayBuffer): GlbInspection {
  if (bytes.byteLength > MAX_MODEL_BYTES) {
    throw importFailure(
      'too_large',
      `Fayl ${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MB ` +
        `(maksimum ${MAX_MODEL_BYTES / (1024 * 1024)} MB).`,
    );
  }

  const parsed = parseGlbContainer(bytes);
  if (!parsed.ok) {
    throw importFailure('malformed', parsed.reason);
  }
  const { container } = parsed;

  if (container.jsonChunkBytes > MAX_GLTF_JSON_BYTES) {
    throw importFailure(
      'too_complex',
      `glTF JSON chunk ${container.jsonChunkBytes} bayt ` +
        `(limit ${MAX_GLTF_JSON_BYTES}).`,
    );
  }

  return {
    bytes: container.bytes,
    jsonChunkBytes: container.jsonChunkBytes,
    stats: guardGltfDocument(container.json, container.bin),
  };
}
