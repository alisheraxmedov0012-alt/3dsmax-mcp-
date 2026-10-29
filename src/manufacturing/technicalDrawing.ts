/**
 * Technical drawing (SVG): front, side and top orthographic views of ONE piece.
 *
 * Every rectangle and every dimension is derived from the real mesh geometry —
 * the views are the projected bounding boxes of the actual parts, and the
 * dimensions are measured from those boxes. Nothing is redrawn by hand and no
 * value is invented.
 *
 * Layout follows standard orthographic practice: the side view sits to the right
 * of the front view sharing its height, and the top view sits below the front view
 * sharing its width, so a feature at one edge lines up across views. All views use
 * one scale, so their proportions are comparable.
 *
 * Coordinate convention (local): x = width, y = height, z = depth. Dimensions are
 * reported in millimetres although the scene stores centimetres; the drawing
 * scale changes only how many pixels a millimetre occupies, never the dimension
 * text.
 *
 * Scope, stated plainly: overall dimensions are exact (measured), part outlines
 * are schematic and may overlap, and there are no tolerances, joint details,
 * hidden lines, material data or manufacturing standards. It is a preliminary
 * drawing — a correct draft is not a statement that the piece is ready to build.
 */
import { buildFurniture } from '../geometry/furniture/buildFurniture';
import { validateFurnitureParams } from '../geometry/furniture/params';
import {
  FURNITURE_TYPE_LABELS,
  type FurnitureParams,
  type FurnitureType,
} from '../geometry/furniture/types';
import { convertLength, roundLength } from './units';
import { envelopeMm, measurePartBoxes, type PartBox } from './partBoxes';
import { PART_KIND_LABELS, partKindFromId } from './parts';

// Re-exported so existing consumers (`validation.ts`, tests) keep one import
// path; the implementation now lives in `partBoxes.ts` because the parameters
// panel needs the same measurement without pulling in the SVG generator.
export { measurePartBoxes, type PartBox } from './partBoxes';

export type DrawingView = 'front' | 'side' | 'top';

export const DRAWING_VIEW_LABELS: Record<DrawingView, string> = {
  front: 'Old korinish',
  side: 'Yon korinish',
  top: 'Yuqoridan korinish',
};

export interface TechnicalDrawingOptions {
  /** Title shown in the title block (model/project name). */
  title?: string;
  /** Include the per-part outline rectangles (default true). */
  includePartOutlines?: boolean;
  /** Optional date string for the title block (kept out of pure output otherwise). */
  date?: string;
}

/** Where one view sits on the sheet, and how big the piece is in that view. */
export interface DrawingViewLayout {
  x: number;
  y: number;
  widthPx: number;
  heightPx: number;
  widthMm: number;
  heightMm: number;
}

export interface DrawingScale {
  /** Pixels per real millimetre. */
  pxPerMm: number;
  /** Human-readable ratio, e.g. `1:5`. */
  ratio: string;
  /** True when the ratio is one of the standard drawing scales. */
  standard: boolean;
}

export interface DrawingLayout {
  widthPx: number;
  heightPx: number;
  views: Record<DrawingView, DrawingViewLayout>;
}

export type TechnicalDrawingResult =
  | {
      ok: true;
      svg: string;
      overall: { widthMm: number; heightMm: number; depthMm: number };
      scale: DrawingScale;
      layout: DrawingLayout;
    }
  | { ok: false; reason: string };

/** Sheet margins. The left margin also holds the front view's height dimension. */
const MARGIN_LEFT = 84;
const MARGIN_RIGHT = 74;
const MARGIN_TOP = 56;
/** Space under a view for its dimension, label and size line. */
const BELOW_VIEW = 88;
/** Horizontal gap between the front and side views. */
const GAP_X = 76;
/** Vertical gap between the front and top views. */
const GAP_Y = 40;
const TITLE_H = 130;

/** Distance from a view edge to its dimension line. */
const DIM_OFFSET = 28;
/** Dimension text sits this far past its line, on the side away from the part. */
const DIM_TEXT_GAP = 15;
/** View label and size line, measured from the bottom of the frame. */
const LABEL_OFFSET = 60;
const SIZE_OFFSET = 76;
const ARROW_LEN = 7;
const ARROW_HALF = 2.6;

const STROKE_FRAME = '#2a2f36';
const STROKE_PART = '#6f7b88';
const STROKE_DIM = '#8f9aa6';
const FILL_DIM_TEXT = '#c8d2dc';

/**
 * Standard drawing scales, as the denominator of `1:n`.
 *
 * Snapping to these keeps the sheet legible and the ratio conventional; the
 * dimension text stays the true millimetre value, so the ratio never leaks into
 * a measurement.
 */
const STANDARD_SCALE_DENOMINATORS = [1, 2, 5, 10, 20, 50, 100] as const;

const MAX_SHEET_WIDTH = 1180;
const MAX_SHEET_HEIGHT = 760;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface Span {
  h0: number;
  h1: number;
  v0: number;
  v1: number;
}

/** Project a box onto a view: horizontal/vertical axes in cm. */
function project(box: PartBox, view: DrawingView): Span {
  if (view === 'front') {
    return { h0: box.minX, h1: box.maxX, v0: box.minY, v1: box.maxY };
  }
  if (view === 'side') {
    return { h0: box.minZ, h1: box.maxZ, v0: box.minY, v1: box.maxY };
  }
  return { h0: box.minX, h1: box.maxX, v0: box.minZ, v1: box.maxZ };
}

interface ViewBounds {
  hMin: number;
  hMax: number;
  vMin: number;
  vMax: number;
}

function boundsFor(boxes: PartBox[], view: DrawingView): ViewBounds {
  let hMin = Infinity;
  let hMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const box of boxes) {
    const span = project(box, view);
    hMin = Math.min(hMin, span.h0);
    hMax = Math.max(hMax, span.h1);
    vMin = Math.min(vMin, span.v0);
    vMax = Math.max(vMax, span.v1);
  }
  if (![hMin, hMax, vMin, vMax].every((v) => Number.isFinite(v))) {
    return { hMin: 0, hMax: 1, vMin: 0, vMax: 1 };
  }
  return { hMin, hMax, vMin, vMax };
}

/** Extent of a view in real millimetres (never below 1 mm, so nothing is degenerate). */
function extentMm(bounds: ViewBounds): { widthMm: number; heightMm: number } {
  return {
    widthMm: Math.max(convertLength(bounds.hMax - bounds.hMin, 'cm', 'mm'), 1),
    heightMm: Math.max(convertLength(bounds.vMax - bounds.vMin, 'cm', 'mm'), 1),
  };
}

/**
 * Pick one scale for all views: the largest standard scale that still fits the
 * three views side by side and stacked.
 *
 * Exported as a pure function of the measured extents so the fallback path — a
 * piece too large for even 1:100 — is reachable and testable without needing
 * furniture parameters that the validator would reject.
 */
export function chooseDrawingScale(
  frontWidthMm: number,
  frontHeightMm: number,
  sideWidthMm: number,
  topHeightMm: number,
): DrawingScale {
  const availableWidth = MAX_SHEET_WIDTH - MARGIN_LEFT - MARGIN_RIGHT - GAP_X;
  const availableHeight = MAX_SHEET_HEIGHT - MARGIN_TOP - BELOW_VIEW - GAP_Y - TITLE_H;

  const fit = Math.min(
    availableWidth / Math.max(frontWidthMm + sideWidthMm, 1),
    availableHeight / Math.max(frontHeightMm + topHeightMm, 1),
  );

  const candidates = STANDARD_SCALE_DENOMINATORS.map((n) => 1 / n).filter((s) => s <= fit);
  if (candidates.length > 0) {
    const pxPerMm = Math.max(...candidates);
    return { pxPerMm, ratio: `1:${Math.round(1 / pxPerMm)}`, standard: true };
  }

  // Beyond 1:100: report the true ratio rather than claiming a standard scale.
  const pxPerMm = Math.max(fit, 0.001);
  return { pxPerMm, ratio: `1:${Math.round((1 / pxPerMm) * 10) / 10}`, standard: false };
}

function arrow(xTip: number, yTip: number, dx: number, dy: number): string {
  // dx/dy point from the tip back toward the body of the dimension line.
  const bx = xTip + dx * ARROW_LEN;
  const by = yTip + dy * ARROW_LEN;
  const nx = -dy;
  const ny = dx;
  const p1 = `${(bx + nx * ARROW_HALF).toFixed(1)},${(by + ny * ARROW_HALF).toFixed(1)}`;
  const p2 = `${(bx - nx * ARROW_HALF).toFixed(1)},${(by - ny * ARROW_HALF).toFixed(1)}`;
  return `<polygon points="${xTip.toFixed(1)},${yTip.toFixed(1)} ${p1} ${p2}" fill="${STROKE_DIM}" />`;
}

function dimText(x: number, y: number, label: string, rotate = false): string {
  const transform = rotate ? ` transform="rotate(-90 ${x.toFixed(1)} ${y.toFixed(1)})"` : '';
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}"${transform} text-anchor="middle" font-size="11" fill="${FILL_DIM_TEXT}">${escapeXml(label)}</text>`;
}

/**
 * A horizontal dimension drawn below the geometry between `xFrom` and `xTo`.
 * Witness lines start at `edgeY` — the geometry edge — so the reader can see
 * exactly which extent is being measured.
 */
function horizontalDimension(
  xFrom: number,
  xTo: number,
  edgeY: number,
  lineY: number,
  label: string,
): string[] {
  const lo = Math.min(xFrom, xTo);
  const hi = Math.max(xFrom, xTo);
  const below = lineY >= edgeY;
  const witnessEnd = lineY + (below ? 5 : -5);
  return [
    `<line x1="${lo.toFixed(1)}" y1="${edgeY.toFixed(1)}" x2="${lo.toFixed(1)}" y2="${witnessEnd.toFixed(1)}" stroke="${STROKE_DIM}" stroke-width="0.8" stroke-dasharray="3 3" />`,
    `<line x1="${hi.toFixed(1)}" y1="${edgeY.toFixed(1)}" x2="${hi.toFixed(1)}" y2="${witnessEnd.toFixed(1)}" stroke="${STROKE_DIM}" stroke-width="0.8" stroke-dasharray="3 3" />`,
    `<line x1="${lo.toFixed(1)}" y1="${lineY.toFixed(1)}" x2="${hi.toFixed(1)}" y2="${lineY.toFixed(1)}" stroke="${STROKE_DIM}" stroke-width="1" />`,
    arrow(lo, lineY, 1, 0),
    arrow(hi, lineY, -1, 0),
    // Text sits on the opposite side of the line from the geometry, so it never
    // lands on top of the part outlines.
    dimText((lo + hi) / 2, below ? lineY + DIM_TEXT_GAP : lineY - 6, label),
  ];
}

/** Vertical dimension drawn to the left of the geometry. */
function verticalDimension(
  yFrom: number,
  yTo: number,
  edgeX: number,
  lineX: number,
  label: string,
): string[] {
  const lo = Math.min(yFrom, yTo);
  const hi = Math.max(yFrom, yTo);
  const toRight = lineX >= edgeX;
  const witnessEnd = lineX + (toRight ? 5 : -5);
  return [
    `<line x1="${edgeX.toFixed(1)}" y1="${lo.toFixed(1)}" x2="${witnessEnd.toFixed(1)}" y2="${lo.toFixed(1)}" stroke="${STROKE_DIM}" stroke-width="0.8" stroke-dasharray="3 3" />`,
    `<line x1="${edgeX.toFixed(1)}" y1="${hi.toFixed(1)}" x2="${witnessEnd.toFixed(1)}" y2="${hi.toFixed(1)}" stroke="${STROKE_DIM}" stroke-width="0.8" stroke-dasharray="3 3" />`,
    `<line x1="${lineX.toFixed(1)}" y1="${lo.toFixed(1)}" x2="${lineX.toFixed(1)}" y2="${hi.toFixed(1)}" stroke="${STROKE_DIM}" stroke-width="1" />`,
    arrow(lineX, lo, 0, 1),
    arrow(lineX, hi, 0, -1),
    dimText(toRight ? lineX + DIM_TEXT_GAP : lineX - 8, (lo + hi) / 2, label, true),
  ];
}

function formatMm(value: number): string {
  return `${roundLength(value, 'mm')} mm`;
}

function renderView(
  boxes: PartBox[],
  view: DrawingView,
  layout: DrawingViewLayout,
  pxPerMm: number,
  includePartOutlines: boolean,
): string[] {
  const b = boundsFor(boxes, view);
  const parts: string[] = [];

  // cm -> px through one factor, so every view uses the same scale.
  const toX = (h: number) => layout.x + convertLength(h - b.hMin, 'cm', 'mm') * pxPerMm;
  const toY = (v: number) => layout.y + convertLength(b.vMax - v, 'cm', 'mm') * pxPerMm;

  parts.push(
    `<rect x="${layout.x.toFixed(1)}" y="${layout.y.toFixed(1)}" width="${layout.widthPx.toFixed(1)}" height="${layout.heightPx.toFixed(1)}" fill="none" stroke="${STROKE_FRAME}" stroke-width="1" />`,
  );

  if (includePartOutlines) {
    for (const box of boxes) {
      const span = project(box, view);
      const x = toX(span.h0);
      const y = toY(span.v1);
      const w = Math.max(toX(span.h1) - x, 0.5);
      const h = Math.max(toY(span.v0) - y, 0.5);
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="none" stroke="${STROKE_PART}" stroke-width="1" />`,
      );
    }
  }

  const right = layout.x + layout.widthPx;
  const bottom = layout.y + layout.heightPx;

  // Dimensions live outside the frame. Each overall extent is dimensioned once,
  // where it reads most naturally, which keeps the sheet uncluttered.
  if (view === 'front') {
    parts.push(
      ...horizontalDimension(
        layout.x,
        right,
        bottom,
        bottom + DIM_OFFSET,
        formatMm(layout.widthMm),
      ),
    );
    parts.push(
      ...verticalDimension(
        layout.y,
        bottom,
        layout.x,
        layout.x - DIM_OFFSET,
        formatMm(layout.heightMm),
      ),
    );
  } else if (view === 'side') {
    parts.push(
      ...horizontalDimension(
        layout.x,
        right,
        bottom,
        bottom + DIM_OFFSET,
        formatMm(layout.widthMm),
      ),
    );
  } else {
    parts.push(
      ...verticalDimension(
        layout.y,
        bottom,
        right,
        right + DIM_OFFSET,
        formatMm(layout.heightMm),
      ),
    );
  }

  const centreX = (layout.x + layout.widthPx / 2).toFixed(1);
  parts.push(
    `<text x="${centreX}" y="${(bottom + LABEL_OFFSET).toFixed(1)}" text-anchor="middle" font-size="12" fill="#aeb9c4">${escapeXml(DRAWING_VIEW_LABELS[view])}</text>`,
  );
  parts.push(
    `<text x="${centreX}" y="${(bottom + SIZE_OFFSET).toFixed(1)}" text-anchor="middle" font-size="11" fill="#8f9aa6">${formatMm(layout.widthMm)} x ${formatMm(layout.heightMm)}</text>`,
  );

  return parts;
}

/**
 * Build a dimensioned technical drawing for one furniture piece.
 * Invalid or unmeasurable input is rejected with a clear reason.
 */
export function createTechnicalDrawingSvg(
  type: FurnitureType,
  params: FurnitureParams,
  options: TechnicalDrawingOptions = {},
): TechnicalDrawingResult {
  const validated = validateFurnitureParams(type, params);
  if (!validated) {
    return { ok: false, reason: "Chizma uchun mebel parametrlari noto'g'ri yoki yetishmayapti." };
  }

  const built = buildFurniture(type, validated);
  let boxes: PartBox[];
  try {
    boxes = measurePartBoxes(built.group);
  } finally {
    built.dispose();
  }
  if (boxes.length === 0) {
    return { ok: false, reason: 'Modelda chizish uchun geometriya topilmadi.' };
  }

  const frontBounds = boundsFor(boxes, 'front');
  const sideBounds = boundsFor(boxes, 'side');
  const topBounds = boundsFor(boxes, 'top');
  const front = extentMm(frontBounds);
  const side = extentMm(sideBounds);
  const top = extentMm(topBounds);

  const scale = chooseDrawingScale(front.widthMm, front.heightMm, side.widthMm, top.heightMm);
  const { pxPerMm } = scale;

  const fw = front.widthMm * pxPerMm;
  const fh = front.heightMm * pxPerMm;
  // The side view shares the front view's height and the top view shares its
  // width, which is what makes features line up across views.
  const sw = side.widthMm * pxPerMm;
  const th = top.heightMm * pxPerMm;

  const views: Record<DrawingView, DrawingViewLayout> = {
    front: {
      x: MARGIN_LEFT,
      y: MARGIN_TOP,
      widthPx: fw,
      heightPx: fh,
      widthMm: front.widthMm,
      heightMm: front.heightMm,
    },
    side: {
      x: MARGIN_LEFT + fw + GAP_X,
      y: MARGIN_TOP,
      widthPx: sw,
      heightPx: fh,
      widthMm: side.widthMm,
      heightMm: front.heightMm,
    },
    top: {
      x: MARGIN_LEFT,
      y: MARGIN_TOP + fh + GAP_Y,
      widthPx: fw,
      heightPx: th,
      widthMm: front.widthMm,
      heightMm: top.heightMm,
    },
  };

  const canvasWidth = Math.max(MARGIN_LEFT + fw + GAP_X + sw + MARGIN_RIGHT, 420);
  const canvasHeight = MARGIN_TOP + fh + GAP_Y + th + BELOW_VIEW + TITLE_H;

  const body: string[] = [];
  for (const view of ['front', 'side', 'top'] as const) {
    body.push(
      ...renderView(boxes, view, views[view], pxPerMm, options.includePartOutlines !== false),
    );
  }

  // One source of truth for the overall size: the same union-of-boxes envelope
  // the parameters panel shows, so the drawing header and the panel can never
  // quote different numbers.
  const envelope = envelopeMm(boxes) ?? {
    widthMm: roundLength(convertLength(frontBounds.hMax - frontBounds.hMin, 'cm', 'mm'), 'mm'),
    heightMm: roundLength(convertLength(frontBounds.vMax - frontBounds.vMin, 'cm', 'mm'), 'mm'),
    depthMm: roundLength(convertLength(sideBounds.hMax - sideBounds.hMin, 'cm', 'mm'), 'mm'),
  };
  const overallWidthMm = envelope.widthMm;
  const overallHeightMm = envelope.heightMm;
  const overallDepthMm = envelope.depthMm;

  const title =
    options.title && options.title.trim() !== '' ? options.title : FURNITURE_TYPE_LABELS[type];
  let cursor = MARGIN_TOP + fh + GAP_Y + th + BELOW_VIEW + 22;
  const lines: string[] = [];
  const addLine = (text: string, size: number, fill: string, step: number) => {
    lines.push(
      `<text x="${MARGIN_LEFT}" y="${cursor.toFixed(1)}" font-size="${size}" fill="${fill}">${escapeXml(text)}</text>`,
    );
    cursor += step;
  };
  // The title block spans the sheet. A long note used to run past the right edge
  // (and out of the viewBox) on the default dresser drawing, so wrap at a
  // conservative character budget derived from the available width.
  const maxCharsFor = (size: number): number =>
    Math.max(20, Math.floor((canvasWidth - MARGIN_LEFT - MARGIN_RIGHT) / (size * 0.6)));
  const wrapText = (text: string, maxChars: number): string[] => {
    const words = text.split(/\s+/);
    const wrapped: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current === '' ? word : `${current} ${word}`;
      if (candidate.length <= maxChars || current === '') {
        current = candidate;
      } else {
        wrapped.push(current);
        current = word;
      }
    }
    if (current !== '') {
      wrapped.push(current);
    }
    return wrapped;
  };
  const addWrappedLine = (text: string, size: number, fill: string, step: number) => {
    for (const line of wrapText(text, maxCharsFor(size))) {
      addLine(line, size, fill, step);
    }
  };

  addWrappedLine(title, 15, '#e8edf2', 20);
  addWrappedLine(`Turi: ${FURNITURE_TYPE_LABELS[type]} · Birlik: mm`, 11, '#aeb9c4', 16);
  if (options.date) {
    addWrappedLine(`Sana: ${options.date}`, 11, '#8f9aa6', 16);
  }
  addWrappedLine(`Masshtab: ${scale.ratio} · O'lchamlar haqiqiy (mm)`, 11, '#aeb9c4', 18);
  addWrappedLine(
    `Umumiy: W ${overallWidthMm} x H ${overallHeightMm} x D ${overallDepthMm} mm (geometriyadan olchandi)`,
    11,
    '#8f9aa6',
    18,
  );
  const partCounts = new Map<string, number>();
  for (const box of boxes) {
    const baseId = box.partId.replace(/-\d+$/, '');
    const label = PART_KIND_LABELS[partKindFromId(type, baseId)] ?? baseId;
    partCounts.set(label, (partCounts.get(label) ?? 0) + 1);
  }
  const partLegend = [...partCounts.entries()]
    .map(([label, count]) => `${label} ×${count}`)
    .join(', ');
  addWrappedLine(`Detallar: ${partLegend}`, 10, '#aeb9c4', 16);
  addWrappedLine(
    'Dastlabki chizma: toleranslar, birlashma detallari va ishlab chiqarish standartlari tekshirilmagan.',
    10,
    '#c08a3e',
    16,
  );

  const sheetWidth = Math.round(canvasWidth);
  const sheetHeight = Math.round(Math.max(canvasHeight, cursor + 8));

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWidth}" height="${sheetHeight}" viewBox="0 0 ${sheetWidth} ${sheetHeight}" role="img" aria-label="Texnik chizma">`,
    `<rect x="0" y="0" width="${sheetWidth}" height="${sheetHeight}" fill="#12161b" />`,
    body.join('\n'),
    lines.join('\n'),
    '</svg>',
  ].join('\n');

  return {
    ok: true,
    svg,
    overall: { widthMm: overallWidthMm, heightMm: overallHeightMm, depthMm: overallDepthMm },
    scale,
    layout: {
      widthPx: sheetWidth,
      heightPx: sheetHeight,
      views,
    },
  };
}
