/**
 * W9 cut list.
 *
 * The cut list is derived from the BOM's panel rows (board-type parts whose
 * smallest side is thin enough to be a sheet). For each panel the three measured
 * sides are sorted largest-first: length = largest, width = middle,
 * thickness = smallest.
 *
 * Honest boundaries: no kerf allowance, no sheet layout/nesting, no grain
 * direction and no waste factor are computed — those need shop standards the
 * project does not have.
 */
import type { BomResult, BomRow } from './bom';
import type { BomMaterialInfo } from './sheetMaterial';

export interface CutListRow {
  /** Stable id shared with the BOM (e.g. "wardrobe-side"). */
  partId: string;
  name: string;
  quantity: number;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  /** Always taken from the BOM (measured geometry). */
  source: 'bom';
  /**
   * Board material for this piece, copied from the BOM. Null when the user
   * assigned none — it is never filled in with a guess.
   */
  material: BomMaterialInfo | null;
  notes: string[];
}

export interface CutListResult {
  unit: 'mm';
  rows: CutListRow[];
  totalPieces: number;
  /** Sum of face areas (m²); kerf/waste NOT included. */
  panelAreaM2: number;
  limitations: string[];
}

export const CUT_LIST_LIMITATIONS: readonly string[] = [
  "Kesish ro'yxati faqat panel (yupqa) detallardan tuzildi.",
  'Kerf (arra tishi) va chiqindi hisobga olinmagan.',
  'List layout / nesting hisoblanmagan — sex standartlari asosida tekshirish kerak.',
  "Yog'och tolasi yo'nalishi hisobga olinmagan.",
  "Qalinlik standarti modelda yo'q — faqat geometriyadan o'lchangan qiymat.",
];

const PANEL_NOTE = "Panel detali (BOM'dan olingan).";

function toCutRow(row: BomRow): CutListRow | null {
  if (row.thicknessMm === null) {
    return null;
  }
  const sorted = [row.sizeMm.x, row.sizeMm.y, row.sizeMm.z].sort((a, b) => b - a);
  const [lengthMm, widthMm, thicknessMm] = sorted;
  return {
    partId: row.partId,
    name: row.name,
    quantity: row.quantity,
    lengthMm,
    widthMm,
    thicknessMm,
    source: 'bom',
    material: row.material,
    notes: [PANEL_NOTE],
  };
}

/** Build a cut list from an already-computed BOM (pure, deterministic). */
export function buildCutList(bom: BomResult): CutListResult {
  const rows = bom.rows
    .map((row) => toCutRow(row))
    .filter((row): row is CutListRow => row !== null);

  const totalPieces = rows.reduce((sum, row) => sum + row.quantity, 0);
  const area = rows.reduce(
    (sum, row) => sum + ((row.lengthMm * row.widthMm) / 1_000_000) * row.quantity,
    0,
  );

  return {
    unit: 'mm',
    rows,
    totalPieces,
    panelAreaM2: Math.round(area * 1000) / 1000,
    limitations: [...CUT_LIST_LIMITATIONS],
  };
}
