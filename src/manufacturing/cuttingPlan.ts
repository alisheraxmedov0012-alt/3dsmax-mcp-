/**
 * C7 — material usage and cutting optimisation.
 *
 * Turns the C1–C3 cut list into a per-sheet cutting layout, then reports how much
 * board that layout consumes and how much it wastes. Pure and deterministic: no
 * React, no I/O, same input → same plan.
 *
 * ## Algorithm
 *
 * MaxRects with the Best-Short-Side-Fit heuristic, which is a standard, published
 * 2D bin-packing method. Sheets are filled one material/thickness group at a time
 * (boards of different material or nominal thickness are never mixed). For each
 * piece, in descending area order, every open sheet's free rectangles are scored
 * by the shorter leftover side; the tightest fit wins and ties break on a fixed
 * order (sheet index, then free-rect position, then unrotated before rotated).
 * The chosen rectangle is subtracted from every free rectangle it intersects, and
 * any free rectangle fully contained in another is pruned.
 *
 * ## Honest boundaries
 *
 * - **Not optimal.** MaxRects-BSSF is a heuristic. A better nest usually exists
 *   for any non-trivial set, and a shop cutting by hand may beat it. The UI and
 *   the PDF both say so; nothing here claims an optimal yield.
 * - **No grain direction.** The cut list does not record grain, so a sheet may be
 *   used in either direction and pieces may be rotated — but only when the caller
 *   allows rotation. With rotation off, the entered sheet orientation is treated
 *   as meaningful and is never silently flipped.
 * - **Kerf is a reserved band, not a cut simulation.** Each placed piece reserves
 *   `kerf` to its right and above it, clamped to the usable area. That guarantees
 *   neighbouring pieces are never closer than one kerf, but it does not model the
 *   real cut order, blade wander or tear-out, and it loses one kerf at the far
 *   edges. `kerfAreaM2` reports that reserved band, separately from `wasteAreaM2`
 *   (the offcut area), because they are different quantities.
 * - **Edge margin** is an inset on all four sides. When the caller supplies none,
 *   the plan runs with a 0 mm inset and says so; that is the absence of an
 *   allowance, not a shop standard.
 * - **Two-dimensional only.** Panel thickness decides *which* sheet a part goes
 *   on, never a third nesting axis.
 */
import type { BomResult } from './bom';
import type { CutListResult } from './cutList';
import type { BomMaterialInfo, SheetMaterialId } from './sheetMaterial';

/**
 * Defensive guard on the numbers a user may type.
 *
 * This is not a board standard: it only stops a typo (or a pasted number) from
 * turning into an unbounded computation. The project has no approved sheet
 * catalogue, so no "valid" sheet size is asserted here.
 */
export const CUTTING_LIMITS = {
  maxSheetDimensionMm: 100_000,
} as const;

/** Problems that always apply to a plan from this module. */
export const CUTTING_PLAN_LIMITATIONS: readonly string[] = [
  "Algoritm (MaxRects, best-short-side-fit) evristik hisoblanadi: global optimal kesish rejasi kafolatlanmaydi.",
  "Kesish tartibi, arra yurishi va qirra sinishi modellashtirilmagan — faqat joylashuv hisoblanadi.",
  "Kerf har bir detalning o'ng va yuqori tomonida band sifatida band qilinadi; aniq kesim geometriyasi emas.",
  "Yog'och tolasi yo'nalishi va qirra qoplama (edge banding) hisobga olinmagan.",
  "List o'lchamlari va kerf foydalanuvchi kiritgan qiymatlar; standart yoki sertifikat emas.",
  'Bu hisob-kitob ishlab chiqarish xavfsizligini yoki konstruktiv mustahkamlikni tasdiqlamaydi.',
];

/** Which board a piece is cut from. Two pieces share a sheet only on an exact match. */
export interface SheetSettings {
  /** Sheet length in millimetres, as entered. */
  sheetLengthMm: number;
  /** Sheet width in millimetres, as entered. */
  sheetWidthMm: number;
  /** Saw kerf in millimetres. `0` means no allowance is applied. */
  kerfMm: number;
  /** Inset on all four sheet edges, in millimetres. */
  edgeMarginMm: number;
  /** True when the caller left the edge margin out entirely. */
  edgeMarginProvided: boolean;
  /** Whether a piece may be turned 90° to fit. */
  allowRotation: boolean;
  /** Maximum boards available for the whole job, or null for no limit. */
  maxSheets: number | null;
}

export interface SheetSettingsInput {
  sheetLengthMm: number;
  sheetWidthMm: number;
  kerfMm: number;
  edgeMarginMm?: number;
  allowRotation: boolean;
  maxSheets?: number;
}

export type SheetSettingsOutcome =
  | { ok: true; settings: SheetSettings }
  | { ok: false; reason: string };

export type CuttingIssueLevel = 'error' | 'warning' | 'info';

export type CuttingIssueCode =
  | 'cut-list-empty'
  | 'no-material'
  | 'not-a-panel'
  | 'piece-too-large'
  | 'sheet-limit'
  | 'piece-invalid-size'
  | 'kerf-zero'
  | 'edge-margin-defaulted'
  | 'thickness-mismatch'
  | 'partial-placement';

export interface CuttingIssue {
  level: CuttingIssueLevel;
  code: CuttingIssueCode;
  partId: string | null;
  message: string;
}

export type CuttingPlanStatus = 'ok' | 'partial' | 'unavailable';

export const CUTTING_STATUS_LABELS: Record<CuttingPlanStatus, string> = {
  ok: "To'liq joylashtirildi",
  partial: 'Qisman joylashtirildi',
  unavailable: 'Joylashtirib bo‘lmadi',
};

/** One physical piece on a sheet, in sheet coordinates (origin = bottom-left). */
export interface PlacedPiece {
  partId: string;
  name: string;
  /** 1-based index among the identical pieces of this part. */
  instance: number;
  /** Placement origin in millimetres from the sheet's bottom-left corner. */
  xMm: number;
  yMm: number;
  /** Size as placed (after any rotation). */
  widthMm: number;
  heightMm: number;
  /** Size before rotation, so the reader can see what was turned. */
  sourceWidthMm: number;
  sourceHeightMm: number;
  /** True when this piece was turned 90°. */
  rotated: boolean;
}

export interface CuttingSheet {
  /** 1-based index within its material group. */
  index: number;
  materialId: SheetMaterialId;
  materialName: string;
  thicknessMm: number;
  sheetLengthMm: number;
  sheetWidthMm: number;
  placements: PlacedPiece[];
  /** Sum of the piece faces on this sheet, in m². */
  usedAreaM2: number;
  /** Band reserved around the pieces for the saw, in m². */
  kerfAreaM2: number;
  /** Board area left over after pieces and kerf, in m². */
  wasteAreaM2: number;
  /** Waste as a share of this sheet's area, one decimal. */
  wastePercent: number;
}

export interface MaterialCuttingGroup {
  materialId: SheetMaterialId;
  name: string;
  thicknessMm: number;
  sheets: CuttingSheet[];
  pieceCount: number;
  /** Area the pieces need, in m². */
  usedAreaM2: number;
  /** Area of the boards this group consumes, in m². */
  availableAreaM2: number;
  kerfAreaM2: number;
  wasteAreaM2: number;
  wastePercent: number;
}

/**
 * Why a piece is not on a sheet.
 *
 * - `no-material`  — the user assigned no board material, so there is no sheet to
 *                    put it on. Naming a material would be inventing one.
 * - `not-a-panel`  — a solid part (leg, mattress, body); not sheet goods at all.
 * - `piece-too-large` — larger than an empty usable sheet in every allowed
 *                    orientation.
 * - `sheet-limit`  — `maxSheets` ran out before this piece found a home.
 * - `piece-invalid-size` — a non-positive dimension, so no layout is possible.
 */
export type UnplacedReason =
  | 'no-material'
  | 'not-a-panel'
  | 'piece-too-large'
  | 'sheet-limit'
  | 'piece-invalid-size';

export const UNPLACED_REASON_LABELS: Record<UnplacedReason, string> = {
  'no-material': 'Material belgilanmagan',
  'not-a-panel': 'Panel detali emas',
  'piece-too-large': "Listga sig'maydi",
  'sheet-limit': 'Listlar soni yetarli emas',
  'piece-invalid-size': "O'lcham yaroqsiz",
};

export interface UnplacedPiece {
  partId: string;
  name: string;
  quantity: number;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number | null;
  reason: UnplacedReason;
}

export interface CuttingSummary {
  /** Physical pieces the cut list asked for. */
  pieceCount: number;
  placedCount: number;
  unplacedCount: number;
  sheetCount: number;
  usedAreaM2: number;
  availableAreaM2: number;
  kerfAreaM2: number;
  wasteAreaM2: number;
  wastePercent: number;
  materialCount: number;
}

export interface CuttingPlan {
  settings: SheetSettings;
  status: CuttingPlanStatus;
  groups: MaterialCuttingGroup[];
  /** Cut-list pieces that did not end up on a sheet, with the reason. */
  unplaced: UnplacedPiece[];
  /** Solid parts the cut list excludes; never candidates for a sheet. */
  excluded: UnplacedPiece[];
  summary: CuttingSummary;
  issues: CuttingIssue[];
  limitations: string[];
}

export type CuttingPlanOutcome =
  | { ok: true; plan: CuttingPlan }
  | { ok: false; reason: string };

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Piece ready for nesting, already reduced to sheet coordinates. */
interface NestablePiece {
  partId: string;
  name: string;
  instance: number;
  widthMm: number;
  heightMm: number;
}

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** mm² → m², rounded to the millimetre-square precision the other modules use. */
const toM2 = (areaMm2: number): number => roundTo(areaMm2 / 1_000_000, 3);

const percentOf = (part: number, whole: number): number =>
  whole <= 0 ? 0 : roundTo((part / whole) * 100, 1);

function readDimension(
  value: unknown,
  label: string,
): { ok: true; value: number } | { ok: false; reason: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, reason: `${label} son bo'lishi kerak (mm).` };
  }
  if (value <= 0) {
    return { ok: false, reason: `${label} noldan katta bo'lishi kerak.` };
  }
  if (value > CUTTING_LIMITS.maxSheetDimensionMm) {
    return {
      ok: false,
      reason: `${label} juda katta — ${CUTTING_LIMITS.maxSheetDimensionMm} mm dan oshmasligi kerak.`,
    };
  }
  return { ok: true, value: roundTo(value, 1) };
}

/**
 * Allowances (kerf, edge margin) may legitimately be zero: that means "apply no
 * allowance". They may not be negative, NaN or infinite.
 */
function readAllowance(
  value: unknown,
  label: string,
): { ok: true; value: number } | { ok: false; reason: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, reason: `${label} son bo'lishi kerak (mm).` };
  }
  if (value < 0) {
    return { ok: false, reason: `${label} manfiy bo'lishi mumkin emas.` };
  }
  if (value > CUTTING_LIMITS.maxSheetDimensionMm) {
    return { ok: false, reason: `${label} juda katta.` };
  }
  return { ok: true, value: roundTo(value, 1) };
}

/**
 * Validate the user's sheet settings.
 *
 * Every rejection names the field and the rule. Nothing is defaulted silently:
 * the four measurements must be supplied, and only the edge margin is optional
 * (omitted = no inset, recorded as `edgeMarginProvided: false`).
 */
export function validateSheetSettings(input: SheetSettingsInput): SheetSettingsOutcome {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: "List sozlamalari kiritilmagan." };
  }

  const length = readDimension(input.sheetLengthMm, 'List uzunligi');
  if (!length.ok) {
    return length;
  }
  const width = readDimension(input.sheetWidthMm, 'List kengligi');
  if (!width.ok) {
    return width;
  }
  const kerf = readAllowance(input.kerfMm, 'Arra kesish eni (kerf)');
  if (!kerf.ok) {
    return kerf;
  }

  const marginProvided = input.edgeMarginMm !== undefined && input.edgeMarginMm !== null;
  const margin = readAllowance(input.edgeMarginMm ?? 0, 'List cheti chegarasi');
  if (!margin.ok) {
    return margin;
  }

  if (typeof input.allowRotation !== 'boolean') {
    return { ok: false, reason: "Aylantirish ruxsati belgilanmagan (ha/yo'q)." };
  }

  let maxSheets: number | null = null;
  if (input.maxSheets !== undefined && input.maxSheets !== null) {
    if (
      typeof input.maxSheets !== 'number' ||
      !Number.isFinite(input.maxSheets) ||
      !Number.isInteger(input.maxSheets) ||
      input.maxSheets <= 0
    ) {
      return { ok: false, reason: "Listlar soni butun musbat son bo'lishi kerak." };
    }
    maxSheets = input.maxSheets;
  }

  // The inset must leave board to cut from, otherwise every piece fails and the
  // reason would be buried in the per-piece report instead of stated up front.
  const usableLength = length.value - 2 * margin.value;
  const usableWidth = width.value - 2 * margin.value;
  if (usableLength <= 0 || usableWidth <= 0) {
    return {
      ok: false,
      reason: "Chekka chegara list o'lchamidan katta — kesish uchun joy qolmadi.",
    };
  }

  return {
    ok: true,
    settings: {
      sheetLengthMm: length.value,
      sheetWidthMm: width.value,
      kerfMm: kerf.value,
      edgeMarginMm: margin.value,
      edgeMarginProvided: marginProvided,
      allowRotation: input.allowRotation,
      maxSheets,
    },
  };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/**
 * Drop free rectangles that are entirely covered by another one, and any that
 * have no area. MaxRects relies on this to keep the free list small and to avoid
 * offering space that another rectangle already includes.
 */
function pruneFreeRects(rects: Rect[]): Rect[] {
  const alive = rects.filter((rect) => rect.w > 0 && rect.h > 0);
  const kept: Rect[] = [];
  for (let i = 0; i < alive.length; i += 1) {
    let redundant = false;
    for (let j = 0; j < alive.length; j += 1) {
      if (i === j) {
        continue;
      }
      if (contains(alive[j], alive[i])) {
        // Equal rectangles would remove each other; keep the earlier one only.
        const equal =
          alive[i].x === alive[j].x &&
          alive[i].y === alive[j].y &&
          alive[i].w === alive[j].w &&
          alive[i].h === alive[j].h;
        if (!equal || j < i) {
          redundant = true;
          break;
        }
      }
    }
    if (!redundant) {
      kept.push(alive[i]);
    }
  }
  return kept;
}

/** Subtract the band a placed piece occupies from every free rectangle it hits. */
function subtractRect(freeRects: Rect[], used: Rect): Rect[] {
  const next: Rect[] = [];
  for (const rect of freeRects) {
    if (!intersects(rect, used)) {
      next.push(rect);
      continue;
    }
    if (used.x > rect.x) {
      next.push({ x: rect.x, y: rect.y, w: used.x - rect.x, h: rect.h });
    }
    if (used.x + used.w < rect.x + rect.w) {
      next.push({ x: used.x + used.w, y: rect.y, w: rect.x + rect.w - (used.x + used.w), h: rect.h });
    }
    if (used.y > rect.y) {
      next.push({ x: rect.x, y: rect.y, w: rect.w, h: used.y - rect.y });
    }
    if (used.y + used.h < rect.y + rect.h) {
      next.push({ x: rect.x, y: used.y + used.h, w: rect.w, h: rect.y + rect.h - (used.y + used.h) });
    }
  }
  return pruneFreeRects(next);
}

interface SheetState {
  freeRects: Rect[];
  placements: PlacedPiece[];
  usedAreaMm2: number;
  kerfAreaMm2: number;
}

interface Fit {
  sheetIndex: number;
  freeIndex: number;
  rotated: boolean;
  widthMm: number;
  heightMm: number;
  /** Best-short-side-fit score: smaller is tighter. */
  shortSide: number;
  longSide: number;
}

/**
 * Score every orientation of `piece` against every open sheet.
 *
 * The comparison is explicit rather than delegated to a sort with a custom
 * comparator, so the tie-breaking order is readable: tightest short side, then
 * tightest long side, then the earliest sheet, then the earliest free rectangle,
 * then unrotated before rotated.
 */
function findBestFit(
  sheets: readonly SheetState[],
  piece: NestablePiece,
  allowRotation: boolean,
): Fit | null {
  let best: Fit | null = null;
  const orientations: Array<{ w: number; h: number; rotated: boolean }> = [
    { w: piece.widthMm, h: piece.heightMm, rotated: false },
  ];
  if (allowRotation && piece.widthMm !== piece.heightMm) {
    orientations.push({ w: piece.heightMm, h: piece.widthMm, rotated: true });
  }

  for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
    const sheet = sheets[sheetIndex];
    for (let freeIndex = 0; freeIndex < sheet.freeRects.length; freeIndex += 1) {
      const rect = sheet.freeRects[freeIndex];
      for (const orientation of orientations) {
        if (orientation.w > rect.w || orientation.h > rect.h) {
          continue;
        }
        const shortSide = Math.min(rect.w - orientation.w, rect.h - orientation.h);
        const longSide = Math.max(rect.w - orientation.w, rect.h - orientation.h);
        const candidate: Fit = {
          sheetIndex,
          freeIndex,
          rotated: orientation.rotated,
          widthMm: orientation.w,
          heightMm: orientation.h,
          shortSide,
          longSide,
        };
        if (best === null || isBetterFit(candidate, best)) {
          best = candidate;
        }
      }
    }
  }
  return best;
}

function isBetterFit(candidate: Fit, current: Fit): boolean {
  if (candidate.shortSide !== current.shortSide) {
    return candidate.shortSide < current.shortSide;
  }
  if (candidate.longSide !== current.longSide) {
    return candidate.longSide < current.longSide;
  }
  if (candidate.sheetIndex !== current.sheetIndex) {
    return candidate.sheetIndex < current.sheetIndex;
  }
  if (candidate.freeIndex !== current.freeIndex) {
    return candidate.freeIndex < current.freeIndex;
  }
  return !candidate.rotated && current.rotated;
}

/** Does this piece fit an empty usable sheet in at least one allowed orientation? */
function fitsEmptySheet(
  piece: NestablePiece,
  usableLength: number,
  usableWidth: number,
  allowRotation: boolean,
): boolean {
  if (piece.widthMm <= usableLength && piece.heightMm <= usableWidth) {
    return true;
  }
  return allowRotation && piece.heightMm <= usableLength && piece.widthMm <= usableWidth;
}

function newSheetState(
  usableLength: number,
  usableWidth: number,
  margin: number,
): SheetState {
  // The free area starts inside the edge margin, so every reported coordinate is
  // already in sheet space and the margin can never be cut into.
  return {
    freeRects: [{ x: margin, y: margin, w: usableLength, h: usableWidth }],
    placements: [],
    usedAreaMm2: 0,
    kerfAreaMm2: 0,
  };
}

/**
 * Place one piece on the chosen sheet.
 *
 * The band reserved is `kerf` to the right and above the piece, clamped to the
 * usable area so the far edges do not lose a phantom kerf outside the board.
 */
function commitPlacement(
  sheet: SheetState,
  piece: NestablePiece,
  fit: Fit,
  settings: SheetSettings,
  usableLength: number,
  usableWidth: number,
): void {
  const rect = sheet.freeRects[fit.freeIndex];
  const x = rect.x;
  const y = rect.y;
  const limitX = settings.edgeMarginMm + usableLength;
  const limitY = settings.edgeMarginMm + usableWidth;
  const reservedW = Math.min(fit.widthMm + settings.kerfMm, limitX - x);
  const reservedH = Math.min(fit.heightMm + settings.kerfMm, limitY - y);

  sheet.placements.push({
    partId: piece.partId,
    name: piece.name,
    instance: piece.instance,
    xMm: x,
    yMm: y,
    widthMm: fit.widthMm,
    heightMm: fit.heightMm,
    sourceWidthMm: piece.widthMm,
    sourceHeightMm: piece.heightMm,
    rotated: fit.rotated,
  });
  sheet.usedAreaMm2 += fit.widthMm * fit.heightMm;
  sheet.kerfAreaMm2 += reservedW * reservedH - fit.widthMm * fit.heightMm;
  sheet.freeRects = subtractRect(sheet.freeRects, { x, y, w: reservedW, h: reservedH });
}

interface MaterialBucket {
  materialId: SheetMaterialId;
  name: string;
  thicknessMm: number;
  pieces: NestablePiece[];
}

function materialKey(material: BomMaterialInfo): string {
  return `${material.materialId}:${material.thicknessMm}`;
}

/**
 * Solid parts the cut list necessarily excludes.
 *
 * Reported separately from `unplaced`: these were never candidates for a sheet,
 * so lumping them in with pieces that failed to nest would misstate the plan's
 * coverage. They are informational, not a failure.
 */
function collectNonPanelParts(
  bom: BomResult | undefined,
  cutList: CutListResult,
  issues: CuttingIssue[],
): UnplacedPiece[] {
  if (!bom) {
    return [];
  }
  const panelIds = new Set(cutList.rows.map((row) => row.partId));
  const excluded: UnplacedPiece[] = [];
  for (const row of bom.rows) {
    if (panelIds.has(row.partId) || row.thicknessMm !== null) {
      continue;
    }
    excluded.push({
      partId: row.partId,
      name: row.name,
      quantity: row.quantity,
      lengthMm: row.sizeMm.x,
      widthMm: row.sizeMm.y,
      thicknessMm: null,
      reason: 'not-a-panel',
    });
    issues.push({
      level: 'info',
      code: 'not-a-panel',
      partId: row.partId,
      message: `"${row.name}" panel detali emas — listga joylashtirilmadi.`,
    });
  }
  return excluded;
}

/** Deterministic order: biggest first, then by id so equal areas never shuffle. */
function nestOrder(a: NestablePiece, b: NestablePiece): number {
  const areaA = a.widthMm * a.heightMm;
  const areaB = b.widthMm * b.heightMm;
  if (areaA !== areaB) {
    return areaB - areaA;
  }
  const longA = Math.max(a.widthMm, a.heightMm);
  const longB = Math.max(b.widthMm, b.heightMm);
  if (longA !== longB) {
    return longB - longA;
  }
  if (a.partId !== b.partId) {
    return a.partId < b.partId ? -1 : 1;
  }
  return a.instance - b.instance;
}

function summarizeSheet(
  sheet: SheetState,
  settings: SheetSettings,
): Omit<CuttingSheet, 'index' | 'materialId' | 'materialName' | 'thicknessMm' | 'sheetLengthMm' | 'sheetWidthMm'> {
  const sheetAreaMm2 = settings.sheetLengthMm * settings.sheetWidthMm;
  const wasteMm2 = sheetAreaMm2 - sheet.usedAreaMm2 - sheet.kerfAreaMm2;
  return {
    placements: sheet.placements,
    usedAreaM2: toM2(sheet.usedAreaMm2),
    kerfAreaM2: toM2(sheet.kerfAreaMm2),
    wasteAreaM2: toM2(wasteMm2),
    wastePercent: percentOf(wasteMm2, sheetAreaMm2),
  };
}

/**
 * Build a cutting plan from an already-computed cut list.
 *
 * The cut list is the only source of pieces: quantities, part ids and face sizes
 * all come from it unchanged, so a plan can never describe a part the documents
 * do not contain.
 */
export function buildCuttingPlan(input: {
  cutList: CutListResult;
  settings: SheetSettingsInput;
  /** Optional BOM, used only to report solid parts the cut list excludes. */
  bom?: BomResult;
}): CuttingPlanOutcome {
  const checked = validateSheetSettings(input.settings);
  if (!checked.ok) {
    return { ok: false, reason: checked.reason };
  }
  const settings = checked.settings;
  const { cutList } = input;
  const issues: CuttingIssue[] = [];

  if (cutList.rows.length === 0) {
    return {
      ok: false,
      reason: "Kesish ro'yxatida panel detallari yo'q — kesish rejasini tuzib bo'lmaydi.",
    };
  }

  const excluded = collectNonPanelParts(input.bom, cutList, issues);

  if (settings.kerfMm === 0) {
    issues.push({
      level: 'warning',
      code: 'kerf-zero',
      partId: null,
      message: "Kerf 0 mm — arra eni hisobga olinmagan, detallar bir-biriga tegib turishi mumkin.",
    });
  }
  if (!settings.edgeMarginProvided) {
    issues.push({
      level: 'info',
      code: 'edge-margin-defaulted',
      partId: null,
      message: "Chekka chegara kiritilmagan — 0 mm qabul qilindi (ruxsat yo'q, standart emas).",
    });
  }

  // ---- group by material + nominal thickness ---------------------------
  const buckets = new Map<string, MaterialBucket>();
  const unplaced: UnplacedPiece[] = [];

  for (const row of cutList.rows) {
    if (row.lengthMm <= 0 || row.widthMm <= 0) {
      unplaced.push({
        partId: row.partId,
        name: row.name,
        quantity: row.quantity,
        lengthMm: row.lengthMm,
        widthMm: row.widthMm,
        thicknessMm: row.thicknessMm,
        reason: 'piece-invalid-size',
      });
      issues.push({
        level: 'error',
        code: 'piece-invalid-size',
        partId: row.partId,
        message: `"${row.name}" detali o'lchami yaroqsiz — joylashtirilmadi.`,
      });
      continue;
    }
    if (!row.material) {
      // No board chosen, so there is no sheet this piece could belong to. It is
      // listed as unplaced rather than dropped, and no material is assumed.
      unplaced.push({
        partId: row.partId,
        name: row.name,
        quantity: row.quantity,
        lengthMm: row.lengthMm,
        widthMm: row.widthMm,
        thicknessMm: row.thicknessMm,
        reason: 'no-material',
      });
      continue;
    }
    const material = row.material;
    if (material.thicknessMismatch) {
      issues.push({
        level: 'info',
        code: 'thickness-mismatch',
        partId: row.partId,
        message: `"${row.name}": nominal ${material.thicknessMm} mm, geometriya ${material.geometryThicknessMm} mm — list nominal qalinlik bo'yicha tanlandi.`,
      });
    }
    const key = materialKey(material);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        materialId: material.materialId,
        name: material.name,
        thicknessMm: material.thicknessMm,
        pieces: [],
      };
      buckets.set(key, bucket);
    }
    for (let copy = 1; copy <= row.quantity; copy += 1) {
      bucket.pieces.push({
        partId: row.partId,
        name: row.name,
        instance: copy,
        widthMm: row.lengthMm,
        heightMm: row.widthMm,
      });
    }
  }

  const usableLength = settings.sheetLengthMm - 2 * settings.edgeMarginMm;
  const usableWidth = settings.sheetWidthMm - 2 * settings.edgeMarginMm;

  // Group order is fixed by material id then thickness, not by insertion order,
  // so the same BOM always produces the same sheet numbering.
  const orderedBuckets = [...buckets.entries()]
    .sort(([keyA], [keyB]) => (keyA < keyB ? -1 : keyA > keyB ? 1 : 0))
    .map(([, bucket]) => bucket);

  const groups: MaterialCuttingGroup[] = [];
  let sheetsAllocated = 0;
  let totalUsedMm2 = 0;
  let totalKerfMm2 = 0;

  for (const bucket of orderedBuckets) {
    const pieces = [...bucket.pieces].sort(nestOrder);
    const sheets: SheetState[] = [];
    const groupUnplaced: UnplacedPiece[] = [];

    for (const piece of pieces) {
      if (!fitsEmptySheet(piece, usableLength, usableWidth, settings.allowRotation)) {
        groupUnplaced.push({
          partId: piece.partId,
          name: piece.name,
          quantity: 1,
          lengthMm: piece.widthMm,
          widthMm: piece.heightMm,
          thicknessMm: bucket.thicknessMm,
          reason: 'piece-too-large',
        });
        continue;
      }

      const fit = findBestFit(sheets, piece, settings.allowRotation);
      if (fit) {
        commitPlacement(sheets[fit.sheetIndex], piece, fit, settings, usableLength, usableWidth);
        continue;
      }

      // No open sheet has room: open one more if the job is allowed another.
      if (settings.maxSheets !== null && sheetsAllocated >= settings.maxSheets) {
        groupUnplaced.push({
          partId: piece.partId,
          name: piece.name,
          quantity: 1,
          lengthMm: piece.widthMm,
          widthMm: piece.heightMm,
          thicknessMm: bucket.thicknessMm,
          reason: 'sheet-limit',
        });
        continue;
      }

      const fresh = newSheetState(usableLength, usableWidth, settings.edgeMarginMm);
      // A fresh usable sheet always accepts a piece that passed `fitsEmptySheet`,
      // so this matches at least one orientation; the assert keeps that true if
      // the fit search ever changes.
      const freshFit = findBestFit([fresh], piece, settings.allowRotation);
      if (!freshFit) {
        groupUnplaced.push({
          partId: piece.partId,
          name: piece.name,
          quantity: 1,
          lengthMm: piece.widthMm,
          widthMm: piece.heightMm,
          thicknessMm: bucket.thicknessMm,
          reason: 'piece-too-large',
        });
        continue;
      }
      sheetsAllocated += 1;
      sheets.push(fresh);
      commitPlacement(fresh, piece, freshFit, settings, usableLength, usableWidth);
    }

    for (const piece of groupUnplaced) {
      unplaced.push(piece);
      issues.push({
        level: 'error',
        code: piece.reason,
        partId: piece.partId,
        message: `"${piece.name}" (${piece.partId}) ${UNPLACED_REASON_LABELS[piece.reason].toLowerCase()} — joylashtirilmadi.`,
      });
    }

    if (sheets.length === 0) {
      continue;
    }

    const sheetAreaMm2 = settings.sheetLengthMm * settings.sheetWidthMm;
    const materialSheets: CuttingSheet[] = sheets.map((sheet, index) => ({
      index: index + 1,
      materialId: bucket.materialId,
      materialName: bucket.name,
      thicknessMm: bucket.thicknessMm,
      sheetLengthMm: settings.sheetLengthMm,
      sheetWidthMm: settings.sheetWidthMm,
      ...summarizeSheet(sheet, settings),
    }));

    const usedMm2 = sheets.reduce((sum, sheet) => sum + sheet.usedAreaMm2, 0);
    const kerfMm2 = sheets.reduce((sum, sheet) => sum + sheet.kerfAreaMm2, 0);
    const availableMm2 = sheets.length * sheetAreaMm2;
    const wasteMm2 = availableMm2 - usedMm2 - kerfMm2;
    totalUsedMm2 += usedMm2;
    totalKerfMm2 += kerfMm2;

    groups.push({
      materialId: bucket.materialId,
      name: bucket.name,
      thicknessMm: bucket.thicknessMm,
      sheets: materialSheets,
      pieceCount: sheets.reduce((sum, sheet) => sum + sheet.placements.length, 0),
      usedAreaM2: toM2(usedMm2),
      availableAreaM2: toM2(availableMm2),
      kerfAreaM2: toM2(kerfMm2),
      wasteAreaM2: toM2(wasteMm2),
      wastePercent: percentOf(wasteMm2, availableMm2),
    });
  }

  const sheetAreaMm2 = settings.sheetLengthMm * settings.sheetWidthMm;
  const sheetCount = groups.reduce((sum, group) => sum + group.sheets.length, 0);
  const availableMm2 = sheetCount * sheetAreaMm2;
  // Unrounded totals from the nesting pass, so used + kerf + waste describes the
  // same board area exactly instead of drifting by accumulated rounding.
  const wasteMm2 = Math.max(availableMm2 - totalUsedMm2 - totalKerfMm2, 0);
  const placedCount = groups.reduce((sum, group) => sum + group.pieceCount, 0);
  const unplacedCount = unplaced.reduce((sum, piece) => sum + piece.quantity, 0);

  let status: CuttingPlanStatus = 'ok';
  if (placedCount === 0) {
    status = 'unavailable';
  } else if (unplacedCount > 0) {
    status = 'partial';
  }

  if (status === 'partial') {
    issues.push({
      level: 'warning',
      code: 'partial-placement',
      partId: null,
      message: `${unplacedCount} ta detal joylashtirilmadi — reja qisman.`,
    });
  }
  if (status === 'unavailable') {
    issues.push({
      level: 'error',
      code: 'no-material',
      partId: null,
      message: "Hech bir detal joylashtirilmadi — material yoki o'lcham ma'lumotini tekshiring.",
    });
  }

  return {
    ok: true,
    plan: {
      settings,
      status,
      groups,
      unplaced,
      excluded,
      summary: {
        pieceCount: placedCount + unplacedCount,
        placedCount,
        unplacedCount,
        sheetCount,
        usedAreaM2: toM2(totalUsedMm2),
        availableAreaM2: toM2(availableMm2),
        kerfAreaM2: toM2(totalKerfMm2),
        wasteAreaM2: toM2(wasteMm2),
        wastePercent: percentOf(wasteMm2, availableMm2),
        materialCount: groups.length,
      },
      issues,
      limitations: [...CUTTING_PLAN_LIMITATIONS],
    },
  };
}

/** Convenience: the plan's usable area for one sheet, in m². */
export function usableSheetAreaM2(settings: SheetSettings): number {
  return toM2(
    Math.max(settings.sheetLengthMm - 2 * settings.edgeMarginMm, 0) *
      Math.max(settings.sheetWidthMm - 2 * settings.edgeMarginMm, 0),
  );
}

export { percentOf as cuttingPercentOf };
