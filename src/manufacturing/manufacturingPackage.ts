/**
 * C1 — furniture production document package.
 *
 * Bundles the documents a workshop needs for one piece into a single ZIP:
 * the mesh, the parts list, the cut list, the drawing, a manifest and a README.
 *
 * This module only *composes* the existing generators ({@link buildBom},
 * {@link buildCutList}, {@link createTechnicalDrawingSvg}, {@link bomToCsv},
 * {@link cutListToCsv}, {@link exportSceneToGlb}). Nothing here re-implements
 * a measurement, a drawing or a format.
 *
 * Failure model: every file is produced in memory first and the archive is
 * built only when all of them succeeded. A partial package is never returned —
 * a workshop acting on a half-filled folder is worse than an error message.
 */
import { zipSync, strToU8 } from 'fflate';
import { exportSceneToGlb } from '../export/sceneExport';
import { nameDigest, slugifyName } from '../export/exportNaming';
import {
  FURNITURE_TYPE_LABELS,
  type FurnitureParams,
  type FurnitureType,
} from '../geometry/furniture/types';
import type { SceneData, SceneObject } from '../scene/types';
import { sceneForObject } from '../scene/sceneSelection';
import { buildBom, PANEL_MAX_THICKNESS_CM, type BomResult } from './bom';
import { buildCutList, type CutListResult } from './cutList';
import { bomToCsv, cutListToCsv } from './manufacturingExport';
import { groupByMaterial, type MaterialGroup, type SheetIssue } from './sheetMaterial';
import {
  validateManufacturing,
  type ValidationIssue,
  type ValidationLevel,
  type ValidationReport,
} from './validation';
import { createTechnicalDrawingSvg } from './technicalDrawing';

/** Every entry the archive must contain, in a stable order. */
export const PACKAGE_ENTRIES = [
  'README.txt',
  'BOM.csv',
  'cutlist.csv',
  'drawing.svg',
  'meta.json',
  'model.glb',
] as const;

export type PackageEntryName = (typeof PACKAGE_ENTRIES)[number];

/** Format marker written into `meta.json`; bumped when the layout changes. */
export const PACKAGE_META_FORMAT = '3d-studio-ai-production-package';
export const PACKAGE_META_VERSION = 1;

export interface BuildPackageInput {
  /** Full scene; the export is narrowed to `object`. */
  scene: SceneData;
  /** The piece the documents describe. */
  object: SceneObject;
  /** Project name, used for the archive filename and the drawing title. */
  projectName: string;
  /** Overrides the export timestamp (tests use this for determinism). */
  generatedAt?: Date;
}

export interface ProductionPackage {
  /**
   * Archive bytes, ready for a Blob.
   *
   * Typed with an explicit `ArrayBuffer` because `zipSync` allocates a fresh,
   * exact-size buffer; the narrower type is what `BlobPart` accepts.
   */
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
  mimeType: 'application/zip';
  /** Per-entry byte counts, so the caller can report what was written. */
  entries: Array<{ name: PackageEntryName; bytes: number }>;
  totalParts: number;
  cutPieces: number;
}

export type PackageOutcome =
  | { ok: true; package: ProductionPackage }
  | { ok: false; reason: string };

/** Archive MIME type. */
export const PACKAGE_MIME_TYPE = 'application/zip';

const DATE_ONLY = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * `{slug}-{digest}-package.zip`, e.g. `stol-loyihasi-1a2b3c4d5e6f-package.zip`.
 *
 * The digest makes the name unique per project: the slug alone cannot, because
 * {@link slugifyName} drops non-ASCII characters (`Ошхона шкаф` and `Кухня` both
 * slug to `model`). Only the filename changes — the project's real name is kept
 * verbatim inside `meta.json` and `README.txt`.
 *
 * The `-package` suffix keeps the archive distinguishable from the single-format
 * downloads (`…-bom.csv`, `…-cutlist.csv`) that share the same name slug.
 */
export function packageFilename(projectName: string): string {
  return `${slugifyName(projectName, 'model')}-${nameDigest(projectName)}-package.zip`;
}

/**
 * Narrows the scene to the one object being documented.
 *
 * The room is excluded from the GLB (a workshop cutting one cabinet does not
 * want the walls), and assemblies are dropped because their derived members
 * would duplicate the piece's own geometry in the mesh.
 */
export { sceneForObject };

interface MetaFile {
  format: string;
  version: number;
  project: string;
  exportedAt: string;
  furniture: { type: FurnitureType; label: string };
  units: { scene: 'cm'; manufacturing: 'mm' };
  parameters: FurnitureParams;
  totals: { parts: number; cutPieces: number; panelAreaM2: number };
  /** Material actually assigned by the user; empty when none was. */
  materials: MaterialGroup[];
  /** Material and thickness problems, so the shop sees them before cutting. */
  issues: SheetIssue[];
  /**
   * C4 validation report. `ok` means "no error-level issue was found", never
   * "safe to manufacture" — the limitations list says what was not checked.
   */
  validation: {
    ok: boolean;
    counts: Record<ValidationLevel, number>;
    issues: ValidationIssue[];
    limitations: string[];
  };
  files: PackageEntryName[];
  limitations: string[];
}

function buildMeta(
  input: BuildPackageInput,
  bom: BomResult,
  cutList: CutListResult,
  exportedAt: Date,
  validation: ValidationReport,
): string {
  const meta: MetaFile = {
    format: PACKAGE_META_FORMAT,
    version: PACKAGE_META_VERSION,
    project: input.projectName.trim() || 'Nomsiz loyiha',
    exportedAt: exportedAt.toISOString(),
    furniture: {
      type: bom.type,
      label: FURNITURE_TYPE_LABELS[bom.type],
    },
    units: { scene: 'cm', manufacturing: 'mm' },
    parameters: input.object.params,
    totals: {
      parts: bom.totalParts,
      cutPieces: cutList.totalPieces,
      panelAreaM2: cutList.panelAreaM2,
    },
    materials: groupByMaterial(bom.rows),
    issues: [...bom.issues],
    validation: {
      ok: validation.ok,
      counts: validation.counts,
      issues: validation.issues,
      limitations: validation.limitations,
    },
    files: [...PACKAGE_ENTRIES],
    limitations: [...bom.limitations, ...cutList.limitations],
  };
  // No secrets are collected here: the meta only carries what the user sees in
  // the editor (name, type, dimensions) plus the export time.
  return JSON.stringify(meta, null, 2);
}

/**
 * Material summary for the README.
 *
 * When nothing is assigned the section says so plainly instead of listing a
 * default, so nobody mistakes an empty column for "standard board".
 */
function materialSection(bom: BomResult): string[] {
  const groups = groupByMaterial(bom.rows);
  const lines = [`Material`, ``];
  if (groups.length === 0) {
    lines.push(`  Material tanlanmagan — BOM va kesish royxatida material ustuni bosh.`);
    return lines;
  }
  for (const group of groups) {
    lines.push(
      `  ${group.name}, ${group.thicknessMm} ${group.unit} — ${group.totalPieces} detal (${group.partIds.join(', ')})`,
    );
  }
  const errors = bom.issues.filter((issue) => issue.level === 'error');
  const warnings = bom.issues.filter((issue) => issue.level === 'warning');
  if (errors.length > 0) {
    lines.push(``, `  Xatoliklar`);
    for (const issue of errors) {
      lines.push(`    - ${issue.message}`);
    }
  }
  if (warnings.length > 0) {
    lines.push(``, `  Ogohlantirishlar`);
    for (const issue of warnings) {
      lines.push(`    - ${issue.message}`);
    }
  }
  return lines;
}

/**
 * Validation summary for the README.
 *
 * States the counts and, deliberately, what the check did *not* cover: a shop
 * reading "0 xatolik" must not conclude the piece is certified.
 */
function validationSection(report: ValidationReport): string[] {
  const lines = [`Tekshiruv (C4)`, ``];
  lines.push(
    `  Xatolik: ${report.counts.error} · Ogohlantirish: ${report.counts.warning} · Malumot: ${report.counts.info}`,
  );
  const problems = report.issues.filter((entry) => entry.level !== 'info');
  if (problems.length === 0) {
    lines.push(`  Aniqlangan muammo yoq.`);
  } else {
    for (const entry of problems) {
      const mark = entry.level === 'error' ? 'XATO' : 'OGOH';
      lines.push(`  [${mark}] ${entry.message}`);
    }
  }
  lines.push(`  Bu tekshiruv ishlab chiqarishga yaroqlilikni tasdiqlamaydi:`);
  for (const limitation of report.limitations) {
    lines.push(`    - ${limitation}`);
  }
  return lines;
}

function buildReadme(
  input: BuildPackageInput,
  bom: BomResult,
  cutList: CutListResult,
  validation: ValidationReport,
): string {
  const label = FURNITURE_TYPE_LABELS[bom.type];
  const name = input.projectName.trim() || 'Nomsiz loyiha';
  const lines = [
    `AI 3D Studio — ishlab chiqarish hujjatlari to'plami`,
    ``,
    `Loyiha: ${name}`,
    `Mebel turi: ${label} (${bom.type})`,
    `Olchov birligi: sahna — santimetr, ishlab chiqarish hujjatlari — millimetr.`,
    ``,
    `Arxiv tarkibi`,
    `  model.glb      — 3D model (faqat shu mebel, xona geometriyasi kiritilmagan)`,
    `  BOM.csv        — detallar royxati: nomi, soni, olchamlari, qalinligi`,
    `  cutlist.csv    — kesish royxati: faqat panel detallar, uzunlik x kenglik x qalinlik`,
    `  drawing.svg    — texnik chizma: old, yon va yuqoridan korinishlar`,
    `  meta.json      — loyiha parametrlari va eksport vaqti`,
    `  README.txt     — ushbu fayl`,
    ``,
    `Jami: ${bom.totalParts} detal, ${cutList.totalPieces} panel, ${cutList.panelAreaM2} m2 panel yuzasi.`,
    ``,
    ...materialSection(bom),
    ``,
    ...validationSection(validation),
    `Muhim cheklovlar`,
    ...bom.limitations.map((line) => `  - ${line}`),
    ...cutList.limitations.map((line) => `  - ${line}`),
    `  - Ushbu toplam "ishlab chiqarishga tayyor" yoki sertifikatlangan deb hisoblanmaydi:`,
    `    toleranslar, birlashma detallari, furnitura va sex standartlari tekshirilmagan.`,
    `    Har bir olchamni sexda qayta tekshiring.`,
  ];
  return lines.join('\n');
}

function entryBytes(name: PackageEntryName, data: Uint8Array): { name: PackageEntryName; bytes: number } {
  return { name, bytes: data.length };
}

/**
 * Builds the ZIP archive for one piece.
 *
 * Every generator runs before the archive is assembled, so a failure at any step
 * (invalid parameters, a drawing that could not be produced, a GLB export error)
 * returns `{ ok: false }` and no bytes are handed to the caller.
 */
export async function buildManufacturingPackage(
  input: BuildPackageInput,
): Promise<PackageOutcome> {
  const { scene, object, projectName } = input;

  if (!scene.objects.some((entry) => entry.id === object.id)) {
    return { ok: false, reason: "Tanlangan obyekt sahnada topilmadi." };
  }

  const bomOutcome = buildBom(object.type, object.params, object.sheetMaterials);
  if (!bomOutcome.ok) {
    return { ok: false, reason: bomOutcome.reason };
  }
  const bom = bomOutcome.bom;

  // One report for the piece, reused by meta.json and the README so the two can
  // never disagree. Validation never mutates the model.
  const validation = validateManufacturing(object.type, object.params, object.sheetMaterials);

  const cutList = buildCutList(bom);
  if (cutList.rows.length === 0) {
    // No part is thin enough to be cut from board, so there is nothing a
    // workshop could saw. Refusing is the honest outcome: inventing cut rows for
    // an upholstered block (a sofa seat is 34 cm thick) would hand the shop a
    // cut list it cannot use.
    return {
      ok: false,
      reason:
        'Kesish royxati bosh: bu mebelning hech bir detali yupqa panel emas ' +
        `(eng kichik tomoni ${PANEL_MAX_THICKNESS_CM * 10} mm dan qalin), ` +
        'shuning uchun ishlab chiqarish paketi tuzilmadi.',
    };
  }

  const exportedAt = input.generatedAt ?? new Date();

  const drawing = createTechnicalDrawingSvg(object.type, object.params, {
    title: projectName.trim() !== '' ? projectName : FURNITURE_TYPE_LABELS[object.type],
    date: DATE_ONLY(exportedAt),
  });
  if (!drawing.ok) {
    return { ok: false, reason: drawing.reason };
  }
  if (!drawing.svg.includes('<svg')) {
    return { ok: false, reason: "Texnik chizma bosh yoki yaroqsiz." };
  }

  let glb: ArrayBuffer;
  try {
    // Awaited: GLTFExporter.parseAsync is async and an un-awaited call would
    // zip a promise-shaped blob (empty).
    glb = await exportSceneToGlb(sceneForObject(scene, object), { includeRoom: false });
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error && error.message
          ? `3D modelni eksport qilib bolmadi: ${error.message}`
          : "3D modelni eksport qilib bolmadi.",
    };
  }
  if (glb.byteLength === 0) {
    return { ok: false, reason: "3D model fayli bosh." };
  }

  const files: Record<string, Uint8Array> = {
    'model.glb': new Uint8Array(glb),
    'BOM.csv': strToU8(bomToCsv(bom)),
    'cutlist.csv': strToU8(cutListToCsv(cutList)),
    'drawing.svg': strToU8(drawing.svg),
    'meta.json': strToU8(buildMeta(input, bom, cutList, exportedAt, validation)),
    'README.txt': strToU8(buildReadme(input, bom, cutList, validation)),
  };

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    // Level 6 keeps the archive small without spending time on the GLB's
    // already-compressed binary chunks. `mtime` pins every entry's DOS timestamp
    // to the export time already recorded in meta.json, so the same input
    // produces byte-identical archives; fflate would otherwise stamp each entry
    // with the wall clock and two runs would differ by their build time.
    bytes = zipSync(files, { level: 6, mtime: exportedAt }) as Uint8Array<ArrayBuffer>;
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error && error.message
          ? `Arxivni yigib bolmadi: ${error.message}`
          : "Arxivni yigib bolmadi.",
    };
  }
  if (bytes.length === 0) {
    return { ok: false, reason: "Arxiv bosh." };
  }

  return {
    ok: true,
    package: {
      bytes,
      filename: packageFilename(projectName),
      mimeType: PACKAGE_MIME_TYPE,
      entries: PACKAGE_ENTRIES.map((name) => entryBytes(name, files[name])),
      totalParts: bom.totalParts,
      cutPieces: cutList.totalPieces,
    },
  };
}
