/**
 * W14 — BOM for an assembly.
 *
 * A separate entry point from `buildBom`, which is typed on `FurnitureType` and
 * is used by the manufacturing panel for the eight furniture types. Keeping the
 * two apart means neither path has to know about the other, and the existing
 * furniture BOM cannot regress (plan D8).
 *
 * Like the furniture BOM, the numbers are measured from the built geometry, not
 * re-derived from formulas. Nothing is invented: material, hardware and joinery
 * are still unavailable and said so in `limitations`.
 */
import * as THREE from 'three';
import type { AssemblyKind } from '../scene/types';
import { buildAssembly } from '../geometry/assemblies';
import type { AssemblyParams } from '../geometry/assemblies/params';
import {
  PANEL_KINDS,
  PART_KIND_LABELS,
  minDimensionCm,
  partTypeOf,
  totalPartCount,
  type PartGroup,
  type PartKind,
  type PartType,
} from './parts';
import { convertLength, roundLength } from './units';

/** Role tag written by `assembleParts` -> the kind vocabulary the BOM uses. */
const ROLE_TO_KIND: Record<string, PartKind> = {
  corpus: 'body',
  divider: 'board',
  shelf: 'shelf',
  door: 'door',
  drawer: 'drawer',
  plinth: 'bottom',
  top: 'top',
  step: 'board',
  stringer: 'frame',
  back: 'back',
};

export interface AssemblyBomRow {
  name: string;
  partId: string;
  kind: PartKind;
  partType: PartType;
  quantity: number;
  sizeMm: { x: number; y: number; z: number };
  thicknessMm: number | null;
  material: null;
  sources: { dimensions: 'geometry'; quantity: 'counted'; material: 'unavailable' };
}

export interface AssemblyBomResult {
  assemblyKind: AssemblyKind;
  typeLabel: string;
  unit: 'mm';
  rows: AssemblyBomRow[];
  totalParts: number;
  panelAreaM2: number;
  limitations: string[];
}

export type AssemblyBomOutcome =
  | { ok: true; bom: AssemblyBomResult }
  | { ok: false; reason: string };

export const ASSEMBLY_BOM_LIMITATIONS: readonly string[] = [
  "Ma'lumot model geometriyasidan o'lchandi (dastlabki hisob-kitob).",
  "Material turi va qalinligi standarti modelda yo'q — material ustuni bo'sh.",
  'Furnitura, biriktirish texnologiyasi va ulanish turlari hisoblanmagan.',
  'Arralash kerfi (kerf), chiqindi va toleranslar hisobga olinmagan.',
  'Konstruktiv mustahkamlik hisoblari bajarilmagan.',
  "Assembly manufacturing-ready emas: qirra (edge banding) va yig'ish sxemasi modellashtirilmagan.",
];

const ASSEMBLY_LABELS: Record<AssemblyKind, string> = {
  'kitchen-base-run': 'Oshxona pastki moduli',
  'wall-cabinet': 'Osma oshxona shkafi',
  'wardrobe-section': 'Shkaf seksiyasi',
  'stair-straight': "To'g'ri zinapoya",
};

interface Measured {
  partId: string;
  kind: PartKind;
  sizeXCm: number;
  sizeYCm: number;
  sizeZCm: number;
}

function measureAssembly(group: THREE.Object3D): Measured[] {
  const parts: Measured[] = [];
  group.traverse((child) => {
    const mesh = child as THREE.Mesh & { isMesh?: boolean };
    if (mesh.isMesh !== true) {
      return;
    }
    const parameters = (
      mesh.geometry as THREE.BufferGeometry & {
        parameters?: { width?: number; height?: number; depth?: number };
      }
    ).parameters;
    const width = parameters?.width;
    const height = parameters?.height;
    const depth = parameters?.depth;
    if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(depth)) {
      return;
    }
    const role = String(mesh.userData.partRole ?? '');
    parts.push({
      partId: mesh.name,
      kind: ROLE_TO_KIND[role] ?? 'unknown',
      sizeXCm: width as number,
      sizeYCm: height as number,
      sizeZCm: depth as number,
    });
  });
  return parts;
}

function groupKey(part: Measured): string {
  const [a, b, c] = [part.sizeXCm, part.sizeYCm, part.sizeZCm].map((value) =>
    Math.round(value * 1000),
  );
  return `${part.kind}|${a}|${b}|${c}`;
}

function foldParts(parts: Measured[]): PartGroup[] {
  const map = new Map<string, PartGroup>();
  for (const part of parts) {
    const key = groupKey(part);
    const existing = map.get(key);
    if (existing) {
      existing.quantity += 1;
    } else {
      map.set(key, {
        partId: part.partId,
        kind: part.kind,
        sizeXCm: part.sizeXCm,
        sizeYCm: part.sizeYCm,
        sizeZCm: part.sizeZCm,
        partType: partTypeOf(part.kind),
        quantity: 1,
      });
    }
  }
  return [...map.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.sizeXCm - b.sizeXCm || a.sizeYCm - b.sizeYCm,
  );
}

function toRow(kind: AssemblyKind, group: PartGroup): AssemblyBomRow {
  const isPanel = PANEL_KINDS.includes(group.kind) && minDimensionCm(group) <= 6;
  const mm = (valueCm: number) => roundLength(convertLength(valueCm, 'cm', 'mm'), 'mm');
  return {
    name: PART_KIND_LABELS[group.kind] ?? 'Detal',
    partId: `${kind}-${group.kind}`,
    kind: group.kind,
    partType: group.partType,
    quantity: group.quantity,
    sizeMm: { x: mm(group.sizeXCm), y: mm(group.sizeYCm), z: mm(group.sizeZCm) },
    thicknessMm: isPanel ? mm(minDimensionCm(group)) : null,
    material: null,
    sources: { dimensions: 'geometry', quantity: 'counted', material: 'unavailable' },
  };
}

function panelAreaM2(rows: AssemblyBomRow[]): number {
  let area = 0;
  for (const row of rows) {
    if (row.thicknessMm === null) {
      continue;
    }
    const dims = [row.sizeMm.x, row.sizeMm.y, row.sizeMm.z].sort((a, b) => b - a);
    area += (dims[0] / 1000) * (dims[1] / 1000) * row.quantity;
  }
  return Math.round(area * 1000) / 1000;
}

/**
 * Build the BOM for one assembly. Returns a reason instead of throwing, matching
 * `buildBom` so the caller can show the message and keep the editor running.
 */
export function buildAssemblyBom(
  kind: AssemblyKind,
  params: AssemblyParams,
): AssemblyBomOutcome {
  let built;
  try {
    built = buildAssembly(kind, params as never);
  } catch {
    return {
      ok: false,
      reason: "Detallar ro'yxatini tuzish uchun assembly parametrlari noto'g'ri.",
    };
  }

  let groups: PartGroup[];
  try {
    groups = foldParts(measureAssembly(built.group));
  } finally {
    built.dispose();
  }

  if (groups.length === 0) {
    return { ok: false, reason: "Modelda o'lchanadigan detallar topilmadi." };
  }

  const rows = groups.map((group) => toRow(kind, group));
  return {
    ok: true,
    bom: {
      assemblyKind: kind,
      typeLabel: ASSEMBLY_LABELS[kind],
      unit: 'mm',
      rows,
      totalParts: totalPartCount(groups),
      panelAreaM2: panelAreaM2(rows),
      limitations: [...ASSEMBLY_BOM_LIMITATIONS],
    },
  };
}
