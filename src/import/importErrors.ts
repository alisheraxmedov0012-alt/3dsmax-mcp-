/**
 * Phase 6.2 — import failures.
 *
 * Same shape as `ExportError`: a typed code the UI can branch on plus a message
 * written for the person holding the file. Import never throws a bare `Error`, so
 * a caller always has something specific to show.
 */

export type ImportErrorCode =
  | 'empty'
  | 'too_large'
  | 'unsupported_format'
  | 'gltf_not_supported'
  | 'malformed'
  | 'unsupported_extension'
  | 'external_resource'
  | 'too_complex'
  | 'invalid_geometry'
  | 'aborted'
  | 'failed';

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  /** Extra, already-formatted detail (limits, extension names, file names). */
  readonly detail: string | null;

  constructor(code: ImportErrorCode, message: string, detail: string | null = null) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
    this.detail = detail;
  }
}

export const IMPORT_ERROR_MESSAGES: Record<ImportErrorCode, string> = {
  empty: "Fayl bo'sh yoki o'qib bo'lmadi.",
  too_large: "Fayl ruxsat etilgan hajmdan katta.",
  unsupported_format: "Bu fayl model formati emas. Faqat .glb qo'llab-quvvatlanadi.",
  gltf_not_supported:
    "Bu glTF (matnli) fayl. Hozircha faqat .glb qo'llab-quvvatlanadi — modelni .glb qilib eksport qiling.",
  malformed: "Fayl buzilgan yoki GLB formatiga mos emas.",
  unsupported_extension: "Model qo'llab-quvvatlanmaydigan kengaytmadan foydalanadi.",
  external_resource:
    "Model tashqi faylga havola qiladi. Faqat ichiga joylangan resursli GLB qabul qilinadi.",
  too_complex: "Model ruxsat etilgan chegaradan og'ir.",
  invalid_geometry: "Modelda noto'g'ri geometriya bor (NaN, cheksiz yoki buzuq indeks).",
  aborted: 'Import bekor qilindi.',
  failed: "Modelni o'qib bo'lmadi. Iltimos, faylni tekshirib qaytadan urinib ko'ring.",
};

/** Builds an `ImportError` with the canonical message for its code. */
export function importFailure(
  code: ImportErrorCode,
  detail: string | null = null,
): ImportError {
  return new ImportError(code, IMPORT_ERROR_MESSAGES[code], detail);
}
