/**
 * W8 export errors and shared types.
 *
 * Export failures are surfaced as a typed `ExportError` so the UI can show a
 * clear message and the editor can keep working (an export failure must never
 * break the scene).
 */

import type { QualityPreflightResult } from './quality/types';

export type ExportErrorCode =
  | 'invalid_geometry'
  | 'empty_scene'
  | 'too_large'
  | 'unsupported'
  | 'quality_blocked'
  | 'failed';

export class ExportError extends Error {
  readonly code: ExportErrorCode;
  /** Structured preflight result when quality enforcement blocked the export. */
  readonly quality?: QualityPreflightResult;

  constructor(
    code: ExportErrorCode,
    message: string,
    quality?: QualityPreflightResult,
  ) {
    super(message);
    this.name = 'ExportError';
    this.code = code;
    this.quality = quality;
  }
}

export const EXPORT_ERROR_MESSAGES: Record<ExportErrorCode, string> = {
  invalid_geometry:
    "Sahnada noto'g'ri (NaN yoki cheksiz) geometriya bor — eksport bekor qilindi. " +
    "Modelni tuzatib, qaytadan urinib ko'ring.",
  empty_scene:
    "Eksport qilish uchun ko'rinadigan geometriya yo'q. Obyektni ko'rsating yoki " +
    "xonani eksportga qo'shing.",
  too_large: 'Eksport fayli ruxsat etilgan hajmdan katta.',
  unsupported: "Bu format hozircha qo'llab-quvvatlanmaydi.",
  quality_blocked:
    "Eksport sifat byudjeti talablarini buzmoqda — avval ko'rsatilgan muammolarni tuzating.",
  failed: "Eksport amalga oshmadi. Iltimos, qaytadan urinib ko'ring.",
};

/** Dimensional metadata carried into export filenames and the JSON format. */
export interface ExportMetadata {
  /** Project / model name (used for the filename). */
  name: string;
  /** Dominant furniture type, when the scene has one; null for an interior only. */
  furnitureType: string | null;
  /** Unit system. All scene lengths are centimetres. */
  units: 'cm';
}

/** Result of a data export: the bytes plus the name and MIME to download. */
export interface ExportArtifact {
  blob: Blob;
  filename: string;
  mimeType: string;
  /** Final quality result, including exact produced size/payload when measured. */
  quality?: QualityPreflightResult;
}
