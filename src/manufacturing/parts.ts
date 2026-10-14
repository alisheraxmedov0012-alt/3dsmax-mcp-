/**
 * W9 part extraction from real geometry.
 *
 * BOM/cut-list data is measured from the **actual built meshes**, not re-derived
 * from formulas: each part's own dimensions come from its `BoxGeometry`
 * parameters (all builders use axis-aligned boxes), and its position comes from
 * the mesh transform. That keeps the numbers consistent with what is rendered and
 * exported.
 *
 * Two layers:
 * - `measureParts` walks a built furniture group and reads the raw box sizes.
 * - `groupParts` is pure and folds identical parts into quantity lines, so the
 *   leg/shelf/door counts are computed rather than hard-coded.
 */
import * as THREE from 'three';
import type { FurnitureParams, FurnitureType } from '../geometry/furniture/types';

export type PartKind =
  | 'top'
  | 'bottom'
  | 'side'
  | 'shelf'
  | 'board'
  | 'back'
  | 'door'
  | 'drawer'
  | 'seat'
  | 'frame'
  | 'leg'
  | 'arm'
  | 'body'
  | 'mattress'
  | 'headboard'
  | 'unknown';

export type PartType = 'panel' | 'post' | 'block' | 'upholstery';

export const PART_KIND_LABELS: Record<PartKind, string> = {
  top: 'Ust paneli',
  bottom: 'Ost paneli',
  side: 'Yon paneli',
  shelf: 'Tokcha',
  board: 'Tokcha',
  back: 'Orqa panel',
  door: 'Eshik',
  drawer: 'Tortma',
  seat: "O'rindiq",
  frame: 'Karkas',
  leg: 'Oyoq',
  arm: "Qo'l tayanchi",
  body: 'Korpus',
  mattress: 'Matras',
  headboard: 'Bosh qismi',
  unknown: 'Detal',
};

/** Which kinds are cut from sheet/board material (used by the cut list). */
export const PANEL_KINDS: readonly PartKind[] = [
  'top',
  'bottom',
  'side',
  'shelf',
  'board',
  'back',
  'door',
  'drawer',
  'seat',
  'frame',
  'headboard',
];

export function partTypeOf(kind: PartKind): PartType {
  if (kind === 'leg' || kind === 'arm') {
    return 'post';
  }
  if (kind === 'body') {
    return 'block';
  }
  if (kind === 'mattress') {
    return 'upholstery';
  }
  if (kind === 'unknown') {
    return 'block';
  }
  return 'panel';
}

/**
 * A single measured part. Sizes are the raw box dimensions in cm, in the
 * furniture's local frame (x = across, y = up, z = depth).
 */
export interface MeasuredPart {
  partId: string;
  kind: PartKind;
  sizeXCm: number;
  sizeYCm: number;
  sizeZCm: number;
}

export interface PartGroup extends MeasuredPart {
  partType: PartType;
  quantity: number;
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

/** Derive the part kind from a partId such as `wardrobe-shelf-3`. */
export function partKindFromId(type: FurnitureType, partId: string): PartKind {
  const withoutType = partId.startsWith(`${type}-`) ? partId.slice(type.length + 1) : partId;
  const withoutIndex = withoutType.replace(/-\d+$/, '');
  return (Object.prototype.hasOwnProperty.call(PART_KIND_LABELS, withoutIndex)
    ? withoutIndex
    : 'unknown') as PartKind;
}

/**
 * Measure every mesh in the built group. Returns raw parts; callers group them.
 * Non-finite sizes are dropped (they would otherwise corrupt the BOM).
 */
export function measureParts(
  type: FurnitureType,
  group: THREE.Object3D,
): MeasuredPart[] {
  const parts: MeasuredPart[] = [];
  group.updateMatrixWorld(true);
  group.traverse((child) => {
    if (!isMesh(child)) {
      return;
    }
    const parameters = (child.geometry as THREE.BufferGeometry & {
      parameters?: { width?: number; height?: number; depth?: number };
    }).parameters;
    const width = parameters?.width;
    const height = parameters?.height;
    const depth = parameters?.depth;
    if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(depth)) {
      return;
    }
    parts.push({
      partId: child.name,
      kind: partKindFromId(type, child.name),
      sizeXCm: width as number,
      sizeYCm: height as number,
      sizeZCm: depth as number,
    });
  });
  return parts;
}

/** Stable key so identical parts merge but distinct ones never do. */
function groupKey(part: MeasuredPart): string {
  const [a, b, c] = [part.sizeXCm, part.sizeYCm, part.sizeZCm].map((v) => Math.round(v * 1000));
  return `${part.kind}|${a}|${b}|${c}`;
}

/**
 * Fold measured parts into quantity lines. Only parts of the same kind **and**
 * identical size are merged, so e.g. four identical table legs become quantity 4
 * while a differing shelf is kept separate.
 */
export function groupParts(parts: MeasuredPart[]): PartGroup[] {
  const map = new Map<string, PartGroup>();
  for (const part of parts) {
    const key = groupKey(part);
    const existing = map.get(key);
    if (existing) {
      existing.quantity += 1;
    } else {
      map.set(key, { ...part, partType: partTypeOf(part.kind), quantity: 1 });
    }
  }
  return [...map.values()];
}

/** Human-readable name for a grouped part, e.g. "Oyoq (4 dona)". */
export function describePartGroup(group: PartGroup): string {
  return `${PART_KIND_LABELS[group.kind]} (${group.quantity} dona)`;
}

/** Smallest box dimension — the candidate "thickness" of a panel. */
export function minDimensionCm(part: MeasuredPart): number {
  return Math.min(part.sizeXCm, part.sizeYCm, part.sizeZCm);
}

/** Total part count (sum of quantities). */
export function totalPartCount(groups: PartGroup[]): number {
  return groups.reduce((sum, group) => sum + group.quantity, 0);
}

/** Deterministic inventory summary used in tests and the UI header. */
export function partCountByKind(groups: PartGroup[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const group of groups) {
    counts[group.kind] = (counts[group.kind] ?? 0) + group.quantity;
  }
  return counts;
}

export type { FurnitureParams, FurnitureType };
