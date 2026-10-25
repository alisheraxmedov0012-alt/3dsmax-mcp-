/**
 * W8 JSON design/scene exchange format.
 *
 * A documented, versioned container that carries only what is needed to rebuild
 * the scene: the room, every furniture object (type, parameters, transform,
 * visibility, material) and the visualization settings. It is **not** a 3D mesh.
 *
 * Import is treated as untrusted input:
 * - a hard byte-size cap before parsing,
 * - `JSON.parse` inside a try/catch (malformed JSON never throws out),
 * - a format marker + schema-version check,
 * - every field re-validated by the existing `validateSceneData`, so an unknown
 *   type, a bad parameter or a non-finite value can never enter the scene.
 *
 * The caller decides what to do with the result; this module never writes over an
 * existing project on its own, and an import failure leaves the current scene
 * untouched.
 */
import { validateSceneData } from '../scene/sceneValidation';
import type { SceneData } from '../scene/types';
import type { ExportMetadata } from './exportTypes';

/** Marker that identifies our JSON files. */
export const SCENE_JSON_FORMAT = '3d-studio-ai-scene';

/** Version of the JSON container (independent of the scene schema version). */
export const SCENE_JSON_VERSION = 1;

/** Hard cap on an imported JSON file (bytes). */
export const MAX_JSON_BYTES = 5 * 1024 * 1024;

export interface SceneJsonDocument {
  format: typeof SCENE_JSON_FORMAT;
  version: number;
  exportedAt: string;
  metadata: {
    name: string;
    furnitureType: string | null;
    units: 'cm';
  };
  scene: SceneData;
}

/**
 * Serialize the scene into the documented JSON container. `exportedAt` is
 * injected so the output is deterministic in tests.
 */
export function serializeSceneToJson(
  data: SceneData,
  metadata: ExportMetadata,
  exportedAt: string = new Date().toISOString(),
): string {
  const document: SceneJsonDocument = {
    format: SCENE_JSON_FORMAT,
    version: SCENE_JSON_VERSION,
    exportedAt,
    metadata: {
      name: metadata.name,
      furnitureType: metadata.furnitureType,
      units: metadata.units,
    },
    scene: data,
  };
  return JSON.stringify(document, null, 2);
}

export type SceneJsonErrorCode =
  | 'too_large'
  | 'malformed'
  | 'wrong_format'
  | 'unsupported_version'
  | 'invalid_scene';

export type SceneJsonParseResult =
  | {
      ok: true;
      scene: SceneData;
      name: string;
      droppedObjects: number;
      /**
       * C8.6.2: objects whose stored parameters were adjusted to fit the field
       * contract. Always present (0 when nothing changed) so callers can branch on
       * it without an undefined check; existing callers are unaffected.
       */
      normalizedObjects: number;
    }
  | { ok: false; code: SceneJsonErrorCode; message: string };

const MESSAGES: Record<SceneJsonErrorCode, string> = {
  too_large: `JSON fayl juda katta (maksimum ${Math.round(MAX_JSON_BYTES / (1024 * 1024))} MB).`,
  malformed: "Fayl noto'g'ri JSON — o'qib bo'lmadi.",
  wrong_format: 'Bu fayl 3D Studio AI sahna formati emas.',
  unsupported_version: "JSON format versiyasi qo'llab-quvvatlanmaydi.",
  invalid_scene: "JSON ichida sahna ma'lumotlari noto'g'ri.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse and validate an imported JSON document. Never throws and never mutates
 * the current scene: on any problem it returns a typed error instead.
 */
export function parseSceneJson(text: string): SceneJsonParseResult {
  if (typeof text !== 'string') {
    return { ok: false, code: 'malformed', message: MESSAGES.malformed };
  }
  // Size is measured in bytes, not characters.
  if (new TextEncoder().encode(text).length > MAX_JSON_BYTES) {
    return { ok: false, code: 'too_large', message: MESSAGES.too_large };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, code: 'malformed', message: MESSAGES.malformed };
  }

  if (!isRecord(parsed)) {
    return { ok: false, code: 'malformed', message: MESSAGES.malformed };
  }
  if (parsed.format !== SCENE_JSON_FORMAT) {
    return { ok: false, code: 'wrong_format', message: MESSAGES.wrong_format };
  }
  if (parsed.version !== SCENE_JSON_VERSION) {
    return { ok: false, code: 'unsupported_version', message: MESSAGES.unsupported_version };
  }

  const result = validateSceneData(parsed.scene);
  if (!result.scene) {
    return { ok: false, code: 'invalid_scene', message: MESSAGES.invalid_scene };
  }

  const metadata = isRecord(parsed.metadata) ? parsed.metadata : {};
  const name =
    typeof metadata.name === 'string' && metadata.name.trim() !== '' ? metadata.name : 'Import';

  return {
    ok: true,
    scene: result.scene,
    name,
    droppedObjects: result.droppedObjects,
    normalizedObjects: result.normalizations?.length ?? 0,
  };
}
