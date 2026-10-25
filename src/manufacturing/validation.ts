/**
 * C4 manufacturing validation.
 *
 * Checks that a furniture model and its manufacturing data are usable *before* a
 * workshop relies on the exported documents. Four severities are kept strictly
 * apart, because conflating them is how a "green" report turns into a wrong cut:
 *
 * - `error`   — the model cannot be measured or is outside a limit the project
 *               already defines. The export would be wrong, not merely doubtful.
 * - `warning` — something looks suspicious or inconsistent, but the project has
 *               no authority to call it a defect. A human must decide.
 * - `info`    — a fact worth surfacing that is not a problem at all.
 *
 * Everything reported here comes from data the project already owns: the
 * per-type field ranges in `geometry/furniture/types.ts`, the cross-field rules in
 * `geometry/furniture/params.ts`, and the C3 material diagnostics. No engineering
 * standard is invented — no minimum shelf thickness, load rating, joinery rule or
 * material compatibility table exists in this codebase, so none is claimed.
 *
 * The report never repairs the model: it only describes it. A clean report means
 * "nothing this validator knows how to check failed", never "safe to manufacture".
 */
import { buildFurniture } from '../geometry/furniture/buildFurniture';
import { relationErrors } from '../geometry/furniture/params';
import {
  FURNITURE_FIELDS,
  isFurnitureType,
  type FurnitureParams,
  type FurnitureType,
} from '../geometry/furniture/types';
import { PANEL_MAX_THICKNESS_CM, buildBom, type BomResult } from './bom';
import { PANEL_KINDS } from './parts';
import { measurePartBoxes, type PartBox } from './technicalDrawing';
import type { SheetIssueCode, SheetMaterialEntry } from './sheetMaterial';

export type ValidationLevel = 'error' | 'warning' | 'info';

/** Stable machine-readable identifier for a check result. */
export type ValidationCode =
  | 'dimension-non-finite'
  | 'dimension-non-positive'
  | 'dimension-limit-exceeded'
  | 'dimension-relation-invalid'
  | 'geometry-bounds-invalid'
  | 'geometry-overlap-suspected'
  | 'panel-too-thick-for-cutlist'
  | 'material-assignment-stale'
  // C3 codes are reused verbatim so the same condition never gets two names.
  | SheetIssueCode;

export interface ValidationIssue {
  level: ValidationLevel;
  code: ValidationCode;
  /** Part this concerns, or null when it applies to the whole piece. */
  partId: string | null;
  message: string;
  /** Which rule or data source produced this result. */
  source: string;
  details?: Record<string, unknown>;
}

export interface ValidationReport {
  /** True when no `error` was raised. Warnings do not make a model invalid. */
  ok: boolean;
  issues: ValidationIssue[];
  counts: Record<ValidationLevel, number>;
  /**
   * Conditions this validator could not evaluate for this model. Reported rather
   * than silently skipped, so nobody reads absence of an issue as a pass.
   */
  limitations: string[];
}

/** Tolerance for treating two coordinates as the same plane (centimetres). */
const BOUNDS_EPSILON_CM = 1e-6;

const SOURCE_PARAMS = 'geometry/furniture/params';
const SOURCE_BOUNDS = 'manufacturing/validation#bounds';
const SOURCE_OVERLAP = 'manufacturing/validation#aabb-overlap';
const SOURCE_MATERIAL = 'manufacturing/sheetMaterial';

function issue(
  level: ValidationLevel,
  code: ValidationCode,
  partId: string | null,
  message: string,
  source: string,
  details?: Record<string, unknown>,
): ValidationIssue {
  const result: ValidationIssue = { level, code, partId, message, source };
  if (details) {
    result.details = details;
  }
  return result;
}

/**
 * Check every numeric parameter against the type's declared field contract.
 *
 * The ranges come from `FURNITURE_FIELDS`, the same table the editor and the
 * storage validator use, so a value rejected here is rejected by the app itself —
 * this is not a second, private opinion on what is allowed.
 */
export function validateDimensions(type: FurnitureType, params: FurnitureParams): ValidationIssue[] {
  if (!isFurnitureType(type)) {
    return [
      issue('error', 'geometry-bounds-invalid', null, "Noma'lum mebel turi.", SOURCE_PARAMS, {
        type: String(type),
      }),
    ];
  }

  const issues: ValidationIssue[] = [];
  const record = params as unknown as Record<string, unknown>;

  for (const spec of FURNITURE_FIELDS[type]) {
    const raw = record[spec.key];
    // Absent optional channels fall back to the builder's default: not an issue.
    if (raw === undefined) {
      continue;
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      issues.push(
        issue(
          'error',
          'dimension-non-finite',
          null,
          `${spec.label}: qiymat son emas yoki cheksiz (${String(raw)}).`,
          SOURCE_PARAMS,
          { field: spec.key, value: String(raw) },
        ),
      );
      continue;
    }
    // Only a field whose own range starts above zero *requires* a positive value.
    // Some channels legitimately allow 0 (a dresser with no doors), so a blanket
    // "must be greater than zero" rule would flag a valid model.
    if (raw <= 0 && spec.range.min > 0) {
      issues.push(
        issue(
          'error',
          'dimension-non-positive',
          null,
          `${spec.label}: qiymat noldan katta bo'lishi kerak (${raw}).`,
          SOURCE_PARAMS,
          { field: spec.key, value: raw, min: spec.range.min },
        ),
      );
      continue;
    }
    if (raw < spec.range.min || raw > spec.range.max) {
      issues.push(
        issue(
          'error',
          'dimension-limit-exceeded',
          null,
          `${spec.label}: ${raw} ruxsat etilgan ${spec.range.min}–${spec.range.max} oralig'idan tashqarida.`,
          SOURCE_PARAMS,
          {
            field: spec.key,
            value: raw,
            min: spec.range.min,
            max: spec.range.max,
            rule: 'range',
          },
        ),
      );
      continue;
    }
    if (spec.integer && !Number.isInteger(raw)) {
      issues.push(
        issue(
          'error',
          'dimension-limit-exceeded',
          null,
          `${spec.label}: butun son bo'lishi kerak (${raw}).`,
          SOURCE_PARAMS,
          { field: spec.key, value: raw, rule: 'integer' },
        ),
      );
    }
  }

  // Cross-field rules only make sense once every value is numeric and in range.
  if (issues.length === 0) {
    for (const [field, message] of Object.entries(relationErrors(type, params))) {
      issues.push(
        issue('error', 'dimension-relation-invalid', null, message, SOURCE_PARAMS, { field }),
      );
    }
  }

  return issues;
}

/**
 * Parts shaped like a panel that are too thick to be cut from sheet goods.
 *
 * `PANEL_MAX_THICKNESS_CM` is the project's board boundary, not a trade standard
 * (see `sheetMaterial.ts`). A part past it is a block: it drops out of the cut
 * list, and with no cut list the C1/C5/C8 documents cannot be produced. That is a
 * manufacturing consequence of the *model*, so it is reported here rather than
 * being discovered when an export is refused. It is a warning, not an error: the
 * piece is physically buildable, it simply is not sheet goods.
 */
export function panelThicknessIssues(bom: BomResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const row of bom.rows) {
    if (row.thicknessMm !== null) {
      continue;
    }
    if (!PANEL_KINDS.includes(row.kind)) {
      continue;
    }
    const smallestCm = Math.min(row.sizeMm.x, row.sizeMm.y, row.sizeMm.z) / 10;
    if (smallestCm <= PANEL_MAX_THICKNESS_CM) {
      continue;
    }
    issues.push(
      issue(
        'warning',
        'panel-too-thick-for-cutlist',
        row.partId,
        `"${row.name}" panel shaklida, lekin eng kichik tomoni ${smallestCm} sm — ` +
          `list materiali chegarasi ${PANEL_MAX_THICKNESS_CM} sm dan qalin. ` +
          `Shuning uchun u kesish ro'yxatiga kirmaydi va kesish rejasi tuzilmaydi.`,
        SOURCE_BOUNDS,
        { partId: row.partId, thicknessCm: smallestCm, limitCm: PANEL_MAX_THICKNESS_CM },
      ),
    );
  }
  return issues;
}

/** True when every corner of the box is finite and the box is not inverted. */
function boundsProblem(box: PartBox): 'non-finite' | 'inverted' | null {
  const values = [box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ];
  if (!values.every((value) => Number.isFinite(value))) {
    return 'non-finite';
  }
  if (box.minX > box.maxX || box.minY > box.maxY || box.minZ > box.maxZ) {
    return 'inverted';
  }
  return null;
}

interface PairOverlap {
  a: string;
  b: string;
  overlapMm: { x: number; y: number; z: number };
}

/** Positive overlap depth per axis, in millimetres (0 when merely touching). */
function overlapDepth(a: PartBox, b: PartBox): { x: number; y: number; z: number } | null {
  const x = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const y = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  const z = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  // Touching or separated on any axis means the boxes do not share volume.
  if (x <= BOUNDS_EPSILON_CM || y <= BOUNDS_EPSILON_CM || z <= BOUNDS_EPSILON_CM) {
    return null;
  }
  return { x: x * 10, y: y * 10, z: z * 10 };
}

/**
 * Find part pairs whose bounding boxes share volume.
 *
 * Broad phase: sort by the lower X bound and sweep, only testing pairs whose X
 * intervals can still overlap. That turns the usual O(n²) pair test into
 * roughly O(n log n + k) for k candidate pairs, which matters because a scene can
 * carry many parts. This is a plain AABB sweep, not a mesh-level test.
 */
export function findOverlappingPairs(boxes: readonly PartBox[]): PairOverlap[] {
  const usable = boxes.filter((box) => boundsProblem(box) === null);
  const sorted = [...usable].sort(
    (a, b) => a.minX - b.minX || a.partId.localeCompare(b.partId),
  );

  const pairs: PairOverlap[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length; j += 1) {
      const b = sorted[j];
      // Once b starts at or after a's far edge on X, no later box can overlap a.
      if (b.minX >= a.maxX - BOUNDS_EPSILON_CM) {
        break;
      }
      const depth = overlapDepth(a, b);
      if (depth) {
        const [first, second] = [a.partId, b.partId].sort();
        pairs.push({ a: first, b: second, overlapMm: depth });
      }
    }
  }
  return pairs.sort((a, b) => a.a.localeCompare(b.a) || a.b.localeCompare(b.b));
}

/**
 * Turn overlapping pairs into a single aggregated warning.
 *
 * This deliberately does **not** claim a defect. The per-type builders embed
 * adjoining parts on purpose (a shelf sits inside the door's depth, a leg butts
 * into the arm), so an AABB volume overlap is the normal case for a correct model.
 * Only a mesh-level intersection test could separate a joint from a mistake, and
 * this project has no such test — so the honest result is one warning saying
 * exactly that, with the pairs attached for inspection.
 */
export function overlapIssue(pairs: readonly PairOverlap[]): ValidationIssue | null {
  if (pairs.length === 0) {
    return null;
  }
  const partIds = [...new Set(pairs.flatMap((pair) => [pair.a, pair.b]))].sort();
  return issue(
    'warning',
    'geometry-overlap-suspected',
    null,
    `AABB bo'yicha ${pairs.length} juft detal hajm bo'lishadi (${partIds.length} detal). Bu xato degani emas: generator qo'shni detallarni ataylab bir-biriga kiritadi. Faqat qo'lda tekshirish aniqlay oladi.`,
    SOURCE_OVERLAP,
    { pairCount: pairs.length, pairs: pairs.map((pair) => ({ ...pair })), partIds },
  );
}

/**
 * Material results for the current part set.
 *
 * The C3 diagnostics are reused as-is: same codes, same levels, same meaning. The
 * only new check here is an assignment that points at a part the model no longer
 * has — C3 silently ignored those, which hides a stale reference after a
 * parameter change.
 */
export function validateMaterials(
  rows: ReadonlyArray<{ partId: string }>,
  sheetMaterials: readonly SheetMaterialEntry[] | null | undefined,
  c3Issues: ReadonlyArray<{
    level: ValidationLevel;
    code: SheetIssueCode;
    partId: string | null;
    message: string;
  }>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = c3Issues
    .filter((entry) => entry.level !== 'info')
    .map((entry) => ({
      level: entry.level,
      code: entry.code,
      partId: entry.partId,
      message: entry.message,
      source: SOURCE_MATERIAL,
    }));

  const known = new Set(rows.map((row) => row.partId));
  const stale = (sheetMaterials ?? [])
    .map((entry) => entry?.partId)
    .filter((partId): partId is string => typeof partId === 'string' && partId !== '')
    .filter((partId) => !known.has(partId));
  for (const partId of [...new Set(stale)].sort()) {
    issues.push(
      issue(
        'warning',
        'material-assignment-stale',
        partId,
        `Material biriktirilgan detal modelda topilmadi: ${partId}. Parametr o'zgargan bo'lishi mumkin — biriktirishni qayta tekshiring.`,
        SOURCE_MATERIAL,
        { partId },
      ),
    );
  }

  return issues;
}

/**
 * Drop exact repeats while keeping the first occurrence.
 *
 * C3 reports a bad thickness twice (once for the assignment list, once for the
 * row) and reports "no material" once per part with identical text. Both are
 * correct in the BOM's own context but would flood this report, so identical
 * `code` + `partId` + `message` triples are collapsed here. Distinct conditions
 * are never merged.
 */
export function dedupeIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  const result: ValidationIssue[] = [];
  for (const entry of issues) {
    const key = `${entry.code}\u0000${entry.partId ?? ''}\u0000${entry.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function summarise(rawIssues: ValidationIssue[], limitations: string[]): ValidationReport {
  const issues = dedupeIssues(rawIssues);
  const counts: Record<ValidationLevel, number> = { error: 0, warning: 0, info: 0 };
  for (const entry of issues) {
    counts[entry.level] += 1;
  }
  return { ok: counts.error === 0, issues, counts, limitations };
}

/**
 * Validate one piece end to end.
 *
 * Deterministic: the same type, parameters and assignments always produce the same
 * issues in the same order. No timestamps, no random ids, no reliance on object
 * insertion order.
 */
export function validateManufacturing(
  type: FurnitureType,
  params: FurnitureParams,
  sheetMaterials?: readonly SheetMaterialEntry[] | null,
): ValidationReport {
  const limitations: string[] = [
    "AABB (chegara qutisi) tekshiruvi: haqiqiy mesh kesishuvi hisoblanmaydi.",
    "Yuk ko'tarish, mustahkamlik, birikma va material standartlari modelda yo'q — ular tekshirilmadi.",
    'Bu hisobot ishlab chiqarishga yaroqlilik sertifikati emas.',
  ];

  const dimensionIssues = validateDimensions(type, params);
  if (!dimensionIssues.some((entry) => entry.level === 'error')) {
    // Geometry and material results are meaningless while the parameters are bad,
    // so those checks are skipped and named instead of being reported as clean.
    const bomOutcome = buildBom(type, params, sheetMaterials);
    if (!bomOutcome.ok) {
      dimensionIssues.push(
        issue('error', 'geometry-bounds-invalid', null, bomOutcome.reason, SOURCE_BOUNDS),
      );
      limitations.push('Geometriya va material tekshiruvi bajarilmadi: model olchanmadi.');
    } else {
      const built = buildFurniture(type, params);
      let boxes: PartBox[];
      try {
        boxes = measurePartBoxes(built.group);
      } finally {
        built.dispose();
      }

      if (boxes.length === 0) {
        dimensionIssues.push(
          issue(
            'error',
            'geometry-bounds-invalid',
            null,
            "Modelda olchanadigan detal topilmadi — chegara qutilari yaroqsiz.",
            SOURCE_BOUNDS,
          ),
        );
      } else {
        for (const box of boxes) {
          const problem = boundsProblem(box);
          if (problem === 'non-finite') {
            dimensionIssues.push(
              issue(
                'error',
                'dimension-non-finite',
                box.partId,
                `Detal chegarasi chekli emas: ${box.partId}.`,
                SOURCE_BOUNDS,
                { partId: box.partId },
              ),
            );
          } else if (problem === 'inverted') {
            dimensionIssues.push(
              issue(
                'error',
                'geometry-bounds-invalid',
                box.partId,
                `Detal chegarasi teskari (min > max): ${box.partId}.`,
                SOURCE_BOUNDS,
                { partId: box.partId },
              ),
            );
          }
        }

        const overlap = overlapIssue(findOverlappingPairs(boxes));
        if (overlap) {
          dimensionIssues.push(overlap);
        }
      }

      dimensionIssues.push(...panelThicknessIssues(bomOutcome.bom));

      const materialIssues = validateMaterials(
        bomOutcome.bom.rows,
        sheetMaterials,
        bomOutcome.bom.issues,
      );
      dimensionIssues.push(...materialIssues);

      if (!sheetMaterials || sheetMaterials.length === 0) {
        limitations.push(
          'Material biriktirilmagan: qalinlik va material bo\'yicha tekshiruv mavjud emas.',
        );
      }
    }
  } else {
    limitations.push(
      "Parametrlar yaroqsiz bo'lgani uchun geometriya va material tekshiruvi bajarilmadi.",
    );
  }

  return summarise(dimensionIssues, limitations);
}
