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

/** glTF linear units are metres, the editor stores centimetres. */
export const METERS_TO_CENTIMETERS = 100;
