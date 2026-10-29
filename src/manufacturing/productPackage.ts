/**
 * C8 — the product package.
 *
 * The C1 archive contract is frozen: `buildManufacturingPackage` still emits
 * exactly `model.glb`, `BOM.csv`, `cutlist.csv`, `drawing.svg`, `meta.json` and
 * `README.txt`, and nothing here changes it. The commercial product package is a
 * *separate* archive so a shop that consumed the C1 ZIP keeps getting the same
 * six files, while a buyer gets one bundle with everything.
 *
 * This module composes the existing builders — it does not recompute a BOM, a
 * drawing, an assembly plan or a sheet layout of its own. If two documents in the
 * bundle disagreed, one of them would have to be wrong, and that can only happen
 * if a second implementation existed.
 *
 * Verification is not "the call returned without throwing". {@link verifyProductExports}
 * unzips the archive it just built and checks the entry list and byte lengths;
 * `fflate` verifies each entry's CRC while inflating, so a corrupt archive fails
 * here instead of at the customer.
 */
import { strToU8, unzipSync, zipSync } from 'fflate';
import { buildBom, type BomResult } from './bom';
import { buildCutList, type CutListResult } from './cutList';
import { buildFurnitureAssemblyPlan, type AssemblyPlan } from './assemblyInstructions';
import { buildCuttingPlan, type CuttingPlan, type SheetSettingsInput } from './cuttingPlan';
import { buildProductDescription, productDescriptionMarkdown } from './productDescription';
import { buildProductListing, type ProductListingInput } from './productListing';
import { PACKAGE_ENTRIES, buildManufacturingPackage, sceneForObject } from './manufacturingPackage';
import { bomToCsv, cutListToCsv } from './manufacturingExport';
import { groupByMaterial } from './sheetMaterial';
import {
  buildHardwareBom,
  hardwareCsv,
  validateHardwareSteps,
  type HardwareBom,
  type HardwareItem,
} from './hardware';
import {
  PRODUCT_PREVIEW_FILENAMES,
  isPngBytes,
  isProductPreviewFilename,
} from '../viewer/productPreviewViews';
import { createTechnicalDrawingSvg } from './technicalDrawing';
import { validateManufacturing, type ValidationReport } from './validation';
import type { ReadinessCheck } from './productReadiness';
import { exportSceneToGlb } from '../export/sceneExport';
import { nameDigest, slugifyName } from '../export/exportNaming';
import type { SceneData, SceneObject } from '../scene/types';
import { FURNITURE_TYPE_LABELS, type FurnitureType } from '../geometry/furniture/types';

/**
 * Entries of the C8 product bundle, in a stable order.
 *
 * `document.pdf` alone already carries the drawing, BOM, cut list, materials,
 * validation, assembly instructions and the cutting layout; the individual files
 * are included so a shop can feed one of them into its own tooling instead of
 * re-keying from a PDF.
 */
export const PRODUCT_PACKAGE_ENTRIES = [
  'README.txt',
  'product-description.md',
  'BOM.csv',
  'cutlist.csv',
  'materials.csv',
  'hardware.csv',
  'drawing.svg',
  'assembly.txt',
  'cutting-plan.csv',
  'validation.txt',
  'document.pdf',
  'meta.json',
  'model.glb',
] as const;

export type ProductPackageEntry = (typeof PRODUCT_PACKAGE_ENTRIES)[number];

/**
 * A preview image supplied by the caller.
 *
 * The package builder runs without a renderer, so images are produced by the
 * viewer and handed in as bytes. `name` must be one of the declared preview
 * filenames; anything else is rejected rather than written under an arbitrary
 * path.
 */
export interface ProductPreviewImage {
  name: string;
  bytes: Uint8Array;
}

/**
 * Entries for a package, including any previews that were supplied.
 *
 * The twelve base entries keep their order; previews follow, in the canonical
 * order from `PRODUCT_PREVIEW_VIEWS`. Without previews this is exactly
 * `PRODUCT_PACKAGE_ENTRIES`, so the established contract is unchanged for every
 * caller that does not take pictures.
 */
export function productPackageEntries(
  previews: readonly ProductPreviewImage[] = [],
): string[] {
  const names = new Set(previews.map((preview) => preview.name));
  const ordered = PRODUCT_PREVIEW_FILENAMES.filter((name) => names.has(name));
  return [...PRODUCT_PACKAGE_ENTRIES, ...ordered];
}

export const PRODUCT_PACKAGE_META_FORMAT = '3d-studio-ai-product-package';
export const PRODUCT_PACKAGE_META_VERSION = 2;

/** Thickness the C8 sample product is documented with. A user value, not a standard. */
export const DEFAULT_SAMPLE_THICKNESS_MM = 18;

export interface ProductPackageInput {
  scene: SceneData;
  object: SceneObject;
  projectName: string;
  /**
   * A C7 layout the user already computed. Used as-is, so the bundle contains the
   * same layout the reader saw rather than a second, possibly different one.
   */
  cuttingPlan?: CuttingPlan | null;
  /**
   * Sheet settings to compute a layout from when no plan was supplied. When both
   * are absent the bundle ships no layout and says so; no board size is invented.
   */
  cuttingSettings?: SheetSettingsInput | null;
  /**
   * Preview shots from the viewer. Optional: without them the archive is the
   * established twelve entries. An invalid image is a hard error, because a
   * package that silently drops or mislabels a picture is worse than one that
   * refuses.
   */
  previews?: readonly ProductPreviewImage[] | null;
  /**
   * Optional general listing metadata for `meta.json`. Nothing is invented:
   * seller, SKU, version, license and marketplace fields stay absent unless the
   * caller supplies them.
   */
  listing?: ProductListingInput | null;
  /**
   * Optional hardware supplied by the caller. Omitted means "not specified":
   * the package then carries one explicit not-specified row instead of an empty
   * table or an invented screw list.
   */
  hardware?: readonly HardwareItem[] | null;
  generatedAt?: Date;
}

export interface ProductPackage {
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
  mimeType: 'application/zip';
  /**
   * What was written. The names are `string` rather than the base union because a
   * package may also carry preview images; `PRODUCT_PACKAGE_ENTRIES` still
   * enumerates the twelve guaranteed members.
   */
  entries: Array<{ name: string; bytes: number }>;
  /** Every entry written, in archive order; compared against the zip on verification. */
  expectedEntries: readonly string[];
  totalParts: number;
  cutPieces: number;
  sheetCount: number;
  /** Files that could not be produced, with the reason, so a partial bundle is visible. */
  skipped: Array<{ name: ProductPackageEntry; reason: string }>;
}

export type ProductPackageOutcome =
  | { ok: true; product: ProductPackage; artifacts: ProductArtifacts }
  | { ok: false; reason: string };

/** Everything the bundle was assembled from, kept so verification can inspect it. */
export interface ProductArtifacts {
  bom: BomResult;
  cutList: CutListResult;
  validation: ValidationReport;
  assembly: AssemblyPlan;
  cuttingPlan: CuttingPlan | null;
  drawing: { svg: string; scale: { ratio: string; standard: boolean }; overall: { widthMm: number; heightMm: number; depthMm: number } };
  hardware: HardwareBom;
  documentCount: number;
}

const DATE_ONLY = (date: Date): string => date.toISOString().slice(0, 10);

/** CSV cell escaping, matching the exporter's convention for free text. */
function cell(value: string | number | boolean | null): string {
  if (value === null) {
    return '';
  }
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(values: Array<string | number | boolean | null>): string {
  return values.map(cell).join(',');
}

/** `{slug}-{digest}-product.zip`, distinct from the C1 `-package.zip`. */
export function productPackageFilename(projectName: string): string {
  return `${slugifyName(projectName, 'model')}-${nameDigest(projectName)}-product.zip`;
}

/** Materials actually assigned, one row per material/thickness pair. */
export function materialsCsv(bom: BomResult): string {
  const lines = [
    csvRow([
      'Material',
      'materialId',
      'Nominal_qalinlik_mm',
      'Detallar',
      'partId',
      'Manba',
    ]),
  ];
  for (const group of groupByMaterial(bom.rows)) {
    lines.push(
      csvRow([
        group.name,
        group.materialId,
        group.thicknessMm,
        group.totalPieces,
        group.partIds.join(' '),
        'user',
      ]),
    );
  }
  if (lines.length === 1) {
    // An empty table would look like a rendering bug; say why it is empty.
    lines.push(csvRow(['Material tayinlanmagan', '', '', 0, '', '']));
  }
  return lines.join('\n');
}

/** Validation report as text, with every limitation, so nothing is dropped. */
export function validationReportText(validation: ValidationReport): string {
  const lines = [
    "Ishlab chiqarish tekshiruvi (C4)",
    `Xatolik: ${validation.counts.error} · Ogohlantirish: ${validation.counts.warning} · Malumot: ${validation.counts.info}`,
    '',
    'Daraja | Kod | Detal | Izoh',
  ];
  for (const issue of validation.issues) {
    lines.push(`${issue.level} | ${issue.code} | ${issue.partId ?? '-'} | ${issue.message}`);
  }
  lines.push('', 'Cheklovlar (tekshirilmagan jihatlar):');
  for (const limitation of validation.limitations) {
    lines.push(`- ${limitation}`);
  }
  lines.push(
    '',
    'Bu hisobot konstruktiv mustahkamlik yoki ishlab chiqarishga yaroqlilik sertifikati emas.',
  );
  return lines.join('\n');
}

/** Assembly instructions as text, including the gaps the model cannot fill. */
export function assemblyText(plan: AssemblyPlan): string {
  const lines = [
    `Montaj yo'riqnomasi — ${plan.modelLabel}`,
    `Holat: ${plan.status}`,
    '',
  ];
  if (plan.steps.length === 0) {
    lines.push("Ishonchli qadamlar tuzilmadi.");
  }
  for (const step of plan.steps) {
    lines.push(`${step.order}. ${step.title} [${step.relation}]`);
    lines.push(`   ${step.instruction}`);
    for (const part of step.parts) {
      const size = part.sizeMm
        ? `${part.sizeMm.x}x${part.sizeMm.y}x${part.sizeMm.z} mm`
        : "o'lcham noaniq";
      lines.push(`   - ${part.name} (${part.partId}) x ${part.quantity} — ${size}`);
    }
    if (step.dependsOn.length > 0) {
      lines.push(`   Avval bajarilishi kerak: ${step.dependsOn.join(', ')}`);
    }
  }
  lines.push('', 'Cheklovlar:');
  for (const limitation of plan.limitations) {
    lines.push(`- ${limitation}`);
  }
  return lines.join('\n');
}

/**
 * Sheet layout as CSV: one row per placed piece, plus one row per unplaced group.
 *
 * `status` distinguishes the two so a consumer cannot mistake an unplaced piece
 * for a placement with empty coordinates.
 */
export function cuttingPlanCsv(plan: CuttingPlan | null): string {
  const lines = [
    csvRow([
      'status',
      'sheet',
      'Material',
      'Qalinlik_mm',
      'partId',
      'Nomi',
      'Soni',
      'x_mm',
      'y_mm',
      'Kenglik_mm',
      'Balandlik_mm',
      'Aylantirilgan',
    ]),
  ];
  if (!plan) {
    lines.push(csvRow(['hisoblanmagan', '', '', '', '', '', '', '', '', '', '', '']));
    return lines.join('\n');
  }
  for (const group of plan.groups) {
    for (const sheet of group.sheets) {
      for (const piece of sheet.placements) {
        lines.push(
          csvRow([
            'joylashtirilgan',
            `${group.name} #${sheet.index}`,
            group.name,
            group.thicknessMm,
            piece.partId,
            piece.name,
            1,
            piece.xMm,
            piece.yMm,
            piece.widthMm,
            piece.heightMm,
            piece.rotated ? 'ha' : "yo'q",
          ]),
        );
      }
    }
  }
  for (const piece of plan.unplaced) {
    lines.push(
      csvRow([
        `joylashtirilmagan: ${piece.reason}`,
        '',
        '',
        piece.thicknessMm,
        piece.partId,
        piece.name,
        piece.quantity,
        '',
        '',
        piece.lengthMm,
        piece.widthMm,
        '',
      ]),
    );
  }
  return lines.join('\n');
}

function buildProductMeta(input: {
  projectName: string;
  type: FurnitureType;
  generatedAt: Date;
  overallMm: { widthMm: number; heightMm: number; depthMm: number };
  bom: BomResult;
  cutList: CutListResult;
  validation: ValidationReport;
  assembly: AssemblyPlan;
  cuttingPlan: CuttingPlan | null;
  hardware: HardwareBom;
  entries: readonly string[];
  previews: readonly string[];
  skipped: readonly { name: ProductPackageEntry; reason: string }[];
  listing?: ProductListingInput | null;
}): string {
  return JSON.stringify(
    {
      format: PRODUCT_PACKAGE_META_FORMAT,
      version: PRODUCT_PACKAGE_META_VERSION,
      project: input.projectName.trim() || 'Nomsiz loyiha',
      listing: buildProductListing({
        projectName: input.projectName,
        type: input.type,
        overallMm: input.overallMm,
        entries: input.entries,
        listing: input.listing,
      }),
      furnitureType: input.type,
      furnitureTypeLabel: FURNITURE_TYPE_LABELS[input.type],
      exportedAt: input.generatedAt.toISOString(),
      unit: 'mm',
      entries: input.entries,
      previews: input.previews,
      skipped: input.skipped,
      bom: {
        partTypes: input.bom.rows.length,
        totalParts: input.bom.totalParts,
        panelAreaM2: input.bom.panelAreaM2,
      },
      cutList: {
        rows: input.cutList.rows.length,
        pieces: input.cutList.totalPieces,
        panelAreaM2: input.cutList.panelAreaM2,
      },
      validation: {
        ok: input.validation.ok,
        errors: input.validation.counts.error,
        warnings: input.validation.counts.warning,
      },
      assembly: {
        status: input.assembly.status,
        steps: input.assembly.steps.length,
      },
      hardware: {
        specified: input.hardware.specified,
        items: input.hardware.items.length,
        totalPieces: input.hardware.totalPieces,
        limitations: input.hardware.limitations,
        list: input.hardware.items.map((item) => ({
          kind: item.kind,
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          size: item.size,
          note: item.note ?? null,
          stepIds: item.stepIds ?? [],
          stepLabels: (item.stepIds ?? []).map((id) => {
            const step = input.assembly.steps.find((entry) => entry.id === id);
            return step ? `${step.order}. ${step.title}` : `${id} (noma'lum qadam)`;
          }),
        })),
      },
      cutting: input.cuttingPlan
        ? {
            status: input.cuttingPlan.status,
            sheets: input.cuttingPlan.summary.sheetCount,
            placed: input.cuttingPlan.summary.placedCount,
            unplaced: input.cuttingPlan.summary.unplacedCount,
            wastePercent: input.cuttingPlan.summary.wastePercent,
            sheetLengthMm: input.cuttingPlan.settings.sheetLengthMm,
            sheetWidthMm: input.cuttingPlan.settings.sheetWidthMm,
            kerfMm: input.cuttingPlan.settings.kerfMm,
          }
        : null,
      limitations: [
        'Bu paket model ma’lumotlaridan avtomatik tuzildi.',
        'Konstruktiv mustahkamlik, yuk ko‘tarish va standartlarga muvofiqlik tekshirilmagan.',
        'Kesish rejasi evristik — optimal kesim kafolatlanmaydi.',
      ],
    },
    null,
    2,
  );
}

function buildProductReadme(input: {
  projectName: string;
  type: FurnitureType;
  bom: BomResult;
  cutList: CutListResult;
  validation: ValidationReport;
  assembly: AssemblyPlan;
  cuttingPlan: CuttingPlan | null;
  hardware: HardwareBom;
  /** Every entry in the archive, including previews. */
  entries: readonly string[];
  skipped: readonly { name: ProductPackageEntry; reason: string }[];
}): string {
  const name = input.projectName.trim() || 'Nomsiz loyiha';
  const lines = [
    'AI 3D Studio — mahsulot paketi',
    '',
    `Loyiha: ${name}`,
    `Mebel turi: ${FURNITURE_TYPE_LABELS[input.type]} (${input.type})`,
    '',
    'Paket tarkibi:',
  ];
  for (const entry of input.entries) {
    lines.push(`- ${entry}`);
  }
  if (input.skipped.length > 0) {
    lines.push('', 'Yaratilmagan fayllar:');
    for (const item of input.skipped) {
      lines.push(`- ${item.name}: ${item.reason}`);
    }
  }
  lines.push(
    '',
    `Detallar: ${input.bom.rows.length} tur · ${input.bom.totalParts} dona`,
    `Kesish: ${input.cutList.totalPieces} panel · ${input.cutList.panelAreaM2} m2`,
    `Tekshiruv: ${input.validation.counts.error} xatolik · ${input.validation.counts.warning} ogohlantirish`,
    `Montaj: ${input.assembly.steps.length} qadam (${input.assembly.status})`,
    input.hardware.specified
      ? `Furnitura: ${input.hardware.items.length} yozuv${input.hardware.totalPieces === null ? ", soni qisman" : `, ${input.hardware.totalPieces} dona`}`
      : "Furnitura: ko'rsatilmagan (modelda birikma ma'lumoti yo'q).",
  );
  if (input.cuttingPlan) {
    lines.push(
      `Kesish rejasi: ${input.cuttingPlan.summary.sheetCount} list · chiqindi ${input.cuttingPlan.summary.wastePercent}% · joylashtirilmagan ${input.cuttingPlan.summary.unplacedCount}`,
    );
  } else {
    lines.push('Kesish rejasi: hisoblanmagan (paketda list sxemasi yo‘q).');
  }
  lines.push(
    '',
    'MUHIM: bu paket ishlab chiqarishga yaroqlilik, konstruktiv mustahkamlik yoki',
    'standartga muvofiqlik sertifikati EMAS. Har bir o‘lcham, material va birikma',
    'sexda mustaqil tekshirilishi kerak.',
    '',
  );
  return lines.join('\n');
}

/**
 * Build the C8 product bundle.
 *
 * The C1 archive is built by the same code path as before and is left untouched;
 * this function adds the surrounding documents. A file that cannot be produced is
 * listed in `skipped` with its reason, and the bundle is still returned — a
 * partial package is reported as partial, never as complete.
 */
export async function buildProductPackage(
  input: ProductPackageInput,
): Promise<ProductPackageOutcome> {
  const { scene, object, projectName } = input;

  if (!scene.objects.some((entry) => entry.id === object.id)) {
    return { ok: false, reason: "Tanlangan obyekt sahnada topilmadi." };
  }

  const bomOutcome = buildBom(object.type, object.params, object.sheetMaterials);
  if (!bomOutcome.ok) {
    return { ok: false, reason: bomOutcome.reason };
  }
  const bom = bomOutcome.bom;

  const cutList = buildCutList(bom);
  if (cutList.rows.length === 0) {
    // Same rule the C1 package applies: an upholstered block has nothing a shop
    // could saw, so inventing cut rows would hand over an unusable document.
    return {
      ok: false,
      reason:
        'Kesish royxati bosh: bu mebelning hech bir detali yupqa panel emas, ' +
        'shuning uchun mahsulot paketi tuzilmadi.',
    };
  }

  const generatedAt = input.generatedAt ?? new Date();
  const validation = validateManufacturing(object.type, object.params, object.sheetMaterials);

  const drawing = createTechnicalDrawingSvg(object.type, object.params, {
    title: projectName.trim() !== '' ? projectName : FURNITURE_TYPE_LABELS[object.type],
    date: DATE_ONLY(generatedAt),
  });
  if (!drawing.ok) {
    return { ok: false, reason: drawing.reason };
  }

  const assembly = buildFurnitureAssemblyPlan({ bom, validation });

  const hardwareOutcome = buildHardwareBom(input.hardware ?? []);
  if (!hardwareOutcome.ok) {
    return { ok: false, reason: hardwareOutcome.reason };
  }
  const hardware = hardwareOutcome.hardware;
  const hardwareStepErrors = validateHardwareSteps(hardware, assembly.steps);
  if (hardwareStepErrors.length > 0) {
    return { ok: false, reason: hardwareStepErrors.join(' ') };
  }

  // A supplied plan wins: it is the layout the reader is looking at. Otherwise
  // compute from the user's settings, and if there are none, ship no layout.
  let cuttingPlan: CuttingPlan | null = input.cuttingPlan ?? null;
  let cuttingFailure: string | null = null;
  if (!cuttingPlan && input.cuttingSettings) {
    const outcome = buildCuttingPlan({ cutList, bom, settings: input.cuttingSettings });
    if (outcome.ok) {
      cuttingPlan = outcome.plan;
    } else {
      cuttingFailure = outcome.reason;
    }
  }

  const skipped: Array<{ name: ProductPackageEntry; reason: string }> = [];
  if (!cuttingPlan) {
    skipped.push({
      name: 'cutting-plan.csv',
      reason: cuttingFailure ?? "kesish sozlamalari berilmagan — list sxemasi hisoblanmadi",
    });
  }

  let glb: ArrayBuffer;
  try {
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
    return { ok: false, reason: '3D model fayli bosh.' };
  }

  const documents = PRODUCT_PACKAGE_ENTRIES.filter((name) => name !== 'meta.json' && name !== 'README.txt');
  const description = buildProductDescription(
    {
      type: object.type,
      params: object.params,
      overallMm: drawing.overall,
      bom,
      cutList,
      validation,
      assembly,
      cuttingPlan,
    },
    documents,
  );

  // The PDF is built from the same objects the CSVs were written from, so the
  // bundle cannot contain a PDF that disagrees with its own parts list.
  const { buildManufacturingPdf } = await import('./pdfDocument');
  const pdf = await buildManufacturingPdf({
    type: object.type,
    params: object.params,
    projectName,
    bom,
    cutList,
    materials: groupByMaterial(bom.rows),
    validation,
    drawing: { svg: drawing.svg, scale: drawing.scale },
    overall: drawing.overall,
    assembly,
    cuttingPlan,
    hardware,
    generatedAt,
  });
  if (!pdf.ok) {
    return { ok: false, reason: `PDF yaratilmadi: ${pdf.reason}` };
  }

  // Preview validation happens before anything is written: a package that
  // silently skipped a bad image would look complete while showing nothing.
  const previews = input.previews ?? [];
  const seenPreviews = new Set<string>();
  for (const preview of previews) {
    if (!isProductPreviewFilename(preview.name)) {
      return {
        ok: false,
        reason: `Noma'lum preview fayli: "${preview.name}". Ruxsat etilganlar: ${PRODUCT_PREVIEW_FILENAMES.join(', ')}.`,
      };
    }
    if (seenPreviews.has(preview.name)) {
      return { ok: false, reason: `Preview fayli takrorlangan: "${preview.name}".` };
    }
    seenPreviews.add(preview.name);
    if (!isPngBytes(preview.bytes)) {
      return {
        ok: false,
        reason: `"${preview.name}" haqiqiy PNG emas yoki bo'sh — paketga qo'shilmadi.`,
      };
    }
  }

  const files: Record<string, Uint8Array> = {
    'model.glb': new Uint8Array(glb),
    'BOM.csv': strToU8(bomToCsv(bom)),
    'cutlist.csv': strToU8(cutListToCsv(cutList)),
    'materials.csv': strToU8(materialsCsv(bom)),
    'hardware.csv': strToU8(hardwareCsv(hardware, assembly.steps)),
    'drawing.svg': strToU8(drawing.svg),
    'assembly.txt': strToU8(assemblyText(assembly)),
    'cutting-plan.csv': strToU8(cuttingPlanCsv(cuttingPlan)),
    'validation.txt': strToU8(validationReportText(validation)),
    'document.pdf': new Uint8Array(pdf.bytes),
    'product-description.md': strToU8(productDescriptionMarkdown(description)),
    'meta.json': strToU8(
      buildProductMeta({
        projectName,
        type: object.type,
        generatedAt,
        overallMm: drawing.overall,
        bom,
        cutList,
        validation,
        assembly,
        cuttingPlan,
        hardware,
        entries: productPackageEntries(previews),
        previews: previews.map((preview) => preview.name),
        skipped,
        listing: input.listing,
      }),
    ),
    'README.txt': strToU8(
      buildProductReadme({
        projectName,
        type: object.type,
        bom,
        cutList,
        validation,
        assembly,
        cuttingPlan,
        hardware,
        entries: productPackageEntries(previews),
        skipped,
      }),
    ),
  };

  for (const preview of previews) {
    files[preview.name] = preview.bytes;
  }

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = zipSync(files, { level: 6, mtime: generatedAt }) as Uint8Array<ArrayBuffer>;
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error && error.message
          ? `Arxivni yigib bolmadi: ${error.message}`
          : 'Arxivni yigib bolmadi.',
    };
  }
  if (bytes.length === 0) {
    return { ok: false, reason: 'Arxiv bosh.' };
  }

  return {
    ok: true,
    product: {
      bytes,
      filename: productPackageFilename(projectName),
      mimeType: 'application/zip',
      entries: productPackageEntries(previews).map((name) => ({
        name,
        bytes: files[name].length,
      })),
      expectedEntries: productPackageEntries(previews),
      totalParts: bom.totalParts,
      cutPieces: cutList.totalPieces,
      sheetCount: cuttingPlan?.summary.sheetCount ?? 0,
      skipped,
    },
    artifacts: {
      bom,
      cutList,
      validation,
      assembly,
      cuttingPlan,
      drawing: { svg: drawing.svg, scale: drawing.scale, overall: drawing.overall },
      hardware,
      documentCount: documents.length,
    },
  };
}

export interface ExportVerificationInput extends ProductPackageInput {
  /** Also verify the frozen C1 archive, which the shop may still consume. */
  verifyC1Package?: boolean;
}

/**
 * Run the exports for real and inspect their output.
 *
 * Returns the same check shape as the structural assessment, so
 * {@link combineReadiness} can merge them into one verdict.
 */
export async function verifyProductExports(
  input: ExportVerificationInput,
): Promise<{ checks: ReadinessCheck[]; product: ProductPackage | null }> {
  const checks: ReadinessCheck[] = [];

  const outcome = await buildProductPackage(input);
  if (!outcome.ok) {
    checks.push({
      id: 'package',
      label: 'Mahsulot paketi (ZIP)',
      status: 'fail',
      detail: outcome.reason,
    });
    checks.push({
      id: 'package-integrity',
      label: 'Arxiv yaxlitligi',
      status: 'fail',
      detail: 'Arxiv yaratilmagani uchun tekshirilmadi.',
    });
    checks.push({
      id: 'pdf',
      label: 'PDF hujjati (C5)',
      status: 'fail',
      detail: 'PDF paket bilan birga yaratilmadi.',
    });
    return { checks, product: null };
  }

  const { product } = outcome;
  checks.push({
    id: 'package',
    label: 'Mahsulot paketi (ZIP)',
    status: product.skipped.length > 0 ? 'warning' : 'pass',
    detail:
      product.skipped.length > 0
        ? `Arxiv yaratildi (${product.bytes.length} bayt), lekin ${product.skipped.map((item) => item.name).join(', ')} yaratilmadi.`
        : `Arxiv yaratildi: ${product.entries.length} fayl, ${product.bytes.length} bayt.`,
  });

  // Unzipping is the integrity check: fflate verifies each entry's CRC while
  // inflating, so a truncated or corrupted archive throws here.
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(product.bytes);
  } catch (error) {
    checks.push({
      id: 'package-integrity',
      label: 'Arxiv yaxlitligi',
      status: 'fail',
      detail:
        error instanceof Error && error.message
          ? `Arxiv ochilmadi: ${error.message}`
          : 'Arxiv ochilmadi.',
    });
    checks.push({
      id: 'pdf',
      label: 'PDF hujjati (C5)',
      status: 'fail',
      detail: 'Arxiv ochilmagani uchun PDF tekshirilmadi.',
    });
    return { checks, product };
  }

  const present = new Set(Object.keys(unzipped));
  // Everything the bundle claims to contain, previews included.
  const expected = [...product.expectedEntries].sort();
  const missing = expected.filter((name) => !present.has(name));
  const empty = expected.filter((name) => present.has(name) && unzipped[name].length === 0);

  // Every preview must still be a readable PNG after the round trip, not just
  // present: a truncated image would look like a successful package.
  const brokenPreviews = PRODUCT_PREVIEW_FILENAMES.filter(
    (name) => present.has(name) && !isPngBytes(unzipped[name]),
  );

  if (missing.length > 0 || empty.length > 0 || brokenPreviews.length > 0) {
    checks.push({
      id: 'package-integrity',
      label: 'Arxiv yaxlitligi',
      status: 'fail',
      detail: [
        missing.length > 0 ? `yetishmayotgan: ${missing.join(', ')}` : null,
        empty.length > 0 ? `bosh fayl: ${empty.join(', ')}` : null,
        brokenPreviews.length > 0 ? `PNG emas: ${brokenPreviews.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join('; '),
    });
  } else {
    checks.push({
      id: 'package-integrity',
      label: 'Arxiv yaxlitligi',
      status: 'pass',
      detail: `${expected.length} fayl joyida, CRC tekshirildi, hech biri bosh emas.`,
    });
  }

  const pdfBytes = unzipped['document.pdf'];
  const isPdf =
    pdfBytes !== undefined &&
    pdfBytes.length > 4 &&
    String.fromCharCode(...pdfBytes.slice(0, 4)) === '%PDF';
  checks.push({
    id: 'pdf',
    label: 'PDF hujjati (C5)',
    status: isPdf ? 'pass' : 'fail',
    detail: isPdf
      ? `PDF paketda: ${pdfBytes.length} bayt.`
      : 'PDF paketda topilmadi yoki yaroqsiz.',
  });

  if (input.verifyC1Package) {
    // Statically imported above: the C1 builder is already in this module's
    // dependency graph (for `PACKAGE_ENTRIES` and `sceneForObject`), so a dynamic
    // import here could never move it to a separate chunk — it only produced an
    // "ineffective dynamic import" build warning.
    const c1 = await buildManufacturingPackage({
      scene: input.scene,
      object: input.object,
      projectName: input.projectName,
      generatedAt: input.generatedAt,
    });
    if (!c1.ok) {
      checks.push({
        id: 'c1-package',
        label: 'C1 arxivi',
        status: 'fail',
        detail: c1.reason,
      });
    } else {
      const c1Names = Object.keys(unzipSync(c1.package.bytes)).sort();
      const c1Expected = [...PACKAGE_ENTRIES].sort();
      const matches =
        c1Names.length === c1Expected.length &&
        c1Expected.every((name, index) => c1Names[index] === name);
      checks.push({
        id: 'c1-package',
        label: 'C1 arxivi',
        status: matches ? 'pass' : 'fail',
        detail: matches
          ? `C1 arxivi o‘zgarmagan: ${c1Expected.length} fayl.`
          : `C1 arxivi tarkibi kutilganidan farq qiladi: ${c1Names.join(', ')}.`,
      });
    }
  }

  return { checks, product };
}
