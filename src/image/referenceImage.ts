/**
 * W7 browser-side reference-image loading.
 *
 * Everything that touches the DOM / image decoding lives here, guarded by
 * feature detection, and it is split from the pure validation and inference so
 * those can be tested in Node.
 *
 * Privacy / resource rules enforced here:
 * - the decoded bitmap and the temporary canvas are released after sampling;
 * - the preview object URL is created by the caller and revoked by `dispose`;
 * - nothing is uploaded anywhere — this module performs no network I/O.
 */
import { averageColorFromPixels } from './colorSample';
import { validateImageDimensions, type ImageFormat } from './imageFile';

export interface LoadedImageSample {
  width: number;
  height: number;
  aspectRatio: number;
  averageColor: string | null;
}

/** True when the runtime can decode images for analysis. */
export function canDecodeImages(): boolean {
  return (
    typeof createImageBitmap === 'function' &&
    (typeof OffscreenCanvas === 'function' || typeof document !== 'undefined')
  );
}

const SAMPLE_SIZE = 32; // downsample target before averaging colour

function sampleViaCanvas(bitmap: ImageBitmap | HTMLImageElement): string | null {
  let canvas: HTMLCanvasElement | OffscreenCanvas;
  let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (typeof OffscreenCanvas === 'function') {
    canvas = new OffscreenCanvas(SAMPLE_SIZE, SAMPLE_SIZE);
    context = canvas.getContext('2d');
  } else if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    context = canvas.getContext('2d');
  } else {
    return null;
  }
  if (!context) {
    return null;
  }
  const source = bitmap as CanvasImageSource;
  context.drawImage(source, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const imageData = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  return averageColorFromPixels(imageData.data);
}

/**
 * Decode image bytes, validate the pixel dimensions and sample an approximate
 * average colour. Throws an `Error` with a user-facing message on failure.
 */
export async function loadImageSample(
  buffer: ArrayBuffer,
  _format: ImageFormat,
): Promise<LoadedImageSample> {
  if (!canDecodeImages()) {
    throw new Error("Bu qurilmada rasmni tahlil qilib bo'lmaydi.");
  }
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(new Blob([buffer]));
    const check = validateImageDimensions(bitmap.width, bitmap.height);
    if (!check.ok) {
      throw new Error(check.message);
    }
    const averageColor = sampleViaCanvas(bitmap);
    return {
      width: bitmap.width,
      height: bitmap.height,
      aspectRatio: bitmap.width / bitmap.height,
      averageColor,
    };
  } finally {
    // Always release the decoded bitmap to free GPU/CPU memory.
    bitmap?.close();
  }
}
