/**
 * C6 — assembly instructions.
 *
 * Two sources feed this module and they are deliberately kept apart, because they
 * do not carry the same evidence:
 *
 * - {@link buildFurnitureAssemblyPlan} reads the C1–C4 BOM of an ordinary
 *   furniture object. That model stores no assembly graph, so the step order is a
 *   documented convention derived from the part roles the builder already
 *   declares (`leg`, `side`, `door`, `shelf`, ...). Every step points at a real
 *   BOM row, so nothing is invented to fill a gap.
 * - {@link buildAssemblyPlan} reads a W14 assembly. That model *does* store a part
 *   graph with a parent link per part, so a part that hangs on another is
 *   reported as `modeled` and its step depends on the step that builds the parent.
 *
 * Neither source contains fastener, joint, drilling or tool data — no such data
 * exists anywhere in this codebase. This module therefore never emits any: a step
 * says where a part goes and, when the model cannot say how it is held, the
 * limitations say exactly that. Inventing a screw would be worse than a short
 * manual.
 *
 * Determinism: generation is pure over its input. `fingerprint` identifies the
 * model state a plan was built from, so a caller can tell that an existing plan no
 * longer describes the current model instead of showing stale steps.
 */
import { buildPartGraph } from '../geometry/assemblies/graph';
import { validateAssemblyParams } from '../geometry/assemblies/params';
import type { PartNode, PartRole } from '../geometry/assemblies/partGraph';
import {
  FURNITURE_TYPE_LABELS,
  type FurnitureType,
} from '../geometry/furniture/types';
import type { AssemblyKind } from '../scene/types';
import { nameDigest } from '../export/exportNaming';
import { assemblyBomPartId, assemblyPartKind, ASSEMBLY_TYPE_LABELS, buildAssemblyBom } from './assemblyBom';
import type { BomResult, BomRow } from './bom';
import { PART_KIND_LABELS, type PartKind } from './parts';
import { convertLength, roundLength } from './units';
import type { ValidationReport } from './validation';

/**
 * Where the relationship that places a part comes from.
 *
 * - `modeled`   — the stored model says it (W14 `parentId`).
 * - `derived`   — the part's declared role implies it (a `door` is a front panel).
 * - `inferred`  — only the measured geometry is available, so the guidance is
 *                 explicitly generic positioning advice, never a claimed joint.
 */
export type AssemblyRelation = 'modeled' | 'derived' | 'inferred';

export const ASSEMBLY_RELATION_LABELS: Record<AssemblyRelation, string> = {
  modeled: 'Modelda belgilangan',
  derived: 'Roldan kelib chiqqan',
  inferred: 'Taxminiy joylashuv',
};

/**
 * How complete the plan is for what the model can express.
 *
 * `ok` never means "safe to build": the fastening and strength information is
 * absent from every source, so `limitations` always carries those gaps.
 */
export type AssemblyPlanStatus = 'ok' | 'limited' | 'unsupported';

export const ASSEMBLY_STATUS_LABELS: Record<AssemblyPlanStatus, string> = {
  ok: "To'liq (model imkoniyati doirasida)",
  limited: 'Qisman',
  unsupported: 'Mavjud emas',
};

export type AssemblyIssueLevel = 'error' | 'warning' | 'info';

export type AssemblyIssueCode =
  | 'plan-empty'
  | 'plan-unsupported'
  | 'params-invalid'
  | 'part-unclassified'
  | 'part-unresolved'
  | 'part-size-ambiguous'
  | 'quantity-invalid'
  | 'step-duplicate-id'
  | 'step-order-invalid'
  | 'step-without-parts'
  | 'step-dependency-unknown'
  | 'step-dependency-late'
  | 'step-part-duplicate'
  | 'validation-errors'
  | 'plan-stale';

export interface AssemblyIssue {
  level: AssemblyIssueLevel;
  code: AssemblyIssueCode;
  /** Step this concerns, or null for a plan-wide result. */
  stepId: string | null;
  message: string;
}

export interface AssemblyPartRef {
  /** Stable BOM id, e.g. `wardrobe-door`. */
  partId: string;
  name: string;
  /** How many physical pieces of this `partId` the step covers. */
  quantity: number;
  /** Measured size in mm, or null when the model makes it ambiguous. */
  sizeMm: { x: number; y: number; z: number } | null;
}

export interface AssemblyStep {
  /** Semantic id (`step-leg`, `step-top`), independent of display order. */
  id: string;
  /** 1-based position; mirrors the array order and is validated against it. */
  order: number;
  title: string;
  instruction: string;
  relation: AssemblyRelation;
  parts: AssemblyPartRef[];
  /** Ids of steps that must be completed first. */
  dependsOn: string[];
}

export interface AssemblyPlan {
  source: 'furniture' | 'assembly';
  /** `FurnitureType` for furniture, `AssemblyKind` for an assembly. */
  model: string;
  modelLabel: string;
  status: AssemblyPlanStatus;
  steps: AssemblyStep[];
  issues: AssemblyIssue[];
  limitations: string[];
  /** Digest of the model state this plan describes (see `isAssemblyPlanStale`). */
  fingerprint: string;
}

/** Gaps that exist for every plan this project can produce. */
export const ASSEMBLY_LIMITATIONS: readonly string[] = [
  'Mahkamlash vositalari (shurop, mix, shtift, yelim, kronshteyn) va ularning soni modelda yo‘q — ko‘rsatilmagan.',
  "Teshik joylari, burg'ulash chuqurligi va birikma turlari modelda yo'q.",
  "Qadamlar tartibi detal rollaridan kelib chiqib tuzilgan; modelda yig'ish ketma-ketligi saqlanmaydi.",
  "Konstruktiv mustahkamlik, yuk ko'tarish qobiliyati va material standartlari tekshirilmagan.",
  'Bu qo‘llanma ishlab chiqarishga yaroqlilik yoki xavfsizlik sertifikati emas.',
];

const FURNITURE_SOURCE_NOTE =
  "Mebel modelida yig'ish grafi saqlanmaydi: qadamlar qism rollari bo'yicha tartiblangan.";

const ASSEMBLY_SOURCE_NOTE =
  "Assembly grafi qismlarning ota-bola bog'lanishini saqlaydi: bog'langan qismlar 'modelda belgilangan' deb ko'rsatilgan.";

const mm = (valueCm: number): number =>
  roundLength(convertLength(valueCm, 'cm', 'mm'), 'mm');

function sizeOf(row: BomRow): { x: number; y: number; z: number } {
  return { x: row.sizeMm.x, y: row.sizeMm.y, z: row.sizeMm.z };
}

interface StepTemplate {
  kinds: readonly PartKind[];
  title: string;
  instruction: string;
}

/**
 * Order in which the parts of each furniture type are presented.
 *
 * This lives here rather than in the builders because it is a *documentation*
 * decision, not a geometry one: the builders place parts in the frame the viewer
 * needs, which is a different question from the order a person assembles them.
 * A kind that the model does not contain produces no step.
 */
const FURNITURE_STEPS: Record<FurnitureType, readonly StepTemplate[]> = {
  table: [
    {
      kinds: ['leg'],
      title: 'Oyoqlar',
      instruction:
        "Oyoqlarni tekis yuzaga qo'ying — ustki panel keyingi qadamda ularning ustiga tushadi.",
    },
    {
      kinds: ['top'],
      title: 'Ustki panel',
      instruction: "Ustki panelni oyoqlar ustiga joylashtiring.",
    },
  ],
  chair: [
    {
      kinds: ['leg'],
      title: 'Oyoqlar',
      instruction: "Oyoqlarni tekis yuzaga qo'ying.",
    },
    {
      kinds: ['seat'],
      title: "O'rindiq",
      instruction: "O'rindiq panelini oyoqlar ustiga joylashtiring.",
    },
    {
      kinds: ['back'],
      title: 'Suyanchiq',
      instruction: "Suyanchiqni o'rindiqning orqa chetiga o'rnating.",
    },
  ],
  armchair: [
    {
      kinds: ['leg'],
      title: 'Oyoqlar',
      instruction: "Oyoqlarni tekis yuzaga qo'ying.",
    },
    {
      kinds: ['seat'],
      title: "O'rindiq",
      instruction: "O'rindiq panelini oyoqlar ustiga joylashtiring.",
    },
    {
      kinds: ['arm'],
      title: "Qo'l tayanchlari",
      instruction: "Qo'l tayanchlarini o'rindiqning ikki yoniga o'rnating.",
    },
    {
      kinds: ['back'],
      title: 'Suyanchiq',
      instruction: "Suyanchiqni o'rindiqning orqa chetiga o'rnating.",
    },
  ],
  sofa: [
    {
      kinds: ['leg'],
      title: 'Oyoqlar',
      instruction: "Oyoqlarni tekis yuzaga qo'ying.",
    },
    {
      kinds: ['seat'],
      title: "O'rindiq",
      instruction: "O'rindiq panelini oyoqlar ustiga joylashtiring.",
    },
    {
      kinds: ['arm'],
      title: "Qo'l tayanchlari",
      instruction: "Qo'l tayanchlarini o'rindiqning ikki yoniga o'rnating.",
    },
    {
      kinds: ['back'],
      title: 'Suyanchiq',
      instruction: "Suyanchiqni o'rindiqning orqa chetiga o'rnating.",
    },
  ],
  bed: [
    {
      kinds: ['leg'],
      title: 'Oyoqlar',
      instruction: "Oyoqlarni tekis yuzaga qo'ying.",
    },
    {
      kinds: ['frame'],
      title: 'Karkas',
      instruction: "Karkas panellarini oyoqlar ustiga yig'ing.",
    },
    {
      kinds: ['mattress'],
      title: 'Matras',
      instruction: 'Matrasni karkas ichiga tekis qilib joylashtiring.',
    },
    {
      kinds: ['headboard'],
      title: 'Bosh qismi',
      instruction: "Bosh qismini karkasning bosh tomoniga o'rnating.",
    },
  ],
  wardrobe: [
    {
      kinds: ['side', 'bottom', 'top', 'back'],
      title: 'Korpus',
      instruction:
        "Yon panellarni tik qilib qo'ying, ostki va ustki panelni ularning orasiga joylashtiring, orqa panelni orqa tomonga qo'ying.",
    },
    {
      kinds: ['shelf'],
      title: 'Ichki tokchalar',
      instruction: 'Tokchalarni korpus ichiga, bir tekis oraliqda joylashtiring.',
    },
    {
      kinds: ['door'],
      title: 'Eshiklar',
      instruction: "Eshiklarni korpusning old tomoniga o'rnating.",
    },
  ],
  shelf: [
    {
      kinds: ['side', 'bottom', 'top', 'back'],
      title: 'Korpus',
      instruction:
        "Yon panellarni tik qilib qo'ying, ostki va ustki panelni ularning orasiga joylashtiring, orqa panelni orqa tomonga qo'ying.",
    },
    {
      kinds: ['board', 'shelf'],
      title: 'Tokchalar',
      instruction: "Tokchalarni korpus ichiga, bir tekis oraliqda joylashtiring.",
    },
  ],
  dresser: [
    {
      kinds: ['leg'],
      title: 'Oyoqlar',
      instruction: "Oyoqlarni tekis yuzaga qo'ying.",
    },
    {
      kinds: ['body'],
      title: 'Korpus',
      instruction: "Korpusni oyoqlar ustiga qo'ying.",
    },
    {
      kinds: ['drawer'],
      title: 'Tortmalar',
      instruction: "Tortmalarni korpusning old tomonidagi uyalarga joylashtiring.",
    },
    {
      kinds: ['door'],
      title: 'Eshiklar',
      instruction: "Eshiklarni korpusning old tomoniga o'rnating.",
    },
  ],
};

/** Tiers inside a W14 assembly, in build order. */
interface AssemblyStepTemplate {
  roles: readonly PartRole[];
  title: string;
  instruction: string;
}

const ASSEMBLY_STEPS: Record<AssemblyKind, readonly AssemblyStepTemplate[]> = {
  'kitchen-base-run': [
    {
      roles: ['plinth'],
      title: 'Tsokol',
      instruction: "Tsokelni polga qo'ying — modul korpuslari shu asosda turadi.",
    },
    {
      roles: ['corpus'],
      title: 'Modullar',
      instruction: "Modul korpuslarini yonma-yon, tsokel ustiga joylashtiring.",
    },
    {
      roles: ['door'],
      title: 'Eshiklar',
      instruction: "Har bir eshikni o'z modul korpusining old tomoniga o'rnating.",
    },
    {
      roles: ['top'],
      title: 'Ustki panel',
      instruction: "Ustki panelni modullar ustiga qo'ying.",
    },
  ],
  'wall-cabinet': [
    {
      roles: ['corpus'],
      title: 'Korpus',
      instruction: "Korpusni devorga mahkamlash balandligida tayyorlab qo'ying.",
    },
    {
      roles: ['door'],
      title: 'Eshiklar',
      instruction: "Eshiklarni korpusning old tomoniga o'rnating.",
    },
  ],
  'wardrobe-section': [
    {
      roles: ['corpus'],
      title: 'Korpus',
      instruction: "Korpusni tik holatda qo'ying.",
    },
    {
      roles: ['divider'],
      title: "Bo'luvchi panellar",
      instruction: "Bo'luvchi panellarni korpus ichiga, seksiyalar orasiga joylashtiring.",
    },
    {
      roles: ['shelf'],
      title: 'Tokchalar',
      instruction: "Tokchalarni seksiyalar ichiga, bir tekis oraliqda joylashtiring.",
    },
    {
      roles: ['door'],
      title: 'Eshiklar',
      instruction: "Eshiklarni korpusning old tomoniga o'rnating.",
    },
  ],
  'stair-straight': [
    {
      roles: ['stringer'],
      title: 'Kosourlar',
      instruction: "Ikki kosourni yonma-yon qo'ying — pog'onalar shu ikkisiga tayanadi.",
    },
    {
      roles: ['step'],
      title: "Pog'onalar",
      instruction: "Pog'onalarni kosourlar orasiga, pastdan yuqoriga qarab joylashtiring.",
    },
  ],
};

/**
 * Canonical string for a furniture BOM, used as the staleness fingerprint.
 * Material assignments are excluded on purpose: they change what a part is made
 * of, never where it goes, and assigning a board must not invalidate a plan.
 */
function furnitureFingerprint(bom: BomResult): string {
  const rows = [...bom.rows]
    .map((row) =>
      [row.partId, String(row.quantity), String(row.sizeMm.x), String(row.sizeMm.y), String(row.sizeMm.z)].join(':'),
    )
    .sort();
  return nameDigest(`${bom.type}|${rows.join('|')}`);
}

/** Canonical string for an assembly, used as the staleness fingerprint. */
function assemblyFingerprint(kind: AssemblyKind, params: Record<string, unknown>): string {
  const channels = Object.keys(params)
    .filter((key) => key !== 'color')
    .sort()
    .map((key) => `${key}=${String(params[key])}`);
  return nameDigest(`${kind}|${channels.join('&')}`);
}

/**
 * True when `plan` no longer describes the model it is being shown next to.
 *
 * The comparison is by fingerprint, so a plan built from a different object (even
 * the same type) is reported as stale instead of silently reusing step text that
 * refers to other parts.
 */
export function isAssemblyPlanStale(plan: AssemblyPlan, currentFingerprint: string): boolean {
  return plan.fingerprint !== currentFingerprint;
}

export function furniturePlanFingerprint(bom: BomResult): string {
  return furnitureFingerprint(bom);
}

export function assemblyPlanFingerprintOf(
  kind: AssemblyKind,
  params: Record<string, unknown>,
): string {
  return assemblyFingerprint(kind, params);
}

function mergeRows(rows: readonly BomRow[]): AssemblyPartRef[] {
  const map = new Map<string, AssemblyPartRef>();
  for (const row of rows) {
    const existing = map.get(row.partId);
    if (!existing) {
      map.set(row.partId, {
        partId: row.partId,
        name: row.name,
        quantity: row.quantity,
        sizeMm: sizeOf(row),
      });
      continue;
    }
    existing.quantity += row.quantity;
    // The same partId can arrive twice when a kind has two distinct sizes; the
    // total count stays right, but no single size can be stated for it.
    if (
      existing.sizeMm &&
      (existing.sizeMm.x !== row.sizeMm.x ||
        existing.sizeMm.y !== row.sizeMm.y ||
        existing.sizeMm.z !== row.sizeMm.z)
    ) {
      existing.sizeMm = null;
    }
  }
  return [...map.values()].sort((a, b) => a.partId.localeCompare(b.partId));
}

function statusFor(steps: readonly AssemblyStep[], issues: readonly AssemblyIssue[]): AssemblyPlanStatus {
  if (steps.length === 0) {
    return 'unsupported';
  }
  return issues.some((entry) => entry.level !== 'info') ? 'limited' : 'ok';
}

/**
 * Stable step id derived from the semantic role set, not the array position.
 *
 * The same template therefore keeps its id when another step is added, removed
 * or reordered. A collision (two templates claiming the same roles) gets a
 * deterministic suffix; it is a generation bug, not something to guess around.
 */
function stableStepId(key: string, used: Set<string>): string {
  const slug = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = `step-${slug === '' ? 'extra' : slug}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

export interface FurnitureAssemblyInput {
  /** The BOM the panel already computed; the plan never recomputes it. */
  bom: BomResult;
  /** C4 report for the same model, when available. */
  validation?: ValidationReport;
}

/**
 * Build the instructions for an ordinary furniture object.
 *
 * Every step's `partId` is a row id from `bom.rows`, so a reference can only name
 * a part the model actually produced. Parts whose kind no template claims fall
 * into one explicitly generic step rather than being dropped.
 */
export function buildFurnitureAssemblyPlan(input: FurnitureAssemblyInput): AssemblyPlan {
  const { bom, validation } = input;
  const templates = FURNITURE_STEPS[bom.type as FurnitureType];
  const issues: AssemblyIssue[] = [];
  const steps: AssemblyStep[] = [];

  if (!templates || bom.rows.length === 0) {
    issues.push({
      level: 'error',
      code: 'plan-empty',
      stepId: null,
      message: "Modelda montaj qadamlarini tuzish uchun detallar yo'q.",
    });
    return {
      source: 'furniture',
      model: String(bom.type),
      modelLabel: FURNITURE_TYPE_LABELS[bom.type as FurnitureType] ?? String(bom.type),
      status: 'unsupported',
      steps: [],
      issues,
      limitations: [...ASSEMBLY_LIMITATIONS, FURNITURE_SOURCE_NOTE],
      fingerprint: furnitureFingerprint(bom),
    };
  }

  const claimed = new Set<string>();
  const usedIds = new Set<string>();
  for (const template of templates) {
    const rows = bom.rows.filter((row) => template.kinds.includes(row.kind));
    rows.forEach((row) => claimed.add(row.partId));
    if (rows.length === 0) {
      continue;
    }
    const parts = mergeRows(rows);
    const id = stableStepId(template.kinds.join('-'), usedIds);
    const previous = steps.length > 0 ? steps[steps.length - 1].id : null;
    for (const part of parts) {
      if (part.sizeMm === null) {
        issues.push({
          level: 'warning',
          code: 'part-size-ambiguous',
          stepId: id,
          message: `"${part.name}" uchun bir necha xil o'lcham bor — o'lcham ko'rsatilmadi, chizmaga tayaning.`,
        });
      }
    }
    steps.push({
      id,
      order: steps.length + 1,
      title: template.title,
      instruction: template.instruction,
      relation: 'derived',
      parts,
      // Furniture carries no stored joint, so this expresses order only.
      dependsOn: previous ? [previous] : [],
    });
  }

  const leftovers = bom.rows.filter((row) => !claimed.has(row.partId));
  if (leftovers.length > 0) {
    const parts = mergeRows(leftovers);
    const id = stableStepId('extra', usedIds);
    const previous = steps.length > 0 ? steps[steps.length - 1].id : null;
    steps.push({
      id,
      order: steps.length + 1,
      title: "Qo'shimcha detallar",
      instruction:
        "Quyidagi detallarning joylashuvi modelda aniqlanmagan — o'rnini texnik chizmadan tekshiring.",
      relation: 'inferred',
      parts,
      dependsOn: previous ? [previous] : [],
    });
    for (const part of leftovers) {
      issues.push({
        level: 'warning',
        code: 'part-unclassified',
        stepId: id,
        message: `"${part.partId}" detali ma'lum rolga ega emas — joylashuv bo'yicha ko'rsatma umumiy.`,
      });
    }
  }

  if (validation && validation.counts.error > 0) {
    issues.push({
      level: 'warning',
      code: 'validation-errors',
      stepId: null,
      message: `Model tekshiruvida ${validation.counts.error} xatolik bor — montaj rejasi tasdiqlanmagan.`,
    });
  }

  const merged = [...issues, ...validateAssemblyPlan({ steps })];
  return {
    source: 'furniture',
    model: bom.type,
    modelLabel: FURNITURE_TYPE_LABELS[bom.type as FurnitureType] ?? String(bom.type),
    status: statusFor(steps, merged),
    steps,
    issues: merged,
    limitations: [...ASSEMBLY_LIMITATIONS, FURNITURE_SOURCE_NOTE],
    fingerprint: furnitureFingerprint(bom),
  };
}

export interface AssemblyInstructionsInput {
  kind: AssemblyKind;
  /** Stored assembly parameters, as they arrive from the scene. */
  params: Record<string, unknown>;
}

function partRefsFromNodes(
  kind: AssemblyKind,
  selected: readonly PartNode[],
  stepId: string,
  issues: AssemblyIssue[],
): AssemblyPartRef[] {
  const map = new Map<string, { ref: AssemblyPartRef; sizes: Set<string> }>();
  for (const node of selected) {
    // The assembly graph id (`wall-cabinet-door-2`) and the manufacturing id
    // (`wall-cabinet-door`) are different vocabularies; the mapping is explicit
    // so a rename on either side fails a test instead of silently mismatching.
    const partId = assemblyBomPartId(kind, node.role);
    const sizeKey = node.size.map((value) => String(value)).join('x');
    const entry = map.get(partId);
    if (!entry) {
      map.set(partId, {
        ref: {
          partId,
          name: PART_KIND_LABELS[assemblyPartKind(node.role)],
          quantity: 1,
          sizeMm: { x: mm(node.size[0]), y: mm(node.size[1]), z: mm(node.size[2]) },
        },
        sizes: new Set([sizeKey]),
      });
      continue;
    }
    entry.ref.quantity += 1;
    entry.sizes.add(sizeKey);
    if (entry.sizes.size > 1) {
      entry.ref.sizeMm = null;
    }
  }
  const refs = [...map.values()].map((entry) => entry.ref).sort((a, b) => a.partId.localeCompare(b.partId));
  for (const ref of refs) {
    if (ref.sizeMm === null) {
      issues.push({
        level: 'warning',
        code: 'part-size-ambiguous',
        stepId,
        message: `"${ref.name}" qismlarining o'lchamlari har xil — o'lcham ko'rsatilmadi.`,
      });
    }
  }
  return refs;
}

/**
 * Build the instructions for a W14 assembly from its part graph.
 *
 * This is the `modeled` tier: a part that hangs on another keeps that link in the
 * graph, so the step that places it depends on the step that builds its parent.
 * Kinds whose graph has no parent links at all (the straight stair) fall back to
 * role order and say so through the step's `relation`.
 */
export function buildAssemblyPlan(input: AssemblyInstructionsInput): AssemblyPlan {
  const { kind } = input;
  const templates = ASSEMBLY_STEPS[kind];
  const issues: AssemblyIssue[] = [];

  if (!templates) {
    issues.push({
      level: 'error',
      code: 'plan-unsupported',
      stepId: null,
      message: `"${String(kind)}" uchun montaj qo'llanmasi qo'llab-quvvatlanmaydi.`,
    });
    return {
      source: 'assembly',
      model: String(kind),
      modelLabel: ASSEMBLY_TYPE_LABELS[kind] ?? String(kind),
      status: 'unsupported',
      steps: [],
      issues,
      limitations: [...ASSEMBLY_LIMITATIONS, ASSEMBLY_SOURCE_NOTE],
      fingerprint: assemblyFingerprint(kind, input.params),
    };
  }

  const checked = validateAssemblyParams(kind, input.params as never);
  if (checked === null) {
    issues.push({
      level: 'error',
      code: 'params-invalid',
      stepId: null,
      message: "Assembly parametrlari yaroqsiz — montaj qo'llanmasi tuzilmadi.",
    });
    return {
      source: 'assembly',
      model: kind,
      modelLabel: ASSEMBLY_TYPE_LABELS[kind],
      status: 'unsupported',
      steps: [],
      issues,
      limitations: [...ASSEMBLY_LIMITATIONS, ASSEMBLY_SOURCE_NOTE],
      fingerprint: assemblyFingerprint(kind, input.params),
    };
  }

  const nodes = buildPartGraph(kind, checked);
  const claimed = new Set<string>();
  const usedIds = new Set<string>();
  const steps: AssemblyStep[] = [];
  /** graph part id -> the step that builds it, for dependency resolution. */
  const stepOfPart = new Map<string, string>();

  for (const template of templates) {
    const selected = nodes.filter((node) => template.roles.includes(node.role));
    selected.forEach((node) => claimed.add(node.id));
    if (selected.length === 0) {
      continue;
    }
    const id = stableStepId(template.roles.join('-'), usedIds);
    const parents = selected
      .map((node) => node.parentId)
      .filter((parentId): parentId is string => parentId !== null)
      .map((parentId) => stepOfPart.get(parentId))
      .filter((stepId): stepId is string => stepId !== undefined);
    const dependsOn = [...new Set(parents)];
    selected.forEach((node) => stepOfPart.set(node.id, id));
    steps.push({
      id,
      order: steps.length + 1,
      title: template.title,
      instruction: template.instruction,
      relation: selected.every((node) => node.parentId !== null) ? 'modeled' : 'derived',
      parts: partRefsFromNodes(kind, selected, id, issues),
      dependsOn: dependsOn.length > 0 ? dependsOn : steps.length > 0 ? [steps[steps.length - 1].id] : [],
    });
  }

  const leftovers = nodes.filter((node) => !claimed.has(node.id));
  if (leftovers.length > 0) {
    const id = stableStepId('extra', usedIds);
    steps.push({
      id,
      order: steps.length + 1,
      title: "Qo'shimcha detallar",
      instruction:
        "Quyidagi qismlarning joylashuvi grafikda aniqlanmagan — o'rnini chizmadan tekshiring.",
      relation: 'inferred',
      parts: partRefsFromNodes(kind, leftovers, id, issues),
      dependsOn: steps.length > 0 ? [steps[steps.length - 1].id] : [],
    });
    for (const node of leftovers) {
      issues.push({
        level: 'warning',
        code: 'part-unclassified',
        stepId: id,
        message: `"${node.id}" qismi ma'lum bosqichga kirmagan — joylashuv bo'yicha ko'rsatma umumiy.`,
      });
    }
  }

  // A plan that names a part the assembly BOM does not know would be unusable at
  // the workshop bench, so the mapping is checked against the real BOM here.
  const bomOutcome = buildAssemblyBom(kind, checked);
  const merged = [...issues, ...validateAssemblyPlan({ steps })];
  if (bomOutcome.ok) {
    const known = new Set(bomOutcome.bom.rows.map((row) => row.partId));
    const unresolved = new Set(
      steps.flatMap((step) => step.parts.map((part) => part.partId)).filter((partId) => !known.has(partId)),
    );
    for (const partId of unresolved) {
      merged.push({
        level: 'error',
        code: 'part-unresolved',
        stepId: null,
        message: `"${partId}" qismi assembly BOM ro'yxatida topilmadi.`,
      });
    }
  }

  return {
    source: 'assembly',
    model: kind,
    modelLabel: ASSEMBLY_TYPE_LABELS[kind],
    status: statusFor(steps, merged),
    steps,
    issues: merged,
    limitations: [...ASSEMBLY_LIMITATIONS, ASSEMBLY_SOURCE_NOTE],
    fingerprint: assemblyFingerprint(kind, input.params),
  };
}

/**
 * Structural checks on a plan.
 *
 * Separated from generation because the same checks are worth running on a plan
 * that has been sitting in component state while the model changed underneath it.
 */
export interface AssemblyPlanValidationOptions {
  /** Part ids the current model defines; anything else is a hard error. */
  expectedPartIds?: readonly string[];
}

export function validateAssemblyPlan(
  plan: Pick<AssemblyPlan, 'steps'>,
  options: AssemblyPlanValidationOptions = {},
): AssemblyIssue[] {
  const issues: AssemblyIssue[] = [];
  const known = options.expectedPartIds ? new Set(options.expectedPartIds) : null;
  const seenIds = new Set<string>();
  const positionOf = new Map<string, number>();
  plan.steps.forEach((step, index) => {
    if (!positionOf.has(step.id)) {
      positionOf.set(step.id, index);
    }
  });

  plan.steps.forEach((step, index) => {
    if (seenIds.has(step.id)) {
      issues.push({
        level: 'error',
        code: 'step-duplicate-id',
        stepId: step.id,
        message: `"${step.id}" qadam identifikatori takrorlangan.`,
      });
    }
    seenIds.add(step.id);

    if (step.order !== index + 1) {
      issues.push({
        level: 'error',
        code: 'step-order-invalid',
        stepId: step.id,
        message: `"${step.id}" qadam tartibi noto'g'ri: ${step.order}, kutilgan ${index + 1}.`,
      });
    }

    if (step.parts.length === 0) {
      issues.push({
        level: 'warning',
        code: 'step-without-parts',
        stepId: step.id,
        message: `"${step.title}" qadamida hech qanday detal yo'q.`,
      });
    }

    const partIds = new Set<string>();
    for (const part of step.parts) {
      if (!Number.isInteger(part.quantity) || part.quantity <= 0) {
        issues.push({
          level: 'error',
          code: 'quantity-invalid',
          stepId: step.id,
          message: `"${part.partId}" detali uchun son noto'g'ri: ${part.quantity}.`,
        });
      }
      if (partIds.has(part.partId)) {
        issues.push({
          level: 'error',
          code: 'step-part-duplicate',
          stepId: step.id,
          message: `"${part.partId}" detali bir qadamda ikki marta sanalgan.`,
        });
      }
      partIds.add(part.partId);
      if (known && !known.has(part.partId)) {
        issues.push({
          level: 'error',
          code: 'part-unresolved',
          stepId: step.id,
          message: `"${part.partId}" detali joriy modelda topilmadi.`,
        });
      }
    }

    for (const dependency of step.dependsOn) {
      const position = positionOf.get(dependency);
      if (position === undefined) {
        issues.push({
          level: 'error',
          code: 'step-dependency-unknown',
          stepId: step.id,
          message: `"${step.id}" qadami mavjud bo'lmagan "${dependency}" qadamiga bog'langan.`,
        });
        continue;
      }
      if (position >= index) {
        issues.push({
          level: 'error',
          code: 'step-dependency-late',
          stepId: step.id,
          message: `"${step.id}" qadami o'zidan keyingi "${dependency}" qadamiga bog'langan.`,
        });
      }
    }
  });

  if (plan.steps.length === 0) {
    issues.push({
      level: 'error',
      code: 'plan-empty',
      stepId: null,
      message: "Montaj rejasida qadamlar yo'q.",
    });
  }

  return issues;
}

/** Every part id the plan references, deduplicated and sorted. */
export function assemblyPlanPartIds(plan: Pick<AssemblyPlan, 'steps'>): string[] {
  return [...new Set(plan.steps.flatMap((step) => step.parts.map((part) => part.partId)))].sort();
}

/** Total number of physical pieces the plan walks through. */
export function assemblyPlanPartCount(plan: Pick<AssemblyPlan, 'steps'>): number {
  return plan.steps.reduce(
    (total, step) => total + step.parts.reduce((sum, part) => sum + part.quantity, 0),
    0,
  );
}
