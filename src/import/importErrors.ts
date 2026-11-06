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
  | 'missing_resource'
  | 'ambiguous_resource'
  | 'too_complex'
  | 'invalid_geometry'
  | 'aborted'
  | 'failed';

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  /**
   * The specific reason, when the throw site knows one (a limit, a file name, an
   * extension). Kept separately so a caller can log it without the generic text.
   */
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
    "Model tanlanmagan faylga havola qiladi. Barcha kerakli fayllarni birga tanlang.",
  missing_resource: "Model uchun kerakli fayllar topilmadi.",
  ambiguous_resource:
    "Bir xil nomli fayllar bor — qaysi biri kerakligi aniq emas. Fayllarni qayta tanlang.",
  too_complex: "Model ruxsat etilgan chegaradan og'ir.",
  invalid_geometry: "Modelda noto'g'ri geometriya bor (NaN, cheksiz yoki buzuq indeks).",
  aborted: 'Import bekor qilindi.',
  failed: "Modelni o'qib bo'lmadi. Iltimos, faylni tekshirib qaytadan urinib ko'ring.",
};

/**
 * Builds an `ImportError` for a code.
 *
 * When the throw site supplies a concrete reason, that reason *is* the message:
 * "GLB chunk hajmi fayl chegarasidan tashqarida" tells the user what to fix, while
 * the generic text for `malformed` does not. The canonical text stays as the
 * fallback for errors raised without detail.
 */
export function importFailure(
  code: ImportErrorCode,
  detail: string | null = null,
): ImportError {
  return new ImportError(code, detail ?? IMPORT_ERROR_MESSAGES[code], detail);
}
