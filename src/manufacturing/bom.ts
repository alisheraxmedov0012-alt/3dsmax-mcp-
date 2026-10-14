/**
 * W9 Bill of Materials.
 *
 * The BOM is measured from real geometry (see `parts.ts`) and grouped into
 * quantity lines. Nothing is invented: the model carries no material, hardware or
 * joinery data, so those fields are `null` and the gap is stated explicitly in
 * `limitations` instead of being filled with plausible-looking defaults.
 *
 * Units: the scene is in centimetres, the BOM is reported in **millimetres**.
 */
import { buildFurniture } from '../geometry/furniture/buildFurniture';
import {
  FURNITURE_TYPE_LABELS,
  type FurnitureParams,
  type FurnitureType,
} from '../geometry/furniture/types';
import { validateFurnitureParams } from '../geometry/furniture/params';
import {
  PART_KIND_LABELS,
  PANEL_KINDS,
  groupParts,
  measureParts,
  minDimensionCm,
  partTypeOf,
  totalPartCount,
  type PartGroup,
  type PartKind,
  type PartType,
} from './parts';
import { convertLength, roundLength } from './units';

/** A panel is a board only when its smallest side is this thin or thinner (cm). */
export const PANEL_MAX_THICKNESS_CM = 6;

export interface BomRow {
  /** Display name, e.g. "Yon paneli". */
  name: string;
  /** Stable kind-based id, e.g. "wardrobe-side". */
  partId: string;
  kind: PartKind;
  partType: PartType;
  quantity: number;
  /** Raw box size in mm (local frame: x across, y up, z depth). */
  sizeMm: { x: number; y: number; z: number };
  /** Panel thickness in mm (smallest side); null for non-panel parts. */
  thicknessMm: number | null;
  /** Material — always null: the model has no material data. */
  material: null;
  /** Where each value came from, so nothing is presented as more than it is. */
  sources: {
    dimensions: 'geometry';
    quantity: 'counted';
    material: 'unavailable';
  };
  notes: string[];
}

export interface BomResult {
  type: FurnitureType;
  typeLabel: string;
  unit: 'mm';
  rows: BomRow[];
  totalParts: number;
  /** Preliminary panel area (m²) — kerf and waste are NOT included. */
  panelAreaM2: number;
  limitations: string[];
}

export type BomOutcome = { ok: true; bom: BomResult } | { ok: false; reason: string };

export const BOM_LIMITATIONS: readonly string[] = [
  'Malumot model geometriyasidan olchandi (dastlabki hisob-kitob).',
  "Material turi va qalinligi standarti modelda yo'q — material ustuni bo'sh.",
  "Furnitura, biriktirish texnologiyasi va ulanish turlari hisoblanmagan.",
  "Arralash kerfi (kerf), chiqindi va toleranslar hisobga olinmagan.",
  'Konstruktiv mustahkamlik hisoblari bajarilmagan.',
];

function isPanel(group: PartGroup): boolean {
  return PANEL_KINDS.includes(group.kind) && minDimensionCm(group) <= PANEL_MAX_THICKNESS_CM;
}

function toRow(type: FurnitureType, group: PartGroup): BomRow {
  const panel = isPanel(group);
  const mm = (valueCm: number) => roundLength(convertLength(valueCm, 'cm', 'mm'), 'mm');
  const notes: string[] = [];
  if (!panel && PANEL_KINDS.includes(group.kind)) {
    notes.push(
      "Qalinligi kesish royxatiga mos emas (yupqa panel emas) — bu detal blok sifatida qoldirildi.",
    );
  }
  return {
    name: PART_KIND_LABELS[group.kind],
    partId: `${type}-${group.kind}`,
    kind: group.kind,
    partType: partTypeOf(group.kind),
    quantity: group.quantity,
    sizeMm: { x: mm(group.sizeXCm), y: mm(group.sizeYCm), z: mm(group.sizeZCm) },
    thicknessMm: panel ? mm(minDimensionCm(group)) : null,
    material: null,
    sources: { dimensions: 'geometry', quantity: 'counted', material: 'unavailable' },
    notes,
  };
}

function panelAreaM2(rows: BomRow[]): number {
  let area = 0;
  for (const row of rows) {
    if (row.thicknessMm === null) {
      continue;
    }
    const dims = [row.sizeMm.x, row.sizeMm.y, row.sizeMm.z].sort((a, b) => b - a);
    // The two largest sides form the face; convert mm² to m².
    area += ((dims[0] * dims[1]) / 1_000_000) * row.quantity;
  }
  return Math.round(area * 1000) / 1000;
}

/**
 * Build the BOM for one furniture type from its parameters. Invalid parameters
 * are rejected with a clear reason (the caller keeps the editor running).
 */
export function buildBom(type: FurnitureType, params: FurnitureParams): BomOutcome {
  const validated = validateFurnitureParams(type, params);
  if (!validated) {
    return {
      ok: false,
      reason: "Detallar ro'yxatini tuzish uchun mebel parametrlari noto'g'ri yoki yetishmayapti.",
    };
  }

  const built = buildFurniture(type, validated);
  let groups: PartGroup[];
  try {
    groups = groupParts(measureParts(type, built.group));
  } finally {
    built.dispose();
  }

  if (groups.length === 0) {
    return { ok: false, reason: "Modelda olchanadigan detallar topilmadi." };
  }

  const rows = groups.map((group) => toRow(type, group));
  return {
    ok: true,
    bom: {
      type,
      typeLabel: FURNITURE_TYPE_LABELS[type],
      unit: 'mm',
      rows,
      totalParts: totalPartCount(groups),
      panelAreaM2: panelAreaM2(rows),
      limitations: [...BOM_LIMITATIONS],
    },
  };
}
