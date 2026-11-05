/**
 * Phase 5.7 — decide whether a captured RGBA buffer really kept its alpha
 * channel instead of being flattened onto an opaque background.
 *
 * The probe looks at the four corners: with a transparent capture they must be
 * fully transparent. An OutputPass or framebuffer that drops alpha turns them
 * opaque, which is exactly the failure this rejects. Corners are used instead of
 * an object pixel because framing must not decide the verdict.
 */
export const TRANSPARENT_PROBE_WIDTH = 96;
export const TRANSPARENT_PROBE_HEIGHT = 54;
/** Allow one unit of rounding noise from a half-float render target. */
export const ALPHA_CORNER_TOLERANCE = 2;

export interface TransparentProbeResult {
  supported: boolean;
  /** Alpha values at (0,0), (w-1,0), (0,h-1), (w-1,h-1). */
  cornerAlpha: number[];
  reason?: string;
}

function cornerIndices(width: number, height: number): number[] {
  const lastX = width - 1;
  const lastY = height - 1;
  return [0, lastX, lastY * width, lastY * width + lastX];
}

export function analyzeAlphaProbe(
  pixels: Uint8Array,
  width: number,
  height: number,
): TransparentProbeResult {
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) {
    return {
      supported: false,
      cornerAlpha: [],
      reason: "Alpha probe uchun bufer to'liq emas.",
    };
  }
  const cornerAlpha = cornerIndices(width, height).map(
    (pixelIndex) => pixels[pixelIndex * 4 + 3],
  );
  if (cornerAlpha.some((alpha) => alpha > ALPHA_CORNER_TOLERANCE)) {
    return {
      supported: false,
      cornerAlpha,
      reason:
        "Brauzer shaffof fonni saqlamayapti (burchak piksellari shaffof emas). " +
        "Opaque PNG variantidan foydalaning.",
    };
  }
  return { supported: true, cornerAlpha };
}
