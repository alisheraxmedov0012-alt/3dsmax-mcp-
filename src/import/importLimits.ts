/**
 * Phase 6.2 — resource limits for model import.
 *
 * Every value bounds the work one browser tab will do for one file. They are
 * deliberately tighter than the packaging limits: `ASSET_PACKAGE_V2_LIMITS`
 * describes what may be *written* to an archive, not what a tab should *load* and
 * keep live while a 4K capture can already peak around 170 MB
 * (`docs/PHASE5_PERF_AUDIT.md`).
 *
 * Texture bounds reuse `src/image/*` so an imported map is judged by exactly the
 * same rule as an uploaded one instead of a second, drifting copy.
 */
import { MAX_IMAGE_DIMENSION } from '../image/imageFile';
import { MAX_TEXTURE_BYTES } from '../image/textureFile';

/** One model file. Half the package writer's 64 MB model cap. */
export const MAX_MODEL_BYTES = 32 * 1024 * 1024;

/** The JSON chunk of a 500k-triangle model is far below this. */
export const MAX_GLTF_JSON_BYTES = 8 * 1024 * 1024;

/** Total vertices across every primitive, and total triangles. */
export const MAX_VERTICES = 1_000_000;
export const MAX_TRIANGLES = 500_000;

/** Node-graph bounds: enough for a detailed furniture model, not for a bomb. */
export const MAX_NODES = 10_000;
export const MAX_NODE_DEPTH = 64;

/** Embedded images: count, per-image bytes, per-side size and total pixels. */
export const MAX_EMBEDDED_TEXTURES = 16;
export const MAX_TEXTURE_IMAGE_BYTES = MAX_TEXTURE_BYTES;
export const MAX_TEXTURE_DIMENSION = MAX_IMAGE_DIMENSION;
/** 64 MP across the whole model; `MAX_IMAGE_PIXELS` in `imageFile` caps one at 40 MP. */
export const MAX_TOTAL_TEXTURE_PIXELS = 64_000_000;

/**
 * A multi-file selection: the main model plus its `.bin`, MTL and textures.
 *
 * 64 files is far beyond a normal furniture asset (a handful of maps) and still
 * bounds the per-file bookkeeping; 48 MiB total keeps one import well below the
 * memory a 4K capture already needs.
 */
export const MAX_SELECTED_FILES = 64;
export const MAX_TOTAL_INPUT_BYTES = 48 * 1024 * 1024;

/**
 * OBJ/MTL are plain text, so they get their own bounds: a single enormous line
 * is the cheapest way to make a parser allocate without a valid structure.
 */
export const MAX_TEXT_FILE_BYTES = MAX_MODEL_BYTES;
export const MAX_TEXT_LINE_LENGTH = 4096;
export const MAX_MTL_MATERIALS = 256;
export const MAX_OBJECT_NAME_LENGTH = 255;
/** A face with more vertices than this is treated as corrupt, not tessellated. */
export const MAX_POLYGON_VERTICES = 64;

/**
 * glTF linear units are metres, the editor stores centimetres.
 */
export const METERS_TO_CENTIMETERS = 100;

/**
 * OBJ defines no linear unit, so the user picks one.
 *
 * The default is centimetres — the editor's own unit — because that is the only
 * choice that changes nothing: a model authored in cm arrives at its stated size,
 * and every other unit is an explicit, visible decision by the user. Guessing from
 * the model's dimensions was rejected: it would silently rescale a correctly
 * authored file.
 */
export const OBJ_UNIT_TO_CM = {
  mm: 0.1,
  cm: 1,
  m: 100,
} as const;

export type ObjUnit = keyof typeof OBJ_UNIT_TO_CM;

export const DEFAULT_OBJ_UNIT: ObjUnit = 'cm';
