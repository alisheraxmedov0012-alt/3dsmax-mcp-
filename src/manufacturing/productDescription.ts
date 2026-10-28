/**
 * C8 — English product description.
 *
 * Generated from the same data the other manufacturing documents use: the
 * measured BOM, the cut list, the C4 report and whichever C6/C7 plans exist. It
 * is a pure function of its input, so the description cannot drift from the
 * model: regenerate it and the text follows.
 *
 * What this deliberately does not say
 * -----------------------------------
 * Every claim here is traceable to a field in the input. The module never emits
 * "certified", "load-rated", "structurally safe", "meets standard" or "ready for
 * production", because no source in this project carries that evidence — the
 * validator measures geometry and reports gaps, it does not approve a design. The
 * `limitations` section states what was not verified instead.
 *
 * Materials are described only when the user actually assigned one. An
 * unassigned part yields an explicit "not specified", never a plausible board.
 */
import type { BomResult } from './bom';
import type { CutListResult } from './cutList';
import type { ValidationReport } from './validation';
import type { AssemblyPlan } from './assemblyInstructions';
import type { CuttingPlan } from './cuttingPlan';
import type { FurnitureType, FurnitureParams } from '../geometry/furniture/types';
import { FURNITURE_TYPE_LABELS } from '../geometry/furniture/types';
import { nameDigest } from '../export/exportNaming';

/**
 * English product names.
 *
 * Display labels only — the same role `FURNITURE_TYPE_LABELS` plays for the
 * Uzbek UI. Nothing downstream switches on them.
 */
export const PRODUCT_ENGLISH_NAMES: Record<FurnitureType, string> = {
  table: 'Dining Table',
  chair: 'Dining Chair',
  armchair: 'Armchair',
  sofa: 'Sofa',
  bed: 'Bed Frame',
  wardrobe: 'Wardrobe',
  shelf: 'Shelving Unit',
  dresser: 'Dresser',
};

/** One line of intended use, kept short and free of claims. */
const PRODUCT_PURPOSE: Record<FurnitureType, string> = {
  table: 'A parametrically sized table for dining or general interior use.',
  chair: 'A parametrically sized chair with a seat and backrest.',
  armchair: 'A parametrically sized armchair with armrests and a backrest.',
  sofa: 'A parametrically sized sofa with armrests and a backrest.',
  bed: 'A parametrically sized bed frame with a headboard and a mattress opening.',
  wardrobe: 'A parametrically sized wardrobe with internal shelves and doors.',
  shelf: 'A parametrically sized open shelving unit.',
  dresser: 'A parametrically sized dresser.',
};

export interface ProductDescriptionInput {
  type: FurnitureType;
  /**
   * The model parameters, when the caller has them. Used to describe a dresser
   * from its actual drawer/door counts instead of a fixed sentence; callers that
   * omit it get the neutral, claim-free purpose line.
   */
  params?: FurnitureParams;
  /** Overall size in millimetres, as measured from the built geometry. */
  overallMm: { widthMm: number; heightMm: number; depthMm: number };
  bom: BomResult;
  cutList: CutListResult;
  validation: ValidationReport;
  assembly?: AssemblyPlan | null;
  cuttingPlan?: CuttingPlan | null;
}

export interface ProductDescription {
  /** Product name in English. */
  name: string;
  /** The same product's name in the app's own language, for cross-reference. */
  localName: string;
  /** One-sentence intended use. */
  purpose: string;
  /** Bullet list of features the model actually provides. */
  features: string[];
  /** Every dimension quoted, all measured from the model. */
  dimensions: string[];
  /** Material lines; states "not specified" when nothing was assigned. */
  materials: string[];
  /** Documents that ship with this product. */
  documents: string[];
  /** What was not modelled or verified. Always non-empty. */
  limitations: string[];
  /** Digest of the input, so a caller can tell a description has gone stale. */
  fingerprint: string;
}

const mm = (value: number): string => `${Math.round(value * 10) / 10} mm`;

/** `1 piece` / `2 pieces`, so the generated English reads correctly. */
const plural = (count: number, singular: string, pluralForm = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : pluralForm}`;

/**
 * Purpose line for a dresser, built from the counts the model actually has.
 *
 * A fixed "drawers and a door" sentence was wrong for the default three-drawer
 * dresser (`doorCount: 0`). Counts are only mentioned when the caller supplied
 * parameters; without them the line makes no claim about either.
 */
function dresserPurpose(params: FurnitureParams | undefined): string {
  const drawers = params?.drawerCount;
  const doors = params?.doorCount;
  const drawerText = typeof drawers === 'number' && drawers > 0 ? plural(drawers, 'drawer') : null;
  const doorText =
    typeof doors === 'number' && doors > 0 ? (doors === 1 ? 'a door' : `${doors} doors`) : null;
  if (drawerText && doorText) {
    return `A parametrically sized dresser with ${drawerText} and ${doorText}.`;
  }
  if (drawerText) {
    return `A parametrically sized dresser with ${drawerText}.`;
  }
  if (doorText) {
    return `A parametrically sized dresser with ${doorText}.`;
  }
  return PRODUCT_PURPOSE.dresser;
}

function productPurpose(type: FurnitureType, params: FurnitureParams | undefined): string {
  return type === 'dresser' ? dresserPurpose(params) : PRODUCT_PURPOSE[type];
}

/** Distinct board materials actually assigned to at least one part. */
function assignedMaterials(bom: BomResult): Array<{ name: string; thicknessMm: number; pieces: number }> {
  const map = new Map<string, { name: string; thicknessMm: number; pieces: number }>();
  for (const row of bom.rows) {
    if (!row.material) {
      continue;
    }
    const key = `${row.material.materialId}:${row.material.thicknessMm}`;
    const existing = map.get(key);
    if (existing) {
      existing.pieces += row.quantity;
    } else {
      map.set(key, {
        name: row.material.name,
        thicknessMm: row.material.thicknessMm,
        pieces: row.quantity,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function unassignedPartNames(bom: BomResult): string[] {
  return bom.rows.filter((row) => row.material === null).map((row) => row.name);
}

/**
 * Digest of everything the description quotes, so the UI can show that a
 * description no longer matches the model.
 */
function describeFingerprint(input: ProductDescriptionInput): string {
  const parts = input.bom.rows
    .map((row) =>
      [
        row.partId,
        String(row.quantity),
        `${row.sizeMm.x}x${row.sizeMm.y}x${row.sizeMm.z}`,
        row.material ? `${row.material.materialId}@${row.material.thicknessMm}` : 'none',
      ].join(':'),
    )
    .sort();
  const overall = `${input.overallMm.widthMm}x${input.overallMm.heightMm}x${input.overallMm.depthMm}`;
  const assembly = input.assembly ? `${input.assembly.status}:${input.assembly.steps.length}` : 'none';
  const cutting = input.cuttingPlan
    ? `${input.cuttingPlan.status}:${input.cuttingPlan.summary.sheetCount}`
    : 'none';
  // The dresser purpose now quotes these counts, so a change must invalidate it.
  const counts =
    input.type === 'dresser' && input.params
      ? `|drawers:${input.params.drawerCount ?? 'unspecified'}|doors:${input.params.doorCount ?? 'unspecified'}`
      : '';
  return nameDigest(
    `${input.type}|${overall}|${parts.join('|')}|${assembly}|${cutting}|${input.validation.counts.error}${counts}`,
  );
}

/**
 * Build the English product description.
 *
 * The document list mirrors what the product package really contains, so it is
 * passed in rather than assumed: a caller that ships fewer files says so.
 */
export function buildProductDescription(
  input: ProductDescriptionInput,
  documents: readonly string[],
): ProductDescription {
  const { type, bom, cutList, validation, assembly, cuttingPlan } = input;
  const name = PRODUCT_ENGLISH_NAMES[type];
  const localName = FURNITURE_TYPE_LABELS[type];

  const panelRows = cutList.rows;
  const features: string[] = [];
  features.push(
    `Parametric ${name.toLowerCase()} modelled from ${bom.rows.length} distinct part types (${bom.totalParts} pieces).`,
  );
  if (panelRows.length > 0) {
    features.push(
      `Bill of materials with ${plural(cutList.totalPieces, 'panel piece')}, ${cutList.panelAreaM2} m² of panel face area before kerf.`,
    );
  } else {
    features.push('This model has no thin-panel parts, so it has no cut list.');
  }
  if (assembly && assembly.steps.length > 0) {
    features.push(
      `Assembly sequence in ${assembly.steps.length} ordered steps, each naming the parts it places.`,
    );
  }
  if (cuttingPlan) {
    features.push(
      `Sheet layout for ${plural(cuttingPlan.summary.sheetCount, 'board')} at ${cuttingPlan.settings.sheetLengthMm}×${cuttingPlan.settings.sheetWidthMm} mm with a ${cuttingPlan.settings.kerfMm} mm kerf.`,
    );
  }

  const dimensions = [
    `Overall (measured from the model geometry): ${mm(input.overallMm.widthMm)} W × ${mm(input.overallMm.heightMm)} H × ${mm(input.overallMm.depthMm)} D.`,
    ...bom.rows.map(
      (row) =>
        `${row.name} (${row.partId}) × ${row.quantity}: ${mm(row.sizeMm.x)} × ${mm(row.sizeMm.y)} × ${mm(row.sizeMm.z)}.`,
    ),
  ];

  const materials: string[] = [];
  const assigned = assignedMaterials(bom);
  for (const entry of assigned) {
    materials.push(
      `${entry.name}, nominal ${entry.thicknessMm} mm — assigned by the user to ${plural(entry.pieces, 'piece')}.`,
    );
  }
  const missing = unassignedPartNames(bom);
  if (missing.length > 0) {
    materials.push(
      `Board material not specified for: ${missing.join(', ')}. No material is assumed for these parts.`,
    );
  }

  const limitations: string[] = [
    'Dimensions are measured from the generated geometry; they are not taken from a manufacturing drawing or a physical sample.',
    'Board material and nominal thickness are user-supplied labels, not a certified product specification or a material standard.',
    'Fasteners, joinery, drilling positions, edge banding and tolerances are not modelled, so no fixing method is specified.',
    'Structural strength, load capacity and durability have not been analysed or tested.',
    'Assembly and cutting documents are derived from the model and are heuristic where noted; they are not a manufacturing certification.',
    `This description was generated automatically from the model and does not replace review by a furniture professional.`,
  ];
  if (validation.counts.error > 0) {
    limitations.unshift(
      `The manufacturing validation reports ${validation.counts.error} error(s); this model is not cleared by that check.`,
    );
  }
  limitations.push(...validation.limitations);

  return {
    name,
    localName,
    purpose: productPurpose(type, input.params),
    features,
    dimensions,
    materials,
    documents: [...documents],
    limitations,
    fingerprint: describeFingerprint(input),
  };
}

/** True when a description no longer matches the model it is shown next to. */
export function isProductDescriptionStale(
  description: ProductDescription,
  currentFingerprint: string,
): boolean {
  return description.fingerprint !== currentFingerprint;
}

/** Fingerprint of the inputs a description is built from. */
export function productDescriptionFingerprint(input: ProductDescriptionInput): string {
  return describeFingerprint(input);
}

/** Render the description as Markdown for the product package. */
export function productDescriptionMarkdown(description: ProductDescription): string {
  const section = (title: string, lines: readonly string[]): string[] =>
    lines.length === 0 ? [] : [`## ${title}`, '', ...lines.map((line) => `- ${line}`), ''];
  return [
    `# ${description.name}`,
    '',
    `_Model type: ${description.localName} (${description.name})_`,
    '',
    description.purpose,
    '',
    '## Features',
    '',
    ...description.features.map((line) => `- ${line}`),
    '',
    ...section('Dimensions', description.dimensions),
    ...section('Materials', description.materials),
    ...section('Included documents', description.documents),
    ...section('Limitations and what was not verified', description.limitations),
    'This document describes a parametric model. It is not a certificate, a load rating, or a statement of manufacturing readiness.',
    '',
  ].join('\n');
}
