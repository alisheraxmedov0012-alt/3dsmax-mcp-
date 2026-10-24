/**
 * C3 sheet material and panel thickness.
 *
 * Scope: which board material a part is cut from, and the nominal panel thickness
 * the user buys it in. This is *manufacturing* data, deliberately separate from
 * the W4 PBR material in `materials/` (which describes how a surface looks, not
 * what it is made of).
 *
 * Two honesty rules drive the whole module:
 *
 * 1. No standards are invented. The catalogue carries display names only — no
 *    thickness standard, class, certificate or physical property is claimed,
 *    because the project documents none. Thickness is therefore supplied by the
 *    user, and the only numeric limit applied is the project's existing
 *    `PANEL_MAX_THICKNESS_CM` board rule.
 * 2. Nominal thickness is never geometry. `BomRow.thicknessMm` keeps reporting
 *    the measured mesh size; `material.thicknessMm` is what the user says they
 *    will buy. When the two disagree a warning is raised; neither value is
 *    silently overwritten.
 */
/** Identifier of a board material in {@link SHEET_MATERIALS}. */
export type SheetMaterialId = 'ldsp' | 'mdf' | 'fanera' | 'massiv' | 'other';

export interface SheetMaterialDefinition {
  id: SheetMaterialId;
  /** User-facing name. A label only: no standard or property is implied. */
  name: string;
}

/**
 * Starter catalogue of board materials.
 *
 * These are common shop-floor categories used as labels. Thickness, grade,
 * finish and certification are NOT part of this list — the project has no
 * approved values for them, so the user enters the thickness they actually
 * buy. Extend the list freely; nothing downstream switches on the id beyond
 * display name lookup.
 */
export const SHEET_MATERIALS: readonly SheetMaterialDefinition[] = [
  { id: 'ldsp', name: 'LDSP' },
  { id: 'mdf', name: 'MDF' },
  { id: 'fanera', name: 'Fanera' },
  { id: 'massiv', name: "Massiv (yog'och)" },
  { id: 'other', name: 'Boshqa' },
];

export const SHEET_MATERIAL_IDS: ReadonlySet<string> = new Set(
  SHEET_MATERIALS.map((entry) => entry.id),
);

export const SHEET_MATERIAL_LABELS: Record<SheetMaterialId, string> = Object.fromEntries(
  SHEET_MATERIALS.map((entry) => [entry.id, entry.name]),
) as Record<SheetMaterialId, string>;

/**
 * Thickest part still counted as board, in millimetres.
 *
 * This is the single source of truth for the project's board rule; `bom.ts`
 * derives its centimetre `PANEL_MAX_THICKNESS_CM` from it. It is not a trade
 * standard, just the existing project boundary past which a part is a block.
 */
export const SHEET_MAX_THICKNESS_MM = 60;

/**
 * Accepted nominal thickness range, in millimetres.
 *
 * The upper bound is the board rule above, not a new standard: past it the part
 * is not sheet goods at all. The lower bound only excludes values that cannot
 * describe a board (zero and negatives).
 */
export const SHEET_THICKNESS_LIMITS = {
  minExclusiveMm: 0,
  maxInclusiveMm: SHEET_MAX_THICKNESS_MM,
} as const;

/**
 * How far the nominal thickness may drift from the measured geometry before it is
 * worth telling the user. Half a millimetre is below what a shop measures by hand.
 */
export const THICKNESS_MISMATCH_TOLERANCE_MM = 0.5;

/** How the thickness value on an assignment came to be. */
export type ThicknessSource = 'user' | 'default';

/**
 * A material assigned to one part group of one piece.
 *
 * `partId` matches the BOM's stable id (e.g. `wardrobe-door`), so assignments
 * survive parameter edits that keep the same part structure.
 */
export interface SheetMaterialEntry {
  partId: string;
  materialId: SheetMaterialId;
  /** Nominal panel thickness in millimetres, as supplied by the user. */
  thicknessMm: number;
  /** `default` marks a value the catalogue supplied rather than the user. */
  thicknessSource: ThicknessSource;
}

/** Severity of a material problem. */
export type SheetIssueLevel = 'error' | 'warning';

/** Stable machine-readable reason, so callers never match on prose. */
export type SheetIssueCode =
  | 'material-missing'
  | 'unknown-material'
  | 'bad-thickness'
  | 'thickness-mismatch'
  | 'duplicate-part'
  | 'missing-part-id';

export interface SheetIssue {
  level: SheetIssueLevel;
  code: SheetIssueCode;
  partId: string | null;
  message: string;
}

/**
 * Material information attached to a BOM row.
 *
 * `thicknessMm` is the nominal board thickness; `geometryThicknessMm` is what the
 * mesh actually measures. They are reported side by side so a mismatch is visible
 * rather than hidden behind one "thickness" number.
 */
export interface BomMaterialInfo {
  materialId: SheetMaterialId;
  name: string;
  thicknessMm: number;
  unit: 'mm';
  source: ThicknessSource;
  geometryThicknessMm: number | null;
  /** True when the nominal thickness and the measured geometry disagree. */
  thicknessMismatch: boolean;
  issues: SheetIssue[];
}

export type ThicknessValidation =
  | { ok: true; thicknessMm: number }
  | { ok: false; reason: string };

/** Validate a user-supplied nominal thickness in millimetres. */
export function validateSheetThickness(value: unknown): ThicknessValidation {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, reason: "Qalinlik son bolishi kerak (mm)." };
  }
  if (value <= SHEET_THICKNESS_LIMITS.minExclusiveMm) {
    return { ok: false, reason: 'Qalinlik noldan katta bolishi kerak.' };
  }
  if (value > SHEET_THICKNESS_LIMITS.maxInclusiveMm) {
    return {
      ok: false,
      reason: `Qalinlik ${SHEET_THICKNESS_LIMITS.maxInclusiveMm} mm dan oshmasligi kerak — undan qalin detal panel hisoblanmaydi.`,
    };
  }
  return { ok: true, thicknessMm: Math.round(value * 10) / 10 };
}

/** Validate a material id against the catalogue. */
export function isKnownSheetMaterial(id: unknown): id is SheetMaterialId {
  return typeof id === 'string' && SHEET_MATERIAL_IDS.has(id);
}

/**
 * Check one assignment and describe its state.
 *
 * Returns a list of issues instead of throwing: the caller decides whether a
 * problem blocks the calculation (error) or only deserves a note (warning).
 */
export function inspectSheetAssignment(
  entry: SheetMaterialEntry | null | undefined,
  geometryThicknessMm: number | null,
): { material: BomMaterialInfo | null; issues: SheetIssue[] } {
  if (!entry) {
    return {
      material: null,
      issues: [
        {
          level: 'warning',
          code: 'material-missing',
          partId: null,
          message: "Material tanlanmagan — material ustuni bosh qoldirildi.",
        },
      ],
    };
  }

  const issues: SheetIssue[] = [];
  const thickness = validateSheetThickness(entry.thicknessMm);

  if (!isKnownSheetMaterial(entry.materialId)) {
    issues.push({
      level: 'error',
      code: 'unknown-material',
      partId: entry.partId,
      message: `Noma'lum material turi: ${String(entry.materialId)}.`,
    });
  }

  if (!thickness.ok) {
    issues.push({
      level: 'error',
      code: 'bad-thickness',
      partId: entry.partId,
      message: thickness.reason,
    });
  }

  // An error means the row cannot be presented as a settled material.
  if (issues.some((issue) => issue.level === 'error')) {
    return { material: null, issues };
  }

  const thicknessMm = thickness.ok ? thickness.thicknessMm : 0;
  const mismatch =
    geometryThicknessMm !== null &&
    Math.abs(thicknessMm - geometryThicknessMm) > THICKNESS_MISMATCH_TOLERANCE_MM;

  if (mismatch) {
    issues.push({
      level: 'warning',
      code: 'thickness-mismatch',
      partId: entry.partId,
      message: `Material qalinligi ${thicknessMm} mm, geometriya ${geometryThicknessMm} mm — mos kelmaydi.`,
    });
  }

  return {
    material: {
      materialId: entry.materialId as SheetMaterialId,
      name: SHEET_MATERIAL_LABELS[entry.materialId as SheetMaterialId],
      thicknessMm,
      unit: 'mm',
      source: entry.thicknessSource,
      geometryThicknessMm,
      thicknessMismatch: mismatch,
      issues,
    },
    issues,
  };
}

/**
 * Collapse the per-row "no material" warnings into one line.
 *
 * Every unassigned row produces the same message, so a six-part piece would
 * otherwise repeat it six times. Only used when the user assigned nothing at
 * all; once some parts carry a material the per-part warnings are informative
 * and are kept.
 */
export function collapseMissingMaterialIssues(
  issues: readonly SheetIssue[],
  totalRows: number,
): SheetIssue[] {
  const missing = issues.filter((issue) => issue.code === 'material-missing');
  if (missing.length === 0) {
    return [...issues];
  }
  const rest = issues.filter((issue) => issue.code !== 'material-missing');
  return [
    {
      level: 'warning',
      code: 'material-missing',
      partId: null,
      message: `Material tanlanmagan — ${totalRows} detal uchun material ustuni bosh qoldirildi.`,
    },
    ...rest,
  ];
}

/** Index assignments by part id, ignoring anything without a usable id. */
export function indexSheetMaterials(
  entries: readonly SheetMaterialEntry[] | null | undefined,
): Map<string, SheetMaterialEntry> {
  const map = new Map<string, SheetMaterialEntry>();
  for (const entry of entries ?? []) {
    if (entry && typeof entry.partId === 'string' && entry.partId !== '') {
      map.set(entry.partId, entry);
    }
  }
  return map;
}

/**
 * Validate a whole assignment list before anything is calculated.
 *
 * Duplicate part ids are reported rather than silently resolved: two thicknesses
 * for one part is a user mistake, and picking one would hide it.
 */
export function validateSheetMaterialList(
  entries: readonly SheetMaterialEntry[] | null | undefined,
): SheetIssue[] {
  const issues: SheetIssue[] = [];
  const seen = new Set<string>();
  for (const entry of entries ?? []) {
    if (!entry || typeof entry.partId !== 'string' || entry.partId === '') {
      issues.push({
        level: 'error',
        code: 'missing-part-id',
        partId: null,
        message: 'Material yozuvida detal id si yoq.',
      });
      continue;
    }
    if (seen.has(entry.partId)) {
      issues.push({
        level: 'error',
        code: 'duplicate-part',
        partId: entry.partId,
        message: `Bir detalga bir nechta material biriktirilgan: ${entry.partId}.`,
      });
      continue;
    }
    seen.add(entry.partId);

    if (!isKnownSheetMaterial(entry.materialId)) {
      issues.push({
        level: 'error',
        code: 'unknown-material',
        partId: entry.partId,
        message: `Noma'lum material turi: ${String(entry.materialId)}.`,
      });
    }
    const thickness = validateSheetThickness(entry.thicknessMm);
    if (!thickness.ok) {
      issues.push({
      level: 'error',
      code: 'bad-thickness',
      partId: entry.partId,
      message: thickness.reason,
    });
    }
  }
  return issues;
}

/**
 * Group BOM rows that share a material and nominal thickness.
 *
 * Sheet goods are bought and cut per board type, so the useful summary is "12
 * parts of 18 mm LDSP", not twelve separate lines. Rows without material data are
 * left out rather than bucketed into an invented group.
 */
export interface MaterialGroup {
  materialId: SheetMaterialId;
  name: string;
  thicknessMm: number;
  unit: 'mm';
  partIds: string[];
  totalPieces: number;
}

export function groupByMaterial(
  rows: ReadonlyArray<{ partId: string; quantity: number; material: BomMaterialInfo | null }>,
): MaterialGroup[] {
  const map = new Map<string, MaterialGroup>();
  for (const row of rows) {
    if (!row.material) {
      continue;
    }
    const key = `${row.material.materialId}:${row.material.thicknessMm}`;
    const existing = map.get(key);
    if (existing) {
      existing.partIds.push(row.partId);
      existing.totalPieces += row.quantity;
    } else {
      map.set(key, {
        materialId: row.material.materialId,
        name: row.material.name,
        thicknessMm: row.material.thicknessMm,
        unit: 'mm',
        partIds: [row.partId],
        totalPieces: row.quantity,
      });
    }
  }
  return [...map.values()];
}
