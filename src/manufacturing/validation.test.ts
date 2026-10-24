import { describe, expect, it } from 'vitest';
import {
  dedupeIssues,
  findOverlappingPairs,
  overlapIssue,
  validateDimensions,
  validateManufacturing,
  type ValidationIssue,
} from './validation';
import { buildBom } from './bom';
import type { PartBox } from './technicalDrawing';
import {
  FURNITURE_FIELDS,
  FURNITURE_TYPES,
  createFurnitureParams,
  type FurnitureParams,
  type FurnitureType,
} from '../geometry/furniture/types';
import type { SheetMaterialEntry } from './sheetMaterial';

function paramsFor(type: FurnitureType): FurnitureParams {
  return createFurnitureParams(type);
}

function withField(type: FurnitureType, key: string, value: unknown): FurnitureParams {
  return { ...paramsFor(type), [key]: value } as FurnitureParams;
}

function byCode(issues: ValidationIssue[], code: string) {
  return issues.filter((entry) => entry.code === code);
}

function assignment(overrides: Partial<SheetMaterialEntry> = {}): SheetMaterialEntry {
  return {
    partId: 'wardrobe-door',
    materialId: 'mdf',
    thicknessMm: 12,
    thicknessSource: 'user',
    ...overrides,
  };
}

/** Naive O(n^2) reference used to prove the sweep finds the same pairs. */
function naivePairs(list: PartBox[]): string[] {
  const found: string[] = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      const x = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      const y = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
      const z = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
      if (x > 1e-6 && y > 1e-6 && z > 1e-6) {
        found.push([a.partId, b.partId].sort().join('|'));
      }
    }
  }
  return found.sort();
}

describe('C4 — dimensions', () => {
  it('raises no dimension issue for every built-in type', () => {
    for (const type of FURNITURE_TYPES) {
      const issues = validateDimensions(type, paramsFor(type));
      expect(issues, `${type} should be clean`).toHaveLength(0);
    }
  });

  it('detects non-finite dimensions', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const issues = validateDimensions('table', withField('table', 'widthCm', bad));
      const found = byCode(issues, 'dimension-non-finite');
      expect(found).toHaveLength(1);
      expect(found[0].level).toBe('error');
      expect(found[0].details?.field).toBe('widthCm');
    }
  });

  it('detects a zero or negative value where the field requires a positive one', () => {
    const zero = validateDimensions('table', withField('table', 'topThicknessCm', 0));
    const found = byCode(zero, 'dimension-non-positive');
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('error');
    expect(found[0].details?.field).toBe('topThicknessCm');

    const negative = validateDimensions('table', withField('table', 'widthCm', -120));
    expect(byCode(negative, 'dimension-non-positive')).toHaveLength(1);
  });

  it('accepts zero for a channel whose declared range starts at zero', () => {
    // A dresser legitimately has no doors: the field range is 0..2.
    const spec = FURNITURE_FIELDS.dresser.find((entry) => entry.key === 'doorCount');
    expect(spec?.range.min).toBe(0);
    const issues = validateDimensions('dresser', withField('dresser', 'doorCount', 0));
    expect(issues).toHaveLength(0);
  });

  it('enforces the declared range and reports the actual limit', () => {
    const spec = FURNITURE_FIELDS.wardrobe.find((entry) => entry.key === 'heightCm');
    if (!spec) throw new Error('heightCm spec missing');

    const issues = validateDimensions('wardrobe', withField('wardrobe', 'heightCm', spec.range.max + 1));
    const found = byCode(issues, 'dimension-limit-exceeded');
    expect(found).toHaveLength(1);
    expect(found[0].details).toMatchObject({
      field: 'heightCm',
      min: spec.range.min,
      max: spec.range.max,
      rule: 'range',
    });
    // The message names the real bound, not a rounded stand-in.
    expect(found[0].message).toContain(String(spec.range.min));
    expect(found[0].message).toContain(String(spec.range.max));
  });

  it('accepts the exact boundary values', () => {
    for (const type of FURNITURE_TYPES) {
      for (const spec of FURNITURE_FIELDS[type]) {
        for (const boundary of [spec.range.min, spec.range.max]) {
          const issues = validateDimensions(type, withField(type, spec.key, boundary));
          // A boundary value must never be reported as a range violation.
          expect(
            byCode(issues, 'dimension-limit-exceeded').filter(
              (entry) => entry.details?.field === spec.key && entry.details?.rule === 'range',
            ),
            `${type}.${spec.key} at ${boundary}`,
          ).toHaveLength(0);
        }
      }
    }
  });

  it('detects a non-integer value for an integer field', () => {
    const issues = validateDimensions('wardrobe', withField('wardrobe', 'shelfCount', 2.5));
    const found = byCode(issues, 'dimension-limit-exceeded').filter(
      (entry) => entry.details?.rule === 'integer',
    );
    expect(found).toHaveLength(1);
    expect(found[0].details?.field).toBe('shelfCount');
  });

  it('detects a parameter combination the project already rejects', () => {
    // relationErrors: seat height must stay strictly below the overall height.
    // Both values are inside their own ranges (height 60..130, seat 25..60), so
    // only the cross-field rule can catch this.
    const issues = validateDimensions('sofa', {
      ...paramsFor('sofa'),
      heightCm: 60,
      seatHeightCm: 60,
    });
    const found = byCode(issues, 'dimension-relation-invalid');
    expect(found.length).toBeGreaterThanOrEqual(1);
    const seat = found.find((entry) => entry.details?.field === 'seatHeightCm');
    expect(seat?.level).toBe('error');
    // Every relation issue is an error and names the field it concerns.
    for (const entry of found) {
      expect(entry.level).toBe('error');
      expect(typeof entry.details?.field).toBe('string');
    }
  });

  it('never reports a dimension issue for a valid model passed through the report', () => {
    for (const type of FURNITURE_TYPES) {
      const report = validateManufacturing(type, paramsFor(type));
      expect(report.counts.error, `${type} must not produce errors`).toBe(0);
      expect(byCode(report.issues, 'dimension-non-finite')).toHaveLength(0);
      expect(byCode(report.issues, 'dimension-non-positive')).toHaveLength(0);
      expect(byCode(report.issues, 'dimension-limit-exceeded')).toHaveLength(0);
    }
  });
});

describe('C4 — geometry bounds and overlaps', () => {
  function box(partId: string, min: [number, number, number], max: [number, number, number]): PartBox {
    return { partId, minX: min[0], minY: min[1], minZ: min[2], maxX: max[0], maxY: max[1], maxZ: max[2] };
  }

  it('reports a clear overlap between distinct parts as a suspected warning', () => {
    const pairs = findOverlappingPairs([
      box('a', [0, 0, 0], [10, 10, 10]),
      box('b', [5, 5, 5], [15, 15, 15]),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ a: 'a', b: 'b' });

    const issue = overlapIssue(pairs);
    expect(issue?.level).toBe('warning');
    expect(issue?.code).toBe('geometry-overlap-suspected');
    // The wording must not claim a defect: AABB overlap is not a mesh collision.
    expect(issue?.message).toMatch(/xato degani emas/i);
    expect(issue?.details?.pairCount).toBe(1);
  });

  it('does not treat touching boundaries as a collision', () => {
    // Faces meet exactly at x = 10.
    const pairs = findOverlappingPairs([
      box('a', [0, 0, 0], [10, 10, 10]),
      box('b', [10, 0, 0], [20, 10, 10]),
    ]);
    expect(pairs).toHaveLength(0);
    expect(overlapIssue(pairs)).toBeNull();
  });

  it('does not treat a shared edge or corner as a collision', () => {
    const edge = findOverlappingPairs([
      box('a', [0, 0, 0], [10, 10, 10]),
      box('b', [10, 10, 0], [20, 20, 10]),
    ]);
    expect(edge).toHaveLength(0);

    const corner = findOverlappingPairs([
      box('a', [0, 0, 0], [10, 10, 10]),
      box('b', [10, 10, 10], [20, 20, 20]),
    ]);
    expect(corner).toHaveLength(0);
  });

  it('ignores inverted and non-finite boxes instead of inventing collisions', () => {
    const inverted = box('bad', [10, 0, 0], [-10, 5, 5]);
    const nan = box('nan', [Number.NaN, 0, 0], [5, 5, 5]);
    const good = box('good', [0, 0, 0], [10, 10, 10]);

    const pairs = findOverlappingPairs([inverted, nan, good]);
    expect(pairs).toHaveLength(0);

    const report = validateManufacturing('table', paramsFor('table'));
    // Sanity: a healthy model still works with the same helper.
    expect(report.ok).toBe(true);
  });

  it('reports invalid bounds as errors when they reach the report', () => {
    const report = validateManufacturing('table', {
      ...paramsFor('table'),
      widthCm: Number.NaN,
    });
    const bounds = byCode(report.issues, 'dimension-non-finite');
    expect(bounds.length).toBeGreaterThan(0);
    expect(report.ok).toBe(false);
    // Geometry was not evaluated, and the report says so instead of staying silent.
    expect(report.limitations.join(' ')).toMatch(/geometriya va material tekshiruvi bajarilmadi/i);
  });

  it('finds the same pairs as the naive O(n^2) check', () => {
    // Deterministic pseudo-random layout, many boxes, mixed overlaps.
    let seed = 42;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const generated: PartBox[] = Array.from({ length: 120 }, (_, index) => {
      const x = Math.round(next() * 100);
      const y = Math.round(next() * 100);
      const z = Math.round(next() * 100);
      const w = 1 + Math.round(next() * 20);
      const h = 1 + Math.round(next() * 20);
      const d = 1 + Math.round(next() * 20);
      return box(`p${index}`, [x, y, z], [x + w, y + h, z + d]);
    });

    const sweep = findOverlappingPairs(generated)
      .map((pair) => `${pair.a}|${pair.b}`)
      .sort();
    expect(sweep).toEqual(naivePairs(generated));
  });

  it('aggregates overlapping pairs into a single issue instead of flooding', () => {
    const report = validateManufacturing('wardrobe', paramsFor('wardrobe'));
    const overlaps = byCode(report.issues, 'geometry-overlap-suspected');
    // The wardrobe has several embedded shelves/doors but reports once.
    expect(overlaps).toHaveLength(1);
    expect(Number(overlaps[0].details?.pairCount)).toBeGreaterThan(1);
  });

  it('does not turn the generators intentional joints into errors', () => {
    for (const type of FURNITURE_TYPES) {
      const report = validateManufacturing(type, paramsFor(type));
      expect(byCode(report.issues, 'geometry-overlap-suspected').every((e) => e.level === 'warning')).toBe(
        true,
      );
    }
  });

  it('is deterministic for the same model', () => {
    for (const type of FURNITURE_TYPES) {
      const first = validateManufacturing(type, paramsFor(type));
      const second = validateManufacturing(type, paramsFor(type));
      expect(second).toEqual(first);
    }
  });
});

describe('C4 — material integration', () => {
  it('reuses the C3 codes and severity', () => {
    const report = validateManufacturing('wardrobe', paramsFor('wardrobe'), [
      assignment({ thicknessMm: 99 }),
    ]);
    const found = byCode(report.issues, 'bad-thickness');
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('error');
    // Same condition, same code as C3 — not a second name for it.
    expect(found[0].source).toBe('manufacturing/sheetMaterial');
  });

  it('keeps a geometry mismatch as a warning, not an error', () => {
    const report = validateManufacturing('wardrobe', paramsFor('wardrobe'), [
      assignment({ partId: 'wardrobe-door', thicknessMm: 18 }),
    ]);
    const found = byCode(report.issues, 'thickness-mismatch');
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('warning');
    expect(report.ok).toBe(true);
  });

  it('never lets the nominal thickness replace the measured one', () => {
    const bom = buildBom('wardrobe', paramsFor('wardrobe'), [
      assignment({ partId: 'wardrobe-door', thicknessMm: 18 }),
    ]);
    if (!bom.ok) throw new Error(bom.reason);
    const door = bom.bom.rows.find((row) => row.partId === 'wardrobe-door');
    expect(door?.thicknessMm).toBe(12);
    expect(door?.material?.thicknessMm).toBe(18);
  });

  it('flags an assignment pointing at a part the model no longer has', () => {
    const report = validateManufacturing('wardrobe', paramsFor('wardrobe'), [
      assignment({ partId: 'wardrobe-drawer' }),
    ]);
    const stale = byCode(report.issues, 'material-assignment-stale');
    expect(stale).toHaveLength(1);
    expect(stale[0].level).toBe('warning');
    expect(stale[0].partId).toBe('wardrobe-drawer');
  });

  it('accepts assignments that match real parts', () => {
    const report = validateManufacturing('wardrobe', paramsFor('wardrobe'), [assignment()]);
    expect(byCode(report.issues, 'material-assignment-stale')).toHaveLength(0);
  });

  it('survives a model with no material data at all', () => {
    for (const type of FURNITURE_TYPES) {
      const report = validateManufacturing(type, paramsFor(type));
      expect(report.issues.length).toBeGreaterThan(0);
      expect(report.counts.error).toBe(0);
      expect(byCode(report.issues, 'material-missing')).toHaveLength(1);
    }
  });

  it('does not claim a thickness mismatch when no material exists', () => {
    const report = validateManufacturing('wardrobe', paramsFor('wardrobe'));
    expect(byCode(report.issues, 'thickness-mismatch')).toHaveLength(0);
    expect(byCode(report.issues, 'bad-thickness')).toHaveLength(0);
  });

  it('handles a missing nominal thickness without crashing', () => {
    const broken = [{ ...assignment(), thicknessMm: Number.NaN }];
    const report = validateManufacturing('wardrobe', paramsFor('wardrobe'), broken);
    expect(byCode(report.issues, 'bad-thickness')).toHaveLength(1);
    expect(report.counts.error).toBeGreaterThan(0);
  });
});

describe('C4 — report shape', () => {
  it('separates errors, warnings and info in the counts', () => {
    const report = validateManufacturing('table', withField('table', 'widthCm', Number.NaN));
    expect(report.counts.error).toBeGreaterThan(0);
    expect(report.counts.error + report.counts.warning + report.counts.info).toBe(
      report.issues.length,
    );
  });

  it('marks the report not ok when an error exists', () => {
    expect(validateManufacturing('table', paramsFor('table')).ok).toBe(true);
    expect(validateManufacturing('table', withField('table', 'heightCm', -1)).ok).toBe(false);
  });

  it('always states what it did not check', () => {
    const report = validateManufacturing('table', paramsFor('table'));
    const text = report.limitations.join(' ');
    expect(text).toMatch(/AABB/i);
    expect(text).toMatch(/sertifikat/i);
    expect(text).toMatch(/mustahkamlik/i);
  });

  it('gives each issue a stable code, level, message and source', () => {
    const report = validateManufacturing('wardrobe', paramsFor('wardrobe'), [
      assignment({ thicknessMm: 18 }),
    ]);
    for (const entry of report.issues) {
      expect(typeof entry.code).toBe('string');
      expect(entry.code.length).toBeGreaterThan(0);
      expect(['error', 'warning', 'info']).toContain(entry.level);
      expect(entry.message.length).toBeGreaterThan(0);
      expect(entry.source.length).toBeGreaterThan(0);
    }
  });

  it('collapses exact duplicates but keeps distinct conditions', () => {
    const duplicate: ValidationIssue = {
      level: 'warning',
      code: 'material-missing',
      partId: null,
      message: 'same',
      source: 'x',
    };
    expect(dedupeIssues([duplicate, { ...duplicate }])).toHaveLength(1);
    expect(dedupeIssues([duplicate, { ...duplicate, message: 'other' }])).toHaveLength(2);
    expect(dedupeIssues([duplicate, { ...duplicate, partId: 'p' }])).toHaveLength(2);
  });

  it('does not repeat the C3 duplicate thickness error twice', () => {
    const report = validateManufacturing('wardrobe', paramsFor('wardrobe'), [
      assignment({ thicknessMm: 99 }),
    ]);
    expect(byCode(report.issues, 'bad-thickness')).toHaveLength(1);
  });
});
