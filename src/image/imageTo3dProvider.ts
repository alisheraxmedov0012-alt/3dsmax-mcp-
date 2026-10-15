/**
 * W7 image→3D provider boundary.
 *
 * NO real image→3D service is selected, so this module ships **only the interface
 * and an explicit "not configured" status**. There is deliberately no fake
 * provider, no static mock and no network code: claiming a mesh was generated
 * when nothing was called would be a lie, and the UI must show this capability as
 * not yet configured.
 *
 * Authentication model (when a provider is chosen later): the API key lives in the
 * SERVER environment only (e.g. an `APP_IMAGE_TO_3D_API_KEY` handled by the
 * backend). The browser must never hold or send the key; it uploads the image to
 * our backend, which talks to the provider. This file therefore never reads an
 * env var, never holds a secret and never performs I/O.
 *
 * A future provider implementation must define, at minimum:
 * - timeout and cancellation,
 * - typed error classes (auth / rate-limit / invalid-output / network / timeout),
 * - strict validation of the returned mesh (format, non-empty, vertex budget),
 * - cost/usage reporting and per-user limits,
 * - explicit user consent before any image leaves the device.
 */
import type { ImageFormat } from './imageFile';

/** A generated mesh, kept as raw bytes + its format so it can be validated. */
export interface ImageTo3DMesh {
  /** Only binary glTF is assumed for a real mesh result. */
  format: 'glb';
  bytes: ArrayBuffer;
}

export interface ImageTo3DRequest {
  image: {
    format: ImageFormat;
    bytes: ArrayBuffer;
  };
  /** Server-side user/plan context would be added here. */
  userId?: string;
}

export type ImageTo3DErrorKind =
  | 'unconfigured'
  | 'auth'
  | 'rate_limited'
  | 'timeout'
  | 'invalid_output'
  | 'network'
  | 'too_large';

export class ImageTo3DError extends Error {
  readonly kind: ImageTo3DErrorKind;

  constructor(kind: ImageTo3DErrorKind, message: string) {
    super(message);
    this.name = 'ImageTo3DError';
    this.kind = kind;
  }
}

export interface ImageTo3DProvider {
  readonly id: string;
  readonly isConfigured: boolean;
  generateMesh(request: ImageTo3DRequest, signal?: AbortSignal): Promise<ImageTo3DMesh>;
}

export interface ImageTo3DStatus {
  configured: boolean;
  /** Human-readable Uzbek status for the UI. Never pretends to be active. */
  message: string;
}

/**
 * Resolve the active image→3D provider. Always reports "not configured" here
 * because no provider exists yet; when one is added it will be returned from the
 * backend, not fabricated on the client.
 */
export function getImageTo3DProvider(): ImageTo3DProvider | null {
  return null;
}

/** Status the UI shows. */
export function describeImageTo3DStatus(): ImageTo3DStatus {
  const provider = getImageTo3DProvider();
  if (!provider || !provider.isConfigured) {
    return {
      configured: false,
      message:
        "Haqiqiy image-to-3D xizmati hozircha sozlanmagan. Hozir rasm asosida faqat " +
        "parametrik model taklif qilinadi (rasm hech qayerga yuborilmaydi).",
    };
  }
  return { configured: true, message: 'Image-to-3D xizmati sozlangan.' };
}

/**
 * Guard used by callers that want to offer real mesh generation: throws a typed
 * `unconfigured` error instead of silently doing nothing or faking success.
 */
export async function generateImageTo3DMesh(request: ImageTo3DRequest): Promise<ImageTo3DMesh> {
  const provider = getImageTo3DProvider();
  if (!provider || !provider.isConfigured) {
    throw new ImageTo3DError(
      'unconfigured',
      "Image-to-3D xizmati sozlanmagan — bu imkoniyat hozircha mavjud emas.",
    );
  }
  return provider.generateMesh(request);
}
