/**
 * Standalone cutting-layout SVG.
 *
 * This is a layout diagram, not a technical drawing: every rectangle is a
 * placement from the validated plan. The viewBox uses millimetres and the root
 * declares the physical sheet size, so the printed scale is explicit rather
 * than implied by a pixel count.
 */
import type { CuttingPlan, PlacedPiece } from './cuttingPlan';

const MARGIN = 24;
const TITLE_HEIGHT = 54;
const SHEET_GAP = 26;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function text(
  x: number,
  y: number,
  value: string,
  size: number,
  fill = '#e8edf2',
  anchor: 'start' | 'middle' = 'start',
): string {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" fill="${fill}" text-anchor="${anchor}">${escapeXml(value)}</text>`;
}

function pieceSvg(piece: PlacedPiece, boardX: number, boardTop: number, sheetWidth: number, scale: number, stroke: number): string[] {
  const x = boardX + piece.xMm * scale;
  const y = boardTop + (sheetWidth - piece.yMm - piece.heightMm) * scale;
  const w = piece.widthMm * scale;
  const h = piece.heightMm * scale;
  const lines = [
    `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="${piece.rotated ? '#d9e6f2' : '#e6ded0'}" stroke="#4a463c" stroke-width="${stroke.toFixed(3)}" />`,
  ];
  if (w > 34 && h > 11) {
    lines.push(text(x + 2, y + 9, `${piece.partId} #${piece.instance}`, 5.5, '#2c2a24'));
  }
  return lines;
}

/** Build a deterministic SVG for the current plan, or an explicit "not computed" sheet. */
export function createCuttingPlanSvg(plan: CuttingPlan | null): string {
  if (!plan) {
    const width = 420;
    const height = 110;
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" role="img" aria-label="Kesish rejasi hisoblanmagan">`,
      '<rect width="100%" height="100%" fill="#12161b" />',
      text(MARGIN, 34, 'Kesish rejasi hisoblanmagan', 15),
      text(MARGIN, 56, "List o'lchamlari va material belgilanmagan — joylashtirish yo'q.", 9, '#c08a3e'),
      text(MARGIN, 74, 'Bu fayl haqiqiy kesish koordinatalarini bildirmaydi.', 9, '#8f9aa6'),
      '</svg>',
    ].join('\n');
  }

  const sheets = plan.groups.flatMap((group) => group.sheets.map((sheet) => ({ group, sheet })));
  const maxLength = Math.max(...sheets.map(({ sheet }) => sheet.sheetLengthMm), 1);
  const scale = Math.min(1 / 10, 760 / maxLength);
  const sheetWidths = sheets.map(({ sheet }) => sheet.sheetLengthMm * scale);
  const sheetHeights = sheets.map(({ sheet }) => sheet.sheetWidthMm * scale);
  const contentWidth = Math.max(1, ...sheetWidths);
  const contentHeight = sheetHeights.reduce((sum, height) => sum + 22 + height, 0) + SHEET_GAP * Math.max(sheets.length - 1, 0);
  const width = Math.max(420, contentWidth + MARGIN * 2);
  const height = TITLE_HEIGHT + contentHeight + MARGIN * 2;
  const stroke = Math.max(maxLength / 9000, 0.35);
  const body: string[] = [];
  let cursor = TITLE_HEIGHT + MARGIN;

  body.push(text(MARGIN, 28, 'Kesish rejasi — list joylashuvi', 15));
  body.push(
    text(
      MARGIN,
      44,
      `Holat: ${plan.status} · Listlar: ${plan.summary.sheetCount} · Detallar: ${plan.summary.placedCount}/${plan.summary.pieceCount} · Chiqindi: ${plan.summary.wastePercent}%`,
      9,
      '#aeb9c4',
    ),
  );
  body.push(
    text(
      MARGIN,
      58,
      `Masshtab: 1:${Math.round(1 / scale)} · Koordinatalar mm · O'lchamlar foydalanuvchi kiritgan list o'lchamlari`,
      8.5,
      '#8f9aa6',
    ),
  );

  if (sheets.length === 0) {
    body.push(text(MARGIN, cursor + 18, "Hech bir detal listga joylashmadi — pastdagi cheklovlarni o'qing.", 9, '#c08a3e'));
    body.push(...plan.limitations.slice(0, 4).map((line, index) => text(MARGIN, cursor + 36 + index * 14, `• ${line}`, 7.5, '#8f9aa6')));
  } else {
    for (const { group, sheet } of sheets) {
      body.push(
        text(
          MARGIN,
          cursor + 12,
          `${group.name} ${group.thicknessMm} mm · List ${sheet.index} · ${sheet.sheetLengthMm}×${sheet.sheetWidthMm} mm · chiqindi ${sheet.wastePercent}%`,
          8,
          '#aeb9c4',
        ),
      );
      const boardTop = cursor + 18;
      const boardWidth = sheet.sheetLengthMm * scale;
      const boardHeight = sheet.sheetWidthMm * scale;
      body.push(
        `<rect x="${MARGIN}" y="${boardTop.toFixed(1)}" width="${boardWidth.toFixed(2)}" height="${boardHeight.toFixed(2)}" fill="#f4f1ea" stroke="#8a8578" stroke-width="${stroke.toFixed(3)}" />`,
      );
      for (const piece of sheet.placements) {
        body.push(...pieceSvg(piece, MARGIN, boardTop, sheet.sheetWidthMm, scale, stroke));
      }
      cursor = boardTop + boardHeight + 22;
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(1)}mm" height="${height.toFixed(1)}mm" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}" role="img" aria-label="Kesish rejasi">`,
    '<rect width="100%" height="100%" fill="#12161b" />',
    ...body,
    '</svg>',
  ].join('\n');
}
