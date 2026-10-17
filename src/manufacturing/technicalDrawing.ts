/**
 * W9 technical drawing (SVG).
 *
 * Draws three orthographic views — front, side and top — of ONE furniture piece,
 * in the piece's own local frame (the object as it is manufactured, ignoring where
 * it sits in the room). Every rectangle is the projected bounding box of a real
 * mesh, so the drawing is derived from the actual geometry rather than redrawn by
 * hand.
 *
 * Coordinate convention (local): x = width, y = height, z = depth. The drawing is
 * reported in millimetres even though the scene stores centimetres.
 *
 * Scope, stated plainly: overall dimensions are exact (measured), part outlines
 * are schematic and may overlap, and there are no tolerances, joint details,
 * hidden lines or manufacturing standards. It is a preliminary drawing.
 */
import * as THREE from 'three';
import { buildFurniture } from '../geometry/furniture/buildFurniture';
import { validateFurnitureParams } from '../geometry/furniture/params';
import {
  FURNITURE_TYPE_LABELS,
  type FurnitureParams,
  type FurnitureType,
} from '../geometry/furniture/types';
import { convertLength, roundLength } from './units';

export type DrawingView = 'front' | 'side' | 'top';

export const DRAWING_VIEW_LABELS: Record<DrawingView, string> = {
  front: 'Old korinish',
  side: 'Yon korinish',
  top: 'Yuqoridan korinish',
};

export interface PartBox {
  partId: string;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface TechnicalDrawingOptions {
  /** Title shown in the title block (model/project name). */
  title?: string;
  /** Include the per-part outline rectangles (default true). */
  includePartOutlines?: boolean;
  /** Optional date string for the title block (kept out of pure output otherwise). */
  date?: string;
}

export type TechnicalDrawingResult =
  | { ok: true; svg: string; overall: { widthMm: number; heightMm: number; depthMm: number } }
  | { ok: false; reason: string };

const PAD = 40;
const VIEW_W = 260;
const VIEW_H = 200;
const GAP = 48;
const TITLE_H = 130;
const MAX_SCALE = 5;
const MIN_SCALE = 0.02;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Local AABB of every mesh (the group is built fresh, so this is local space). */
export function measurePartBoxes(group: THREE.Object3D): PartBox[] {
  const boxes: PartBox[] = [];
  group.updateMatrixWorld(true);
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh !== true) {
      return;
    }
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) {
      return;
    }
    const { min, max } = box;
    if (![min.x, min.y, min.z, max.x, max.y, max.z].every((v) => Number.isFinite(v))) {
      return;
    }
    boxes.push({
      partId: mesh.name,
      minX: min.x,
      minY: min.y,
      minZ: min.z,
      maxX: max.x,
      maxY: max.y,
      maxZ: max.z,
    });
  });
  return boxes;
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

function chooseScale(boxes: PartBox[], views: DrawingView[]): number {
  let scale = MAX_SCALE;
  for (const view of views) {
    const b = boundsFor(boxes, view);
    const hMm = Math.max(convertLength(b.hMax - b.hMin, 'cm', 'mm'), 1);
    const vMm = Math.max(convertLength(b.vMax - b.vMin, 'cm', 'mm'), 1);
    scale = Math.min(scale, VIEW_W / hMm, VIEW_H / vMm);
  }
  return Math.max(scale, MIN_SCALE);
}

function renderView(
  boxes: PartBox[],
  view: DrawingView,
  originX: number,
  originY: number,
  scale: number,
  includePartOutlines: boolean,
): string {
  const b = boundsFor(boxes, view);
  const parts: string[] = [];
  const toX = (h: number) => originX + convertLength(h - b.hMin, 'cm', 'mm') * scale;
  const toY = (v: number) => originY + convertLength(b.vMax - v, 'cm', 'mm') * scale;

  parts.push(
    `<rect x="${originX}" y="${originY}" width="${VIEW_W}" height="${VIEW_H}" fill="none" stroke="#2a2f36" stroke-width="1" />`,
  );

  if (includePartOutlines) {
    for (const box of boxes) {
      const span = project(box, view);
      const x = toX(span.h0);
      const y = toY(span.v1);
      const w = Math.max(toX(span.h1) - x, 0.5);
      const h = Math.max(toY(span.v0) - y, 0.5);
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="none" stroke="#6f7b88" stroke-width="1" />`,
      );
    }
  }

  // Overall dimension annotations (measured, in mm).
  const widthMm = roundLength(convertLength(b.hMax - b.hMin, 'cm', 'mm'), 'mm');
  const heightMm = roundLength(convertLength(b.vMax - b.vMin, 'cm', 'mm'), 'mm');
  const labelY = originY + VIEW_H + 16;
  const labelX = originX + VIEW_W / 2;
  parts.push(
    `<text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-size="11" fill="#aeb9c4">${escapeXml(DRAWING_VIEW_LABELS[view])}</text>`,
  );
  parts.push(
    `<text x="${labelX.toFixed(1)}" y="${(labelY + 14).toFixed(1)}" text-anchor="middle" font-size="11" fill="#8f9aa6">${widthMm} x ${heightMm} mm</text>`,
  );
  return parts.join('\n');
}

/**
 * Build a preliminary technical drawing for one furniture piece.
 * Invalid parameters are rejected with a clear reason.
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
    return { ok: false, reason: "Modelda chizish uchun geometriya topilmadi." };
  }

  const views: DrawingView[] = ['front', 'side', 'top'];
  const scale = chooseScale(boxes, views);

  const width = PAD * 2 + VIEW_W * 3 + GAP * 2;
  const height = PAD + VIEW_H + 34 + GAP + TITLE_H;
  const body: string[] = [];

  views.forEach((view, index) => {
    const originX = PAD + index * (VIEW_W + GAP);
    body.push(
      renderView(boxes, view, originX, PAD, scale, options.includePartOutlines !== false),
    );
  });

  const overallBounds = boundsFor(boxes, 'front');
  const sideBounds = boundsFor(boxes, 'side');
  const overallWidthMm = roundLength(convertLength(overallBounds.hMax - overallBounds.hMin, 'cm', 'mm'), 'mm');
  const overallHeightMm = roundLength(convertLength(overallBounds.vMax - overallBounds.vMin, 'cm', 'mm'), 'mm');
  const overallDepthMm = roundLength(convertLength(sideBounds.hMax - sideBounds.hMin, 'cm', 'mm'), 'mm');

  const title = options.title && options.title.trim() !== '' ? options.title : FURNITURE_TYPE_LABELS[type];
  const titleY = PAD + VIEW_H + 34 + GAP;
  // Build the title block with a running cursor so lines never overlap.
  let cursor = titleY + 22;
  const lines: string[] = [
    `<text x="${PAD}" y="${cursor}" font-size="15" fill="#e8edf2">${escapeXml(title)}</text>`,
  ];
  cursor += 20;
  lines.push(
    `<text x="${PAD}" y="${cursor}" font-size="11" fill="#aeb9c4">Turi: ${escapeXml(FURNITURE_TYPE_LABELS[type])} · Birlik: mm</text>`,
  );
  if (options.date) {
    cursor += 16;
    lines.push(
      `<text x="${PAD}" y="${cursor}" font-size="11" fill="#8f9aa6">Sana: ${escapeXml(options.date)}</text>`,
    );
  }
  cursor += 18;
  lines.push(
    `<text x="${PAD}" y="${cursor}" font-size="11" fill="#8f9aa6">Umumiy: W ${overallWidthMm} x H ${overallHeightMm} x D ${overallDepthMm} mm (geometriyadan olchandi)</text>`,
  );
  cursor += 18;
  lines.push(
    `<text x="${PAD}" y="${cursor}" font-size="10" fill="#c08a3e">Dastlabki chizma: toleranslar, birlashma detallari va ishlab chiqarish standartlari tekshirilmagan.</text>`,
  );

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Texnik chizma">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#12161b" />`,
    body.join('\n'),
    lines.join('\n'),
    '</svg>',
  ].join('\n');

  return {
    ok: true,
    svg,
    overall: { widthMm: overallWidthMm, heightMm: overallHeightMm, depthMm: overallDepthMm },
  };
}
