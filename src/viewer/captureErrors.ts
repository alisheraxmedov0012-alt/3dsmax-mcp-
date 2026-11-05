/**
 * Phase 5.8 — typed capture failures.
 *
 * A single user-facing message cannot distinguish "the GPU lost its context"
 * from "the readback returned nothing", and the recovery differs. The renderer
 * throws these codes; the UI maps them through {@link describeCaptureError}.
 */
export type CaptureFailureCode =
  | 'context-lost'
  | 'busy'
  | 'empty-buffer'
  | 'readback-failed'
  | 'encode-failed'
  | 'transparent-unsupported';

export class CaptureError extends Error {
  readonly cause?: unknown;

  constructor(
    readonly code: CaptureFailureCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'CaptureError';
    this.cause = options?.cause;
  }
}

export function describeCaptureError(error: unknown): string {
  if (error instanceof CaptureError) {
    switch (error.code) {
      case 'context-lost':
        return (
          "WebGL konteksti yo'qoldi. 3D ko'rinishni qayta yuklang va eksportni " +
          'takrorlang.'
        );
      case 'busy':
        return "Boshqa eksport davom etmoqda. U tugagach qayta urinib ko'ring.";
      case 'empty-buffer':
        return "Render natijasi bo'sh chiqdi. Qayta urinib ko'ring.";
      case 'readback-failed':
        return "Render natijasini o'qib bo'lmadi. Qayta urinib ko'ring.";
      case 'encode-failed':
        return "PNG faylini yaratib bo'lmadi. Qayta urinib ko'ring.";
      case 'transparent-unsupported':
        return error.message;
    }
  }
  return error instanceof Error && error.message
    ? `Eksport amalga oshmadi: ${error.message}`
    : "Eksport amalga oshmadi. Qayta urinib ko'ring.";
}
