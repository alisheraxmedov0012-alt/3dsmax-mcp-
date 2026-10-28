/**
 * C8 — product readiness.
 *
 * Answers one question with evidence: can this model be handed over as a product
 * package? It does so by running the existing C1–C7 pipelines and inspecting what
 * they actually produced. It never re-implements them, and it never reads UI
 * text — every check is a domain check with a machine-readable id.
 *
 * ## Status meanings
 *
 * - `pass` — the required condition holds. For an export check this means the
 *   artifact was built *and* inspected (entry list, byte length, CRC).
 * - `warning` — the package can be produced, but something a buyer should know
 *   about is missing or unverified. A warning is never reported as a pass; the
 *   aggregate result keeps it visible.
 * - `fail` — a required condition does not hold. The package must not be
 *   presented as complete; the check names what is missing and why.
 * - `not_applicable` — the check does not apply to this model at all (a sofa has
 *   no thin panels, so it has no cut list). Distinct from `pass`: nothing was
 *   verified, so it must not be counted as success.
 *
 * ## Two layers
 *
 * {@link assessProductReadiness} is synchronous and structural: parameters, BOM,
 * part identity, materials, validation, drawing, assembly and cutting. It is pure
 * and cheap, which is what makes it directly testable.
 *
 * {@link verifyProductExports} is asynchronous and does the expensive thing for
 * real: build the ZIP and the PDF, then unzip the archive and assert its contents.
 * `fflate`'s `unzipSync` verifies each entry's CRC while inflating, so a corrupt
 * archive fails rather than silently passing.
 *
 * {@link combineReadiness} merges the two into one report.
 */
import { buildBom, type BomResult } from './bom';
import { buildCutList, type CutListResult } from './cutList';
import { buildFurnitureAssemblyPlan, type AssemblyPlan } from './assemblyInstructions';
import {
  CUTTING_PLAN_LIMITATIONS,
  UNPLACED_REASON_LABELS,
  buildCuttingPlan,
  type CuttingPlan,
  type SheetSettingsInput,
} from './cuttingPlan';
import { validateManufacturing, type ValidationReport } from './validation';
import { createTechnicalDrawingSvg } from './technicalDrawing';
import { validateFurnitureParams } from '../geometry/furniture/params';
import {
  FURNITURE_FIELDS,
  FURNITURE_TYPE_LABELS,
  type FurnitureParams,
  type FurnitureType,
} from '../geometry/furniture/types';
import type { SheetMaterialEntry } from './sheetMaterial';
import { nameDigest } from '../export/exportNaming';

/** Outcome vocabulary for a single check. See the module comment for the rules. */
export type ReadinessStatus = 'pass' | 'warning' | 'fail' | 'not_applicable';

export const READINESS_STATUS_ORDER: readonly ReadinessStatus[] = [
  'fail',
  'warning',
  'pass',
  'not_applicable',
];

export const READINESS_STATUS_LABELS: Record<ReadinessStatus, string> = {
  pass: 'Tayyor',
  warning: 'Ogohlantirish',
  fail: 'Xato',
  not_applicable: "Qo'llanmaydi",
};

export type ReadinessCheckId =
  | 'model-params'
  | 'bom'
  | 'part-ids'
  | 'materials'
  | 'validation'
  | 'drawing'
  | 'assembly'
  | 'cutting'
  | 'package'
  | 'package-integrity'
  | 'pdf'
  | 'c1-package';

/**
 * Machine-readable reason for the cutting check.
 *
 * The five outcomes the audit asked to keep apart, so no caller has to infer them
 * from prose:
 *
 * - `not-sheet-goods`      — this furniture type builds no panel-shaped parts at
 *                            all (a sofa), so nesting cannot apply.
 * - `parameter-excludes-panels` — a panel-shaped part exists but a parameter put
 *                            it past the board rule, so it left the cut list.
 * - `no-material`          — a board material has not been assigned yet.
 * - `not-computed`         — no layout was requested, so there is nothing to show.
 * - `layout-failed`        — a layout was requested and could not be produced.
 * - `thickness-mismatch`   — the layout was produced from a nominal board whose
 *                            thickness disagrees with a cut-list part, so the
 *                            package is not manufacturing-ready.
 * - `partially-placed`     — a layout exists but some pieces did not fit.
 * - `complete`             — every piece was placed.
 */
export type CuttingReason =
  | 'not-sheet-goods'
  | 'parameter-excludes-panels'
  | 'no-material'
  | 'not-computed'
  | 'layout-failed'
  | 'thickness-mismatch'
  | 'partially-placed'
  | 'complete';

/** Short human label per cutting reason, for the panel. */
export const CUTTING_REASON_LABELS: Record<CuttingReason, string> = {
  'not-sheet-goods': 'Bu tur list materialidan qurilmaydi',
  'parameter-excludes-panels': "Parametr panelni list chegarasidan chiqargan",
  'no-material': "Material tanlanmagan",
  'not-computed': 'Kesish rejasi hali hisoblanmagan',
  'layout-failed': 'Kesish rejasi tuzilmadi',
  'thickness-mismatch': "Material qalinligi geometriyaga mos emas",
  'partially-placed': "Ayrim detallar listga sig'madi",
  complete: "To'liq joylashtirildi",
};

export interface ReadinessCheck {
  id: ReadinessCheckId;
  /** Short human label, in the app's language. */
  label: string;
  status: ReadinessStatus;
  /** What was observed, stated concretely (counts, ids, byte sizes). */
  detail: string;
  /**
   * C8.6.2: why the cutting check reached its status. Optional and only set on
   * the cutting check, so existing consumers that read `status`/`detail` are
   * unaffected.
   */
  reason?: CuttingReason;
}

export interface ReadinessResult {
  /** Worst status across all checks. */
  status: ReadinessStatus;
  checks: ReadinessCheck[];
  counts: Record<ReadinessStatus, number>;
  /** Details of every `fail` check, for a caller that needs one-line reasons. */
  blockers: string[];
  /** Digest of the model state this result describes. */
  fingerprint: string;
}

export interface ProductReadinessInput {
  type: FurnitureType;
  params: FurnitureParams;
  sheetMaterials?: readonly SheetMaterialEntry[] | null;
  /**
   * Sheet settings for the C7 layout. When omitted, the cutting check reports
   * that no layout was produced rather than silently inventing board sizes.
   */
  cuttingSettings?: SheetSettingsInput | null;
  /** A layout the caller already computed; used instead of recomputing. */
  cuttingPlan?: CuttingPlan | null;
  /** Instructions the caller already computed; used instead of recomputing. */
  assemblyPlan?: AssemblyPlan | null;
}

/** Worst status wins: fail > warning > not_applicable > pass. */
function worstStatus(statuses: readonly ReadinessStatus[]): ReadinessStatus {
  if (statuses.includes('fail')) {
    return 'fail';
  }
  if (statuses.includes('warning')) {
    return 'warning';
  }
  // Only reachable when every check is `not_applicable` or all pass.
  if (statuses.length > 0 && statuses.every((status) => status === 'not_applicable')) {
    return 'not_applicable';
  }
  return 'pass';
}

function countStatuses(checks: readonly ReadinessCheck[]): Record<ReadinessStatus, number> {
  const counts: Record<ReadinessStatus, number> = {
    pass: 0,
    warning: 0,
    fail: 0,
    not_applicable: 0,
  };
  for (const check of checks) {
    counts[check.status] += 1;
  }
  return counts;
}

/** Digest of the model state a readiness report describes. */
export function readinessFingerprint(input: {
  type: FurnitureType;
  params: FurnitureParams;
  sheetMaterials?: readonly SheetMaterialEntry[] | null;
}): string {
  const params = Object.keys(input.params)
    .filter((key) => key !== 'color')
    .sort()
    .map((key) => `${key}=${String((input.params as unknown as Record<string, unknown>)[key])}`)
    .join('&');
  const materials = (input.sheetMaterials ?? [])
    .map((entry) => `${entry.partId}:${entry.materialId}@${entry.thicknessMm}`)
    .sort()
    .join('|');
  return nameDigest(`${input.type}|${params}|${materials}`);
}

/** Assemble a report from a finished set of checks. */
export function summarizeReadiness(
  checks: readonly ReadinessCheck[],
  fingerprint: string,
): ReadinessResult {
  const status = worstStatus(checks.map((check) => check.status));
  return {
    status,
    checks: [...checks],
    counts: countStatuses(checks),
    blockers: checks.filter((check) => check.status === 'fail').map((check) => check.detail),
    fingerprint,
  };
}

function checkModelParams(input: ProductReadinessInput): ReadinessCheck {
  const validated = validateFurnitureParams(input.type, input.params);
  if (!validated) {
    return {
      id: 'model-params',
      label: 'Model parametrlari',
      status: 'fail',
      detail: "Parametrlar yaroqsiz yoki yetishmayapti — hujjatlar tuzilmaydi.",
    };
  }
  return {
    id: 'model-params',
    label: 'Model parametrlari',
    status: 'pass',
    detail: `Parametrlar yaroqli (${FURNITURE_TYPE_LABELS[input.type]}).`,
  };
}

function checkBom(bom: BomResult | null, error: string | null): ReadinessCheck {
  if (!bom) {
    return {
      id: 'bom',
      label: 'Detallar ro‘yxati (BOM)',
      status: 'fail',
      detail: error ?? "BOM tuzilmadi.",
    };
  }
  if (bom.rows.length === 0 || bom.totalParts === 0) {
    return {
      id: 'bom',
      label: 'Detallar ro‘yxati (BOM)',
      status: 'fail',
      detail: 'BOM bosh — modelda o‘lchanadigan detal yo‘q.',
    };
  }
  return {
    id: 'bom',
    label: 'Detallar ro‘yxati (BOM)',
    status: 'pass',
    detail: `${bom.rows.length} tur · ${bom.totalParts} dona detal.`,
  };
}

/**
 * Part identity and quantity integrity.
 *
 * A duplicated `partId` would make two different rows address the same part, and
 * a non-positive quantity would make the cut list and the sheet layout disagree
 * with the BOM. Both are checked here rather than assumed.
 */
function checkPartIds(bom: BomResult | null): ReadinessCheck {
  if (!bom) {
    return {
      id: 'part-ids',
      label: 'Detal identifikatorlari',
      status: 'fail',
      detail: 'BOM yo‘q — identifikatorlarni tekshirib bo‘lmaydi.',
    };
  }
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const row of bom.rows) {
    if (row.partId.trim() === '') {
      problems.push(`bo'sh partId (${row.name})`);
      continue;
    }
    if (seen.has(row.partId)) {
      problems.push(`takroriy partId: ${row.partId}`);
    }
    seen.add(row.partId);
    if (!Number.isInteger(row.quantity) || row.quantity <= 0) {
      problems.push(`${row.partId}: noto'g'ri son (${row.quantity})`);
    }
    if (row.sizeMm.x <= 0 || row.sizeMm.y <= 0 || row.sizeMm.z <= 0) {
      problems.push(`${row.partId}: o'lcham noldan katta emas`);
    }
  }
  if (problems.length > 0) {
    return {
      id: 'part-ids',
      label: 'Detal identifikatorlari',
      status: 'fail',
      detail: problems.join('; '),
    };
  }
  return {
    id: 'part-ids',
    label: 'Detal identifikatorlari',
    status: 'pass',
    detail: `${bom.rows.length} ta noyob partId, sonlar va o‘lchamlar yaroqli.`,
  };
}

function checkMaterials(bom: BomResult | null): ReadinessCheck {
  if (!bom) {
    return {
      id: 'materials',
      label: 'Materiallar',
      status: 'fail',
      detail: 'BOM yo‘q — materiallar holatini aniqlab bo‘lmaydi.',
    };
  }
  const assigned = bom.rows.filter((row) => row.material !== null);
  const missing = bom.rows.filter((row) => row.material === null);
  if (missing.length === 0) {
    return {
      id: 'materials',
      label: 'Materiallar',
      status: 'pass',
      detail: `Barcha ${bom.rows.length} tur detalga material tayinlangan.`,
    };
  }
  if (assigned.length === 0) {
    return {
      id: 'materials',
      label: 'Materiallar',
      status: 'warning',
      detail:
        'Hech bir detalga material tayinlanmagan — BOM va kesish ro‘yxati material ustuni bo‘sh, kesish rejasi tuzilmaydi.',
    };
  }
  return {
    id: 'materials',
    label: 'Materiallar',
    status: 'warning',
    detail: `Material tayinlanmagan detallar: ${missing.map((row) => row.partId).join(', ')}.`,
  };
}

function checkValidation(report: ValidationReport): ReadinessCheck {
  if (report.counts.error > 0) {
    return {
      id: 'validation',
      label: 'Ishlab chiqarish tekshiruvi (C4)',
      status: 'fail',
      detail: `${report.counts.error} xatolik — model tekshiruvdan o‘tmagan.`,
    };
  }
  if (report.counts.warning > 0) {
    return {
      id: 'validation',
      label: 'Ishlab chiqarish tekshiruvi (C4)',
      status: 'warning',
      detail: `Xatolik yo‘q, ${report.counts.warning} ogohlantirish bor.`,
    };
  }
  return {
    id: 'validation',
    label: 'Ishlab chiqarish tekshiruvi (C4)',
    status: 'pass',
    detail: 'Xatolik va ogohlantirish yo‘q.',
  };
}

function checkDrawing(drawingOk: boolean, detail: string | null): ReadinessCheck {
  if (!drawingOk) {
    return {
      id: 'drawing',
      label: 'Texnik chizma (C2)',
      status: 'fail',
      detail: detail ?? 'Texnik chizma yaratilmadi.',
    };
  }
  return {
    id: 'drawing',
    label: 'Texnik chizma (C2)',
    status: 'pass',
    detail: 'O‘lchamli chizma yaratildi.',
  };
}

function checkAssembly(plan: AssemblyPlan | null): ReadinessCheck {
  if (!plan) {
    return {
      id: 'assembly',
      label: 'Montaj yo‘riqnomasi (C6)',
      status: 'fail',
      detail: 'Montaj rejasi tuzilmadi.',
    };
  }
  if (plan.steps.length === 0 || plan.status === 'unsupported') {
    return {
      id: 'assembly',
      label: 'Montaj yo‘riqnomasi (C6)',
      status: 'fail',
      detail:
        plan.issues.find((issue) => issue.level === 'error')?.message ??
        'Bu model uchun ishonchli montaj qadamlari tuzilmadi.',
    };
  }
  if (plan.status === 'limited') {
    return {
      id: 'assembly',
      label: 'Montaj yo‘riqnomasi (C6)',
      status: 'warning',
      detail: `${plan.steps.length} qadam, lekin reja qisman (${plan.issues.filter((issue) => issue.level !== 'info').length} eslatma).`,
    };
  }
  return {
    id: 'assembly',
    label: 'Montaj yo‘riqnomasi (C6)',
    status: 'pass',
    detail: `${plan.steps.length} tartiblangan qadam.`,
  };
}

function checkCutting(
  cutList: CutListResult | null,
  plan: CuttingPlan | null,
  requested: boolean,
  thicknessBlocks: readonly string[] = [],
): ReadinessCheck {
  const label = 'Material sarfi va kesish rejasi (C7)';
  if (!cutList || cutList.rows.length === 0) {
    // No cut list. Two different situations end up here and must not be conflated:
    //
    // - the piece is not sheet goods by construction (a sofa's 8 cm back), so
    //   nesting genuinely cannot apply — `not_applicable`;
    // - a parameter chose a thickness past the board rule, so the part dropped out
    //   of the cut list. That is fixable by the user and must be named — `fail`.
    if (thicknessBlocks.length > 0) {
      return {
        id: 'cutting',
        label,
        status: 'fail',
        reason: 'parameter-excludes-panels',
        detail: `${thicknessBlocks.join(' ')} Kesish rejasi tuzilmadi, shuning uchun paketda list sxemasi bo‘lmaydi.`,
      };
    }
    // Genuinely nothing to nest. Saying "pass" here would claim a layout that
    // cannot exist.
    return {
      id: 'cutting',
      label,
      status: 'not_applicable',
      reason: 'not-sheet-goods',
      detail: 'Panel detali yo‘q — kesish rejasi bu modelga qo‘llanmaydi.',
    };
  }
  if (!requested) {
    return {
      id: 'cutting',
      label,
      status: 'warning',
      reason: 'not-computed',
      detail: 'Kesish rejasi hali hisoblanmagan — paketda list sxemasi bo‘lmaydi.',
    };
  }
  if (!plan) {
    return {
      id: 'cutting',
      label,
      status: 'warning',
      reason: 'not-computed',
      detail: 'Kesish rejasi hisoblanmadi (natija berilmagan).',
    };
  }
  // A plan computed from a nominal board that disagrees with a cut-list part is
  // not a layout a shop can cut: the placement exists, but the part thickness is
  // wrong. This is a blocker, not a cosmetic warning, so the package must not be
  // presented as manufacturing-ready.
  const thicknessMismatches = plan.issues.filter((issue) => issue.code === 'thickness-mismatch');
  if (thicknessMismatches.length > 0) {
    return {
      id: 'cutting',
      label,
      status: 'fail',
      reason: 'thickness-mismatch',
      detail: `${thicknessMismatches.map((issue) => issue.message).join(' ')} Kesish rejasi nominal qalinlik bo‘yicha tuzilgan, shuning uchun paket ishlab chiqarishga tayyor emas.`,
    };
  }
  if (plan.status === 'unavailable') {
    // "Nothing could be placed because nothing has a board yet" is a consequence
    // of the materials check above, not an independent defect: C3 keeps material
    // assignment optional, and the C1-C5 documents are still valid without it.
    // Any other reason (parts too large, invalid sizes) is a real layout failure.
    const onlyMissingMaterial =
      plan.unplaced.length > 0 && plan.unplaced.every((piece) => piece.reason === 'no-material');
    if (onlyMissingMaterial) {
      return {
        id: 'cutting',
        label,
        status: 'warning',
        reason: 'no-material',
        detail:
          'Material tayinlanmagani uchun kesish rejasi tuzilmadi — material tanlangandan keyin hisoblanadi.',
      };
    }
    return {
      id: 'cutting',
      label,
      status: 'fail',
      reason: 'layout-failed',
      detail:
        plan.issues.find((issue) => issue.level === 'error')?.message ??
        'Hech bir detal listga joylashtirilmadi.',
    };
  }
  if (plan.status === 'partial') {
    const reasons = [...new Set(plan.unplaced.map((piece) => UNPLACED_REASON_LABELS[piece.reason]))];
    return {
      id: 'cutting',
      label,
      status: 'fail',
      reason: 'partially-placed',
      detail: `${plan.summary.placedCount}/${plan.summary.pieceCount} detal joylashtirildi, ${plan.summary.unplacedCount} detal listga sig‘madi${reasons.length > 0 ? ` (${reasons.join(', ')})` : ''} — kesish rejasi to‘liq emas.`,
    };
  }
  return {
    id: 'cutting',
    label,
    status: 'pass',
    reason: 'complete',
    detail: `${plan.summary.sheetCount} list, ${plan.summary.placedCount} detal, chiqindi ${plan.summary.wastePercent}%.`,
  };
}

/**
 * Thickness exclusions a user could undo by changing a parameter.
 *
 * A part drops out of the cut list when it is thicker than the board rule. That is
 * only actionable when some declared parameter *is* that thickness (a table's
 * `topThicknessCm`); otherwise the thickness is inherent to how the type is built
 * (a sofa's upholstered back) and no edit would bring it back into the cut list.
 *
 * Returns the human-readable messages for the actionable cases only, so
 * `not_applicable` keeps its meaning: the feature cannot apply to this furniture,
 * not "the user picked a value the pipeline rejects".
 */
function parameterDrivenThicknessBlocks(
  type: FurnitureType,
  params: FurnitureParams,
  validation: ValidationReport,
): string[] {
  const specs = FURNITURE_FIELDS[type] ?? [];
  const messages: string[] = [];
  for (const entry of validation.issues) {
    if (entry.code !== 'panel-too-thick-for-cutlist') {
      continue;
    }
    const thickness = entry.details?.thicknessCm;
    if (typeof thickness !== 'number') {
      continue;
    }
    const fromParameter = specs.some((spec) => {
      const value = (params as unknown as Record<string, unknown>)[spec.key];
      return typeof value === 'number' && Math.abs(value - thickness) < 1e-6;
    });
    if (fromParameter) {
      messages.push(entry.message);
    }
  }
  return messages;
}

/**
 * Structural readiness: run the existing pipelines and judge their output.
 *
 * Pure and synchronous. Every branch that cannot verify something says so
 * explicitly instead of defaulting to a pass.
 */
export function assessProductReadiness(input: ProductReadinessInput): ReadinessResult {
  const checks: ReadinessCheck[] = [];
  checks.push(checkModelParams(input));

  const paramsValid = validateFurnitureParams(input.type, input.params);
  let bom: BomResult | null = null;
  let bomError: string | null = null;
  if (!paramsValid) {
    bomError = "Parametrlar yaroqsiz — BOM tuzilmadi.";
  } else {
    const outcome = buildBom(input.type, paramsValid, input.sheetMaterials);
    if (outcome.ok) {
      bom = outcome.bom;
    } else {
      bomError = outcome.reason;
    }
  }

  checks.push(checkBom(bom, bomError));
  checks.push(checkPartIds(bom));
  checks.push(checkMaterials(bom));

  const validation = validateManufacturing(input.type, input.params, input.sheetMaterials);
  checks.push(checkValidation(validation));

  const drawing = createTechnicalDrawingSvg(
    input.type,
    input.params,
    {
      title: FURNITURE_TYPE_LABELS[input.type],
      date: new Date(0).toISOString().slice(0, 10),
    },
  );
  checks.push(
    checkDrawing(
      drawing.ok && drawing.svg.includes('<svg'),
      drawing.ok ? null : drawing.reason,
    ),
  );

  const assembly =
    input.assemblyPlan ?? (bom ? buildFurnitureAssemblyPlan({ bom, validation }) : null);
  checks.push(checkAssembly(assembly));

  const cutList = bom ? buildCutList(bom) : null;
  let cuttingPlan = input.cuttingPlan ?? null;
  if (!cuttingPlan && cutList && cutList.rows.length > 0 && input.cuttingSettings) {
    const outcome = buildCuttingPlan({
      cutList,
      bom: bom ?? undefined,
      settings: input.cuttingSettings,
    });
    cuttingPlan = outcome.ok ? outcome.plan : null;
  }
  // "Requested" means the caller supplied a layout or the settings to make one.
  const cuttingRequested = Boolean(input.cuttingPlan) || Boolean(input.cuttingSettings);
  checks.push(
    checkCutting(
      cutList,
      cuttingPlan,
      cuttingRequested,
      parameterDrivenThicknessBlocks(input.type, input.params, validation),
    ),
  );

  return summarizeReadiness(
    checks,
    readinessFingerprint({
      type: input.type,
      params: input.params,
      sheetMaterials: input.sheetMaterials,
    }),
  );
}

export interface ProductReadiness extends ReadinessResult {
  /** True when the package may be described as a sellable first product package. */
  presentable: boolean;
  /** Limitations that apply to the aggregate verdict itself. */
  limitations: string[];
}

export const READINESS_LIMITATIONS: readonly string[] = [
  'Bu tekshiruv model ma’lumotlarining o‘zaro mosligini tekshiradi; u konstruktiv xavfsizlikni yoki sertifikatni tasdiqlamaydi.',
  'Avtomatik tekshiruvdan o‘tgan paket "sotuvga tayyorlash mumkin bo‘lgan dastlabki paket" hisoblanadi, ishlab chiqarishga mutlaqo tayyor degani emas.',
  'Mustaqil mebel mutaxassisi ko‘rigi va jismoniy prototip sinovi bu tekshiruvga kirmaydi.',
  'Kesish rejasi evristik — optimal kesim kafolatlanmaydi.',
];

/**
 * Merge structural checks with export verification into one verdict.
 *
 * `presentable` is deliberately strict: any `fail` blocks it, and a `warning`
 * keeps it visible rather than hiding it.
 */
export function combineReadiness(
  structural: ReadinessResult,
  exportChecks: readonly ReadinessCheck[],
): ProductReadiness {
  const merged = summarizeReadiness(
    [...structural.checks, ...exportChecks],
    structural.fingerprint,
  );
  return {
    ...merged,
    presentable: merged.status === 'pass' || merged.status === 'warning',
    limitations: [...READINESS_LIMITATIONS, ...CUTTING_PLAN_LIMITATIONS.slice(0, 1)],
  };
}

/** True when a report no longer describes the model it is shown next to. */
export function isReadinessStale(result: ReadinessResult, currentFingerprint: string): boolean {
  return result.fingerprint !== currentFingerprint;
}
