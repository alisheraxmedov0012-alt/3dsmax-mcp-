/**
 * C5 — draw the existing C2 technical drawing into a PDF page.
 *
 * This is deliberately *not* a general SVG renderer. It understands exactly the
 * element set `manufacturing/technicalDrawing.ts` emits (`rect`, `line`,
 * `polygon`, `text` with the attributes that generator writes), because reusing
 * that drawing is the point of C5 and a second drawing engine would be a second
 * source of truth. Anything outside that subset is reported in `skipped` rather
 * than guessed at.
 *
 * Coordinates: SVG is top-left origin with y down, PDF is bottom-left with y up.
 * The conversion happens once, inside {@link renderDrawing}, so no element can
 * drift relative to another.
 */
import type { PDFPage, PDFFont, RGB } from 'pdf-lib';
import { degrees, rgb } from 'pdf-lib';

export interface SvgText {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  /** Font size in SVG units. */
  size: number;
  anchor: 'start' | 'middle' | 'end';
  /** True when the generator rotated the label by -90° (vertical dimensions). */
  rotated: boolean;
  color: RGB;
}

export interface SvgShape {
  kind: 'rect' | 'line' | 'polygon';
  /** Corners in SVG space; a rect becomes its four corners. */
  points: Array<{ x: number; y: number }>;
  stroke: RGB | null;
  fill: RGB | null;
  strokeWidth: number;
  /** Dash pattern in SVG units, or null for a solid stroke. */
  dash: number[] | null;
}

export type SvgElement = SvgShape | SvgText;

export interface ParsedDrawing {
  width: number;
  height: number;
  elements: SvgElement[];
  /** Elements that were recognised but could not be rendered. */
  skipped: string[];
}

const HEX = /^#([0-9a-fA-F]{6})$/;

/** Parse `#rrggbb` (the only colour form the generator emits). */
export function parseHexColor(value: string | undefined): RGB | null {
  if (!value || !HEX.test(value)) {
    return null;
  }
  const hex = value.slice(1);
  return rgb(
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  );
}

function attributes(body: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const match of body.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
    map[match[1]] = match[2];
  }
  return map;
}

function num(value: string | undefined, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function shapeFrom(tag: string, attrs: Record<string, string>): SvgElement | null {
  if (tag === 'rect') {
    const x = num(attrs.x);
    const y = num(attrs.y);
    const w = num(attrs.width);
    const h = num(attrs.height);
    return {
      kind: 'rect',
      points: [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
      stroke: parseHexColor(attrs.stroke),
      fill: parseHexColor(attrs.fill),
      strokeWidth: num(attrs['stroke-width'], 1),
      dash: null,
    };
  }

  if (tag === 'line') {
    return {
      kind: 'line',
      points: [
        { x: num(attrs.x1), y: num(attrs.y1) },
        { x: num(attrs.x2), y: num(attrs.y2) },
      ],
      stroke: parseHexColor(attrs.stroke),
      fill: null,
      strokeWidth: num(attrs['stroke-width'], 1),
      dash: attrs['stroke-dasharray']
        ? attrs['stroke-dasharray'].split(/[\s,]+/).map((part) => num(part))
        : null,
    };
  }

  if (tag === 'polygon') {
    const points = (attrs.points ?? '')
      .trim()
      .split(/\s+/)
      .map((pair) => pair.split(','))
      .filter((pair) => pair.length === 2)
      .map(([x, y]) => ({ x: num(x), y: num(y) }));
    if (points.length < 3) {
      return null;
    }
    return {
      kind: 'polygon',
      points,
      stroke: parseHexColor(attrs.stroke),
      fill: parseHexColor(attrs.fill),
      strokeWidth: num(attrs['stroke-width'], 1),
      dash: null,
    };
  }

  return null;
}

/**
 * Parse the technical drawing SVG.
 *
 * Returns null only when the input is not an SVG at all or has no usable size —
 * the caller turns that into a user-facing error rather than an empty page.
 */
export function parseDrawingSvg(svg: string): ParsedDrawing | null {
  const root = /<svg\b([^>]*)>/.exec(svg);
  if (!root) {
    return null;
  }
  const rootAttrs = attributes(root[1]);
  const width = num(rootAttrs.width);
  const height = num(rootAttrs.height);
  if (!(width > 0) || !(height > 0)) {
    return null;
  }

  const elements: SvgElement[] = [];
  const skipped: string[] = [];

  // Text first: its content sits between the tags, so it needs its own pattern.
  const textBlocks = [...svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)];
  for (const block of textBlocks) {
    const attrs = attributes(block[1]);
    const anchorRaw = attrs['text-anchor'];
    elements.push({
      kind: 'text',
      x: num(attrs.x),
      y: num(attrs.y),
      text: unescapeXml(block[2]),
      size: num(attrs['font-size'], 10),
      anchor: anchorRaw === 'middle' || anchorRaw === 'end' ? anchorRaw : 'start',
      rotated: (attrs.transform ?? '').includes('rotate(-90'),
      color: parseHexColor(attrs.fill) ?? rgb(0, 0, 0),
    });
  }

  // Shapes: no nested content, so a simple tag scan is enough.
  for (const match of svg.matchAll(/<(rect|line|polygon)\b([^>]*?)\/?>/g)) {
    const shape = shapeFrom(match[1], attributes(match[2]));
    if (shape) {
      elements.push(shape);
    } else {
      skipped.push(`${match[1]} could not be read`);
    }
  }

  return { width, height, elements, skipped };
}

export interface FitBox {
  /** Left edge on the page, in points. */
  x: number;
  /** Bottom edge on the page, in points. */
  y: number;
  width: number;
  height: number;
  /** The single factor applied to both axes. */
  scale: number;
}

/**
 * Fit a drawing into a page box without distortion.
 *
 * One factor for both axes: a stretched drawing is a drawing whose proportions
 * lie about the piece, so the scale is the smaller of the two fits and the result
 * is centred in the box.
 */
export function fitBox(
  drawing: { width: number; height: number },
  box: { x: number; y: number; width: number; height: number },
): FitBox {
  const scale = Math.min(box.width / drawing.width, box.height / drawing.height);
  const drawnWidth = drawing.width * scale;
  const drawnHeight = drawing.height * scale;
  return {
    x: box.x + (box.width - drawnWidth) / 2,
    y: box.y + (box.height - drawnHeight) / 2,
    width: drawnWidth,
    height: drawnHeight,
    scale,
  };
}

/**
 * Where to place a text baseline, given the SVG anchor and rotation.
 *
 * Kept pure so the arithmetic is directly testable. A rotated dimension label
 * reads bottom-to-top in the SVG; with y flipped that is a +90° PDF rotation.
 */
export function textPlacement(
  text: { x: number; y: number; anchor: SvgText['anchor']; rotated: boolean },
  widthAtSize: number,
  toPdf: (point: { x: number; y: number }) => { x: number; y: number },
): { x: number; y: number; rotateDeg: number } {
  const base = toPdf({ x: text.x, y: text.y });
  if (!text.rotated) {
    const shift =
      text.anchor === 'middle' ? widthAtSize / 2 : text.anchor === 'end' ? widthAtSize : 0;
    return { x: base.x - shift, y: base.y, rotateDeg: 0 };
  }
  // Rotated text advances upward from its origin, so centring means starting
  // half a width lower.
  const shift = text.anchor === 'middle' ? widthAtSize / 2 : text.anchor === 'end' ? widthAtSize : 0;
  return { x: base.x, y: base.y - shift, rotateDeg: 90 };
}

/** Split a straight segment into dashed pieces (pdf-lib has no dash option). */
export function dashSegment(
  from: { x: number; y: number },
  to: { x: number; y: number },
  pattern: number[],
): Array<{ start: { x: number; y: number }; end: { x: number; y: number } }> {
  const total = pattern.reduce((sum, part) => sum + Math.abs(part), 0);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (!(total > 0) || !(length > 0)) {
    return [{ start: from, end: to }];
  }
  const pieces: Array<{ start: { x: number; y: number }; end: { x: number; y: number } }> = [];
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  let travelled = 0;
  let index = 0;
  let on = true;
  while (travelled < length) {
    const step = Math.abs(pattern[index % pattern.length]) || total;
    const end = Math.min(travelled + step, length);
    if (on) {
      pieces.push({
        start: { x: from.x + ux * travelled, y: from.y + uy * travelled },
        end: { x: from.x + ux * end, y: from.y + uy * end },
      });
    }
    travelled = end;
    index += 1;
    on = !on;
  }
  return pieces;
}

export interface DrawingRenderResult {
  ok: boolean;
  reason?: string;
  /** How the drawing was fitted, so the caller can state the printed size honestly. */
  fit?: FitBox;
  skipped: string[];
  /** True when at least one element was too small to draw legibly. */
  droppedTooSmall: boolean;
}

/** Draw a parsed drawing into `box`, preserving aspect ratio. */
export function renderDrawing(
  page: PDFPage,
  parsed: ParsedDrawing,
  font: PDFFont,
  box: { x: number; y: number; width: number; height: number },
): DrawingRenderResult {
  if (parsed.elements.length === 0) {
    return {
      ok: false,
      reason: 'Chizma SVG ichida chiziladigan element topilmadi.',
      skipped: parsed.skipped,
      droppedTooSmall: false,
    };
  }

  const fit = fitBox(parsed, box);
  // SVG top-left -> PDF bottom-left, through the single fit transform.
  const toPdf = (point: { x: number; y: number }) => ({
    x: fit.x + point.x * fit.scale,
    y: fit.y + fit.height - point.y * fit.scale,
  });

  let droppedTooSmall = false;

  for (const element of parsed.elements) {
    if (element.kind === 'text') {
      const size = element.size * fit.scale;
      if (size < 1.5) {
        // Below ~1.5 pt nothing is legible; dropping is honest, printing mush is not.
        droppedTooSmall = true;
        continue;
      }
      const width = font.widthOfTextAtSize(element.text, size);
      const placement = textPlacement(element, width, toPdf);
      page.drawText(element.text, {
        x: placement.x,
        y: placement.y,
        size,
        font,
        color: element.color,
        ...(placement.rotateDeg === 0 ? {} : { rotate: degrees(placement.rotateDeg) }),
      });
      continue;
    }

    const points = element.points.map(toPdf);

    if (element.fill) {
      // Arrowheads and the sheet background are filled polygons.
      const path = points
        .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
        .join(' ');
      page.drawSvgPath(`${path} Z`, { x: 0, y: 0, color: element.fill, borderWidth: 0 });
    }

    if (element.stroke) {
      const thickness = Math.max(element.strokeWidth * fit.scale, 0.2);
      const edges: Array<[number, number]> = [];
      for (let index = 0; index < points.length - 1; index += 1) {
        edges.push([index, index + 1]);
      }
      if (element.kind !== 'line' && points.length > 2) {
        edges.push([points.length - 1, 0]);
      }
      for (const [fromIndex, toIndex] of edges) {
        const from = points[fromIndex];
        const to = points[toIndex];
        if (element.dash && element.dash.length > 0) {
          for (const piece of dashSegment(from, to, element.dash.map((part) => part * fit.scale))) {
            page.drawLine({ start: piece.start, end: piece.end, thickness, color: element.stroke });
          }
        } else {
          page.drawLine({ start: from, end: to, thickness, color: element.stroke });
        }
      }
    }
  }

  return { ok: true, fit, skipped: parsed.skipped, droppedTooSmall };
}
