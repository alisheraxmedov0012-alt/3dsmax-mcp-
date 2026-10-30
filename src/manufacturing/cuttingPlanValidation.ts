/**
 * Independent checks on a finished cutting plan.
 *
 * This module deliberately does not import the nesting implementation; it only
 * reads the result. A bug in the optimizer therefore cannot make its own output
 * look correct. Coordinates, bounds, kerf gaps, counts, material thickness and
 * area arithmetic are all re-derived here from the plan and the source cut list.
 */
import type { CutListResult } from './cutList';
import type { CuttingPlan, PlacedPiece } from './cuttingPlan';

export type CuttingValidationCode =
  | 'settings-invalid'
  | 'piece-outside-sheet'
  | 'negative-coordinate'
  | 'piece-size-invalid'
  | 'piece-overlap'
  | 'kerf-violation'
  | 'rotation-inconsistent'
  | 'thickness-mismatch'
  | 'count-mismatch'
  | 'area-mismatch'
  | 'summary-mismatch'
  | 'status-inconsistent';

export interface CuttingValidationIssue {
  level: 'error' | 'warning';
  code: CuttingValidationCode;
  message: string;
  sheetIndex?: number;
  partId?: string;
}

export interface CuttingValidationReport {
  ok: boolean;
  issues: CuttingValidationIssue[];
  limitations: string[];
}

export interface CuttingValidationSource {
  cutList?: CutListResult;
}

const EPS = 0.01;
const AREA_EPS = 0.002;

function close(actual: number, expected: number, tolerance = EPS): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function overlaps(a: PlacedPiece, b: PlacedPiece): boolean {
  return (
    Math.min(a.xMm + a.widthMm, b.xMm + b.widthMm) - Math.max(a.xMm, b.xMm) > EPS &&
    Math.min(a.yMm + a.heightMm, b.yMm + b.heightMm) - Math.max(a.yMm, b.yMm) > EPS
  );
}

function gapViolation(a: PlacedPiece, b: PlacedPiece, kerf: number): boolean {
  if (kerf <= 0) return false;
  const overlapX = Math.min(a.xMm + a.widthMm, b.xMm + b.widthMm) - Math.max(a.xMm, b.xMm);
  const overlapY = Math.min(a.yMm + a.heightMm, b.yMm + b.heightMm) - Math.max(a.yMm, b.yMm);
  if (overlapX > EPS) {
    const gapY = Math.max(a.yMm, b.yMm) - Math.min(a.yMm + a.heightMm, b.yMm + b.heightMm);
    if (gapY >= -EPS && gapY < kerf - EPS) return true;
  }
  if (overlapY > EPS) {
    const gapX = Math.max(a.xMm, b.xMm) - Math.min(a.xMm + a.widthMm, b.xMm + b.widthMm);
    if (gapX >= -EPS && gapX < kerf - EPS) return true;
  }
  return false;
}

/**
 * Validate the plan. Any error makes `ok` false; warnings remain visible but do
 * not reject the plan.
 */
export function validateCuttingPlan(
  plan: CuttingPlan,
  source: CuttingValidationSource = {},
): CuttingValidationReport {
  const issues: CuttingValidationIssue[] = [];
  const add = (
    level: 'error' | 'warning',
    code: CuttingValidationCode,
    message: string,
    extra: { sheetIndex?: number; partId?: string } = {},
  ) => issues.push({ level, code, message, ...extra });

  const { settings } = plan;
  const margin = settings.edgeMarginMm;
  const usableLength = settings.sheetLengthMm - 2 * margin;
  const usableWidth = settings.sheetWidthMm - 2 * margin;
  if (
    !Number.isFinite(settings.sheetLengthMm) ||
    !Number.isFinite(settings.sheetWidthMm) ||
    settings.sheetLengthMm <= 0 ||
    settings.sheetWidthMm <= 0 ||
    !Number.isFinite(margin) ||
    margin < 0 ||
    !Number.isFinite(settings.kerfMm) ||
    settings.kerfMm < 0 ||
    usableLength <= 0 ||
    usableWidth <= 0
  ) {
    add('error', 'settings-invalid', "List o'lchamlari yoki kerf/chegara yaroqsiz.");
  }

  const sheetAreaMm2 = settings.sheetLengthMm * settings.sheetWidthMm;
  let placedCount = 0;
  let usedMm2 = 0;
  let kerfMm2 = 0;
  const placedByPart = new Map<string, number>();

  for (const group of plan.groups) {
    if (!(group.thicknessMm > 0)) {
      add('error', 'thickness-mismatch', `"${group.name}" uchun qalinlik musbat emas.`);
    }
    for (const sheet of group.sheets) {
      if (
        sheet.sheetLengthMm !== settings.sheetLengthMm ||
        sheet.sheetWidthMm !== settings.sheetWidthMm
      ) {
        add('error', 'settings-invalid', `List ${sheet.index} o'lchami sozlamalarga mos emas.`, {
          sheetIndex: sheet.index,
        });
      }
      if (!close(sheet.thicknessMm, group.thicknessMm)) {
        add('error', 'thickness-mismatch', `List ${sheet.index} qalinligi guruhga mos emas.`, {
          sheetIndex: sheet.index,
        });
      }

      let sheetUsed = 0;
      for (let i = 0; i < sheet.placements.length; i += 1) {
        const piece = sheet.placements[i];
        placedCount += 1;
        placedByPart.set(piece.partId, (placedByPart.get(piece.partId) ?? 0) + 1);
        if (
          !Number.isFinite(piece.xMm) ||
          !Number.isFinite(piece.yMm) ||
          !Number.isFinite(piece.widthMm) ||
          !Number.isFinite(piece.heightMm) ||
          piece.widthMm <= 0 ||
          piece.heightMm <= 0
        ) {
          add('error', 'piece-size-invalid', `"${piece.partId}" o'lchami yoki koordinatasi yaroqsiz.`, {
            sheetIndex: sheet.index,
            partId: piece.partId,
          });
          continue;
        }
        if (piece.xMm < 0 || piece.yMm < 0) {
          add('error', 'negative-coordinate', `"${piece.partId}" manfiy koordinatada.`, {
            sheetIndex: sheet.index,
            partId: piece.partId,
          });
        }
        if (
          piece.xMm < margin - EPS ||
          piece.yMm < margin - EPS ||
          piece.xMm + piece.widthMm > settings.sheetLengthMm - margin + EPS ||
          piece.yMm + piece.heightMm > settings.sheetWidthMm - margin + EPS
        ) {
          add('error', 'piece-outside-sheet', `"${piece.partId}" list chegarasidan chiqqan.`, {
            sheetIndex: sheet.index,
            partId: piece.partId,
          });
        }
        if (
          (piece.rotated &&
            (!close(piece.widthMm, piece.sourceHeightMm) ||
              !close(piece.heightMm, piece.sourceWidthMm))) ||
          (!piece.rotated &&
            (!close(piece.widthMm, piece.sourceWidthMm) ||
              !close(piece.heightMm, piece.sourceHeightMm)))
        ) {
          add('error', 'rotation-inconsistent', `"${piece.partId}" aylantirish bayrog'i o'lchamga mos emas.`, {
            sheetIndex: sheet.index,
            partId: piece.partId,
          });
        }
        sheetUsed += piece.widthMm * piece.heightMm;
      }

      for (let i = 0; i < sheet.placements.length; i += 1) {
        for (let j = i + 1; j < sheet.placements.length; j += 1) {
          const a = sheet.placements[i];
          const b = sheet.placements[j];
          if (overlaps(a, b)) {
            add('error', 'piece-overlap', `"${a.partId}" va "${b.partId}" ustma-ust tushgan.`, {
              sheetIndex: sheet.index,
            });
          } else if (gapViolation(a, b, settings.kerfMm)) {
            add('error', 'kerf-violation', `"${a.partId}" va "${b.partId}" orasida kerf yetarli emas.`, {
              sheetIndex: sheet.index,
            });
          }
        }
      }

      const expectedUsed = sheetUsed / 1_000_000;
      if (!close(sheet.usedAreaM2, expectedUsed, AREA_EPS)) {
        add('error', 'area-mismatch', `List ${sheet.index} ishlatilgan yuza noto'g'ri.`, {
          sheetIndex: sheet.index,
        });
      }
      const expectedWaste = sheetAreaMm2 / 1_000_000 - expectedUsed - sheet.kerfAreaM2;
      if (sheet.kerfAreaM2 < -AREA_EPS || !close(sheet.wasteAreaM2, expectedWaste, AREA_EPS)) {
        add('error', 'area-mismatch', `List ${sheet.index} chiqindi/kerf yuzasi mos emas.`, {
          sheetIndex: sheet.index,
        });
      }
      if (sheet.wastePercent < 0 || sheet.wastePercent > 100) {
        add('error', 'area-mismatch', `List ${sheet.index} chiqindi foizi 0–100 dan tashqarida.`, {
          sheetIndex: sheet.index,
        });
      }
      usedMm2 += sheetUsed;
      kerfMm2 += sheet.kerfAreaM2 * 1_000_000;
    }
  }

  const unplacedCount = plan.unplaced.reduce((sum, item) => sum + item.quantity, 0);
  if (placedCount !== plan.summary.placedCount) {
    add('error', 'count-mismatch', 'Joylashtirilgan detallar soni summary bilan mos emas.');
  }
  if (unplacedCount !== plan.summary.unplacedCount) {
    add('error', 'count-mismatch', 'Joylashtirilmagan detallar soni summary bilan mos emas.');
  }
  if (plan.summary.pieceCount !== placedCount + unplacedCount) {
    add('error', 'count-mismatch', 'Umumiy detal soni summary bilan mos emas.');
  }
  const expectedStatus = placedCount === 0 ? 'unavailable' : unplacedCount > 0 ? 'partial' : 'ok';
  if (plan.status !== expectedStatus) {
    add('error', 'status-inconsistent', `Plan holati ${plan.status}, kutilgan ${expectedStatus}.`);
  }

  if (!close(plan.summary.usedAreaM2, usedMm2 / 1_000_000, AREA_EPS)) {
    add('error', 'area-mismatch', "Umumiy ishlatilgan yuza summary bilan mos emas.");
  }
  if (!close(plan.summary.kerfAreaM2, kerfMm2 / 1_000_000, AREA_EPS)) {
    add('error', 'area-mismatch', "Umumiy kerf yuzasi summary bilan mos emas.");
  }
  if (
    plan.summary.availableAreaM2 < 0 ||
    plan.summary.wasteAreaM2 < 0 ||
    plan.summary.wastePercent < 0 ||
    plan.summary.wastePercent > 100
  ) {
    add('error', 'area-mismatch', "Umumiy maydon yoki chiqindi foizi yaroqsiz.");
  }
  if (
    !close(
      plan.summary.usedAreaM2 + plan.summary.kerfAreaM2 + plan.summary.wasteAreaM2,
      plan.summary.availableAreaM2,
      AREA_EPS,
    )
  ) {
    add('error', 'area-mismatch', 'Used + kerf + waste mavjud yuzaga teng emas.');
  }

  if (source.cutList) {
    const requested = new Map<string, { quantity: number; thickness: number | null }>();
    for (const row of source.cutList.rows) {
      requested.set(row.partId, {
        quantity: row.quantity,
        thickness: row.material?.thicknessMm ?? null,
      });
    }
    const unplacedByPart = new Map<string, number>();
    for (const piece of plan.unplaced) {
      unplacedByPart.set(piece.partId, (unplacedByPart.get(piece.partId) ?? 0) + piece.quantity);
    }
    for (const [partId, expected] of requested) {
      const placed = placedByPart.get(partId) ?? 0;
      const unplaced = unplacedByPart.get(partId) ?? 0;
      if (placed + unplaced !== expected.quantity) {
        add(
          'error',
          'count-mismatch',
          `"${partId}" uchun ${placed} joylashtirilgan + ${unplaced} joylashtirilmagan = ${expected.quantity} emas.`,
          { partId },
        );
      }
      if (placed > 0 && expected.thickness !== null) {
        const group = plan.groups.find((entry) =>
          entry.sheets.some((sheet) => sheet.placements.some((piece) => piece.partId === partId)),
        );
        if (group && !close(group.thicknessMm, expected.thickness)) {
          add(
            'error',
            'thickness-mismatch',
            `"${partId}" nominal qalinligi guruh qalinligiga mos emas.`,
            { partId },
          );
        }
      }
      if (placed === 0 && unplaced === 0) {
        add('error', 'count-mismatch', `"${partId}" hisobga olinmagan.`, { partId });
      }
    }
  }

  return {
    ok: !issues.some((issue) => issue.level === 'error'),
    issues,
    limitations: [
      "Validator faqat plan ma'lumotlarini tekshiradi; arra tartibi va fizik kesim sinalmaydi.",
      "Don yo'nalishi va qirra qoplamasi modelda yo'q — ular tekshirilmagan.",
      'Bu hisobot ishlab chiqarish sertifikati emas.',
    ],
  };
}
