/**
 * W7 image→parameter inference.
 *
 * Scope, stated honestly: this is a **simple, transparent heuristic** — it derives
 * proportions from the image's aspect ratio and scales them by ONE known
 * reference dimension supplied by the user. It is **not** computer vision, not
 * machine learning and not a real image-understanding service, and nothing here
 * should be described as such.
 *
 * Consequences that the code enforces:
 * - Exact metric dimensions cannot be recovered from a photograph, so the result
 *   is always `confidence: 'low'` with explicit warnings.
 * - At least one real-world reference dimension (or an explicit manual
 *   adjustment) is **required** before a spec can be produced.
 * - The result is a proposal only; it is never applied to the scene without the
 *   user confirming it (see the UI).
 */
import {
  FURNITURE_DEFAULTS,
  FURNITURE_TYPE_LABELS,
  createFurnitureParams,
  type FurnitureParams,
  type FurnitureType,
} from '../geometry/furniture/types';
import type { DesignDimensions, DesignSpec } from './designSpec';

/** A coarse colour read from the image (kept optional and clearly approximate). */
export interface ImageSample {
  /** width / height of the decoded image. */
  aspectRatio: number;
  /** Average colour as `#rrggbb`, or null when not sampled. */
  averageColor: string | null;
}

export interface InferenceInput {
  type: FurnitureType;
  sample: ImageSample;
  /**
   * One known real-world dimension of the piece (cm) — the user must provide it.
   * `null` means "unknown", in which case inference is refused.
   */
  referenceWidthCm: number | null;
  /** Which parameter `referenceWidthCm` refers to. */
  reference: 'widthCm' | 'heightCm' | 'depthCm';
}

export type InferenceResult =
  | { ok: true; spec: DesignSpec }
  | { ok: false; reason: 'no_reference' | 'invalid_reference'; message: string };

const MIN_REFERENCE_CM = 10;
const MAX_REFERENCE_CM = 400;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Build a design-spec proposal from an image sample and one known dimension.
 * Returns a refusal (never a guessed "exact" value) when no usable reference is
 * given.
 */
export function inferDesignSpec(input: InferenceInput): InferenceResult {
  const reference = input.referenceWidthCm;
  if (reference === null || !Number.isFinite(reference)) {
    return {
      ok: false,
      reason: 'no_reference',
      message:
        "Rasmdan aniq o'lcham chiqarib bo'lmaydi. Iltimos, kamida bitta ma'lum o'lchamni " +
        "kiriting (masalan, kengligi) — shundan keyin qolganlari proporsiya bo'yicha baholanadi.",
    };
  }
  if (reference < MIN_REFERENCE_CM || reference > MAX_REFERENCE_CM) {
    return {
      ok: false,
      reason: 'invalid_reference',
      message: `Ma'lum o'lcham ${MIN_REFERENCE_CM}–${MAX_REFERENCE_CM} sm oralig'ida bo'lishi kerak.`,
    };
  }

  const aspect =
    Number.isFinite(input.sample.aspectRatio) && input.sample.aspectRatio > 0
      ? input.sample.aspectRatio
      : 1;

  // Start from the type's defaults, then scale the other axes by the image
  // proportion relative to the reference axis. This is a rough estimate.
  const base = createFurnitureParams(input.type);
  const dims: Record<'widthCm' | 'heightCm' | 'depthCm', number> = {
    widthCm: base.widthCm,
    heightCm: base.heightCm,
    depthCm: base.depthCm,
  };
  dims[input.reference] = reference;

  // Use the aspect ratio to relate width and height only (a photo gives a useful
  // front proportion but says nothing reliable about depth).
  if (input.reference === 'widthCm') {
    dims.heightCm = round1(reference / aspect);
  } else if (input.reference === 'heightCm') {
    dims.widthCm = round1(reference * aspect);
  }

  const dimensions: DesignDimensions = {
    width_cm: round1(dims.widthCm),
    height_cm: round1(dims.heightCm),
    depth_cm: round1(dims.depthCm),
  };

  const notes = [
    `Rasm proporsiyasi bo'yicha baholandi (aspekt: ${aspect.toFixed(2)}).`,
    `Ma'lum o'lcham: ${input.reference} = ${reference} sm.`,
  ];
  const warnings = [
    "O'lchamlar faqat bitta ma'lum qiymat va rasm proporsiyasidan **taxminan** hisoblandi; " +
      "aniq o'lchov emas.",
    "Chuqurlik rasmdan aniqlanmaydi — tur defaultidan olindi; kerak bo'lsa qo'lda tuzating.",
    "Bu oddiy proporsiya evristikasi, kompyuter ko'rishi yoki AI emas.",
  ];

  const spec: DesignSpec = {
    furniture: input.type,
    dimensions,
    color: input.sample.averageColor,
    material_kind: null,
    style: null,
    confidence: 'low',
    notes,
    warnings,
    supported: true,
  };
  return { ok: true, spec };
}

/** Convert an accepted spec into validated W2 builder parameters. */
export function specToFurnitureParams(
  type: FurnitureType,
  dimensions: DesignDimensions | null,
): FurnitureParams {
  const params = createFurnitureParams(type);
  if (dimensions) {
    params.widthCm = dimensions.width_cm;
    params.heightCm = dimensions.height_cm;
    params.depthCm = dimensions.depth_cm;
  }
  return params;
}

/** A short, honest summary line for the UI. */
export function describeInference(type: FurnitureType): string {
  return (
    `${FURNITURE_TYPE_LABELS[type]} — rasm proporsiyasi bo'yicha taxminiy parametrlar. ` +
    `Standart qiymatlar: ${FURNITURE_DEFAULTS[type].widthCm}×${FURNITURE_DEFAULTS[type].heightCm}×` +
    `${FURNITURE_DEFAULTS[type].depthCm} sm.`
  );
}
