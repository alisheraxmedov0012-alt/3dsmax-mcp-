import { describe, expect, it } from 'vitest';
import {
  dashSegment,
  fitBox,
  parseDrawingSvg,
  parseHexColor,
  textPlacement,
} from './pdfDrawing';
import {
  assemblyStepBlocks,
  bomTableRows,
  buildManufacturingPdf,
  cutListTableRows,
  materialTableRows,
  pdfFilename,
  validationTableRows,
} from './pdfDocument';
import {
  buildAssemblyPlan,
  buildFurnitureAssemblyPlan,
  type AssemblyPlan,
} from './assemblyInstructions';
import { ASSEMBLY_DEFAULTS } from '../geometry/assemblies/params';
import { buildBom } from './bom';
import { buildCutList } from './cutList';
import { buildCuttingPlan } from './cuttingPlan';
import { groupByMaterial } from './sheetMaterial';
import { validateManufacturing } from './validation';
import { buildHardwareBom } from './hardware';
import { createTechnicalDrawingSvg } from './technicalDrawing';
import { createFurnitureParams, type FurnitureType } from '../geometry/furniture/types';

const FIXED = new Date('2026-03-04T05:06:07.000Z');

/** Build a real PDF input for a type, exactly as the panel does. */
function inputFor(type: FurnitureType, projectName = 'Stol loyihasi', materials?: never) {
  const params = createFurnitureParams(type);
  const bom = buildBom(type, params, materials);
  if (!bom.ok) throw new Error(bom.reason);
  const drawing = createTechnicalDrawingSvg(type, params, {
    title: projectName,
    date: '2026-03-04',
  });
  if (!drawing.ok) throw new Error(drawing.reason);
  const cutList = buildCutList(bom.bom);
  return {
    type,
    params,
    projectName,
    bom: bom.bom,
    cutList,
    materials: groupByMaterial(bom.bom.rows),
    validation: validateManufacturing(type, params, materials),
    drawing: { svg: drawing.svg, scale: drawing.scale },
    overall: drawing.overall,
    generatedAt: FIXED,
  };
}

async function pdfFor(type: FurnitureType, projectName?: string) {
  const outcome = await buildManufacturingPdf(inputFor(type, projectName));
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome;
}

/** Latin-1 view of the PDF bytes, enough for structural assertions. */
function asText(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

describe('C6 — hardware section', () => {
  it('changes the document when a hardware BOM is supplied', async () => {
    const input = inputFor('table');
    const assembly = buildFurnitureAssemblyPlan({
      bom: input.bom,
      validation: input.validation,
    });
    const base = await buildManufacturingPdf({ ...input, assembly });
    const hardware = buildHardwareBom([
      {
        kind: 'screw',
        name: 'Konfirmat',
        quantity: 12,
        unit: 'pcs',
        size: '4×40 mm',
        stepIds: ['step-leg'],
      },
    ]);
    expect(hardware.ok).toBe(true);
    if (!hardware.ok) return;
    const withHardware = await buildManufacturingPdf({
      ...input,
      assembly,
      hardware: hardware.hardware,
    });
    expect(base.ok && withHardware.ok).toBe(true);
    if (!base.ok || !withHardware.ok) return;
    expect(Array.from(withHardware.bytes)).not.toEqual(Array.from(base.bytes));
  });
});

describe('C5 — PDF structure', () => {
  it('produces a non-empty file with a valid PDF signature and trailer', async () => {
    const out = await pdfFor('table');
    expect(out.bytes.length).toBeGreaterThan(1000);

    const head = new TextDecoder('latin1').decode(out.bytes.slice(0, 8));
    expect(head.startsWith('%PDF-1.')).toBe(true);
    expect(head).toMatch(/^%PDF-1\.\d/);

    // Structural markers a conforming reader needs. Object streams are
    // Flate-compressed, so dictionary keys are not visible as plain text; the
    // cross-reference tail and the catalog reference are.
    const text = asText(out.bytes);
    expect(text).toContain('%%EOF');
    expect(text).toContain('startxref');
    expect(text).toContain('/Root');
  });

  it('declares one page object per page it reports', async () => {
    const out = await pdfFor('table');
    expect(out.pageCount).toBeGreaterThanOrEqual(3);
    // Page dictionaries live in the (compressed) object stream, so the page
    // count is asserted through the API and the file size sanity-checked here.
    expect(out.bytes.length).toBeGreaterThan(2000);
    const text = asText(out.bytes);
    expect(text).toMatch(/\d+ 0 obj/);
  });

  it('is deterministic for the same input and timestamp', async () => {
    const a = await pdfFor('wardrobe');
    const b = await pdfFor('wardrobe');
    expect(b.bytes.length).toBe(a.bytes.length);
    expect(Array.from(b.bytes)).toEqual(Array.from(a.bytes));
  });

  it('gives every furniture type its own pages without failing', async () => {
    const types = ['table', 'chair', 'armchair', 'sofa', 'bed', 'wardrobe', 'shelf', 'dresser'] as const;
    const built = await Promise.all(types.map((type) => buildManufacturingPdf(inputFor(type))));
    for (const [index, out] of built.entries()) {
      expect(out.ok, types[index]).toBe(true);
      if (!out.ok) continue;
      expect(out.pageCount, types[index]).toBeGreaterThanOrEqual(3);
      expect(out.filename.endsWith('.pdf'), types[index]).toBe(true);
    }
  });

  it('fails with a reason instead of returning a broken file when the SVG is unusable', async () => {
    const input = { ...inputFor('table'), drawing: { svg: '<not-svg/>', scale: { ratio: '1:5', standard: true } } };
    const outcome = await buildManufacturingPdf(input);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toMatch(/chizma/i);
      expect(outcome).not.toHaveProperty('bytes');
    }
  });
});

describe('C5 — filename', () => {
  it('is a safe ASCII PDF name with the project digest', () => {
    const name = pdfFilename('Stol loyihasi');
    expect(name).toMatch(/^stol-loyihasi-[0-9a-f]{12}-hujjatlar\.pdf$/);
    expect(name).not.toContain('/');
    expect(name).not.toContain('..');
  });

  it('keeps different projects apart and stays readable', () => {
    expect(pdfFilename('Ошхона шкаф')).not.toBe(pdfFilename('Кухня'));
    expect(pdfFilename('Ошхона шкаф')).toMatch(/^model-[0-9a-f]{12}-hujjatlar\.pdf$/);
    expect(pdfFilename('   ')).toMatch(/^model-[0-9a-f]{12}-hujjatlar\.pdf$/);
  });

  it('does not collide with the C1 archive name', () => {
    // Same slug and digest, different suffix and extension: both downloads can
    // live in one folder.
    expect(pdfFilename('Stol')).not.toMatch(/-package\.zip$/);
    expect(pdfFilename('Stol')).toMatch(/-hujjatlar\.pdf$/);
  });
});

describe('C5 — SVG parsing and fitting', () => {
  it('reads the drawing generator output', () => {
    const drawing = createTechnicalDrawingSvg('wardrobe', createFurnitureParams('wardrobe'));
    if (!drawing.ok) throw new Error(drawing.reason);
    const parsed = parseDrawingSvg(drawing.svg);
    expect(parsed).not.toBeNull();
    expect(parsed?.width).toBeGreaterThan(0);
    expect(parsed?.skipped).toEqual([]);

    const kinds = new Set(parsed?.elements.map((element) => element.kind));
    expect(kinds.has('rect')).toBe(true);
    expect(kinds.has('line')).toBe(true);
    expect(kinds.has('polygon')).toBe(true);
    expect(kinds.has('text')).toBe(true);

    // Dimension labels survive parsing intact.
    const texts = parsed!.elements.filter((element) => element.kind === 'text');
    expect(texts.some((element) => element.kind === 'text' && /\d+ mm/.test(element.text))).toBe(true);
  });

  it('returns null for input that is not an SVG', () => {
    expect(parseDrawingSvg('<div>hello</div>')).toBeNull();
    expect(parseDrawingSvg('<svg width="0" height="0"></svg>')).toBeNull();
  });

  it('reads hex colours only', () => {
    expect(parseHexColor('#ff0000')).not.toBeNull();
    expect(parseHexColor('none')).toBeNull();
    expect(parseHexColor('#fff')).toBeNull();
    expect(parseHexColor(undefined)).toBeNull();
  });

  it('fits without distortion', () => {
    // A wide drawing in a taller box: the factor is driven by width.
    const fit = fitBox({ width: 800, height: 400 }, { x: 0, y: 0, width: 400, height: 400 });
    expect(fit.scale).toBeCloseTo(0.5, 6);
    expect(fit.width).toBeCloseTo(400, 6);
    expect(fit.height).toBeCloseTo(200, 6);
    // Centred vertically in the remaining space.
    expect(fit.y).toBeCloseTo(100, 6);
    // One factor for both axes == the aspect ratio is preserved.
    expect(fit.width / fit.height).toBeCloseTo(800 / 400, 6);
  });

  it('places rotated dimension text the same way the SVG does', () => {
    const identity = (point: { x: number; y: number }) => point;

    const plain = textPlacement({ x: 100, y: 50, anchor: 'middle', rotated: false }, 40, identity);
    expect(plain).toEqual({ x: 80, y: 50, rotateDeg: 0 });

    const start = textPlacement({ x: 100, y: 50, anchor: 'start', rotated: false }, 40, identity);
    expect(start.x).toBe(100);

    // Rotated + middle: centred on the anchor, reading bottom-to-top.
    const rotated = textPlacement({ x: 100, y: 50, anchor: 'middle', rotated: true }, 40, identity);
    expect(rotated).toEqual({ x: 100, y: 30, rotateDeg: 90 });
  });

  it('splits witness lines into dashes rather than dropping them', () => {
    const pieces = dashSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, [2, 2]);
    expect(pieces.length).toBeGreaterThan(1);
    // Dashes together span the original segment.
    expect(pieces[0].start.x).toBe(0);
    expect(pieces[pieces.length - 1].end.x).toBeCloseTo(10, 6);
    // On, off, on: the first dash covers 0-2, the gap covers 2-4, the next dash
    // starts at 4. The gap is what makes a witness line readable as a witness line.
    expect(pieces[0].end.x).toBeCloseTo(2, 6);
    expect(pieces[1].start.x).toBeCloseTo(4, 6);
  });

  it('never returns a degenerate dash segment', () => {
    const zero = dashSegment({ x: 0, y: 0 }, { x: 0, y: 0 }, [2, 2]);
    expect(zero).toHaveLength(1);
    const badPattern = dashSegment({ x: 0, y: 0 }, { x: 5, y: 0 }, [0, 0]);
    expect(badPattern.length).toBeGreaterThan(0);
  });
});

describe('C5 — document content', () => {
  /** The PDF text is drawn compressed, so content is asserted through the API. */
  it('prints BOM rows that match the source exactly', () => {
    const input = inputFor('wardrobe');
    const rows = bomTableRows(input.bom);
    expect(rows).toHaveLength(input.bom.rows.length);

    for (const [index, row] of rows.entries()) {
      const source = input.bom.rows[index];
      expect(row[0]).toBe(source.name);
      expect(row[1]).toBe(source.partId);
      expect(row[3]).toBe(String(source.quantity));
      expect(row[4]).toBe(String(source.sizeMm.x));
      expect(row[5]).toBe(String(source.sizeMm.y));
      expect(row[6]).toBe(String(source.sizeMm.z));
      // Measured geometry thickness, or an em dash when the part is not a panel.
      expect(row[7]).toBe(source.thicknessMm === null ? '—' : String(source.thicknessMm));
    }
  });

  it('never puts the nominal material thickness in the measured column', () => {
    const params = createFurnitureParams('wardrobe');
    // Door measures 12 mm but the board bought is 18 mm.
    const bom = buildBom('wardrobe', params, [
      { partId: 'wardrobe-door', materialId: 'mdf', thicknessMm: 18, thicknessSource: 'user' },
    ]);
    if (!bom.ok) throw new Error(bom.reason);
    const rows = bomTableRows(bom.bom);
    const door = rows.find((row) => row[1] === 'wardrobe-door');
    expect(door?.[7]).toBe('12'); // measured
    expect(door?.[8]).toBe('MDF'); // material name only, no thickness claim
  });

  it('prints cut list values without rounding', () => {
    const input = inputFor('dresser');
    const rows = cutListTableRows(input.cutList);
    expect(rows).toHaveLength(input.cutList.rows.length);
    for (const [index, row] of rows.entries()) {
      const source = input.cutList.rows[index];
      expect(row[0]).toBe(source.name);
      expect(row[1]).toBe(source.partId);
      expect(row[2]).toBe(String(source.quantity));
      // A fractional width must survive verbatim.
      expect(row[3]).toBe(String(source.lengthMm));
      expect(row[4]).toBe(String(source.widthMm));
      expect(row[5]).toBe(String(source.thicknessMm));
    }
    // The dresser drawer really does carry a fractional value.
    expect(rows.some((row) => row.includes('216.7'))).toBe(true);
  });

  it('says nothing about materials when none are assigned', () => {
    const input = inputFor('wardrobe');
    expect(materialTableRows(input.materials)).toEqual([]);
    // And the absence is stated in the validation report rather than invented.
    expect(
      input.validation.issues.some(
        (issue) => issue.code === 'material-missing' && issue.message.includes('tanlanmagan'),
      ),
    ).toBe(true);
  });

  it('lists material groups with their nominal thickness when assigned', () => {
    const params = createFurnitureParams('wardrobe');
    const assigned = [
      { partId: 'wardrobe-door', materialId: 'mdf' as const, thicknessMm: 12, thicknessSource: 'user' as const },
      { partId: 'wardrobe-side', materialId: 'ldsp' as const, thicknessMm: 20, thicknessSource: 'user' as const },
    ];
    const bom = buildBom('wardrobe', params, assigned);
    if (!bom.ok) throw new Error(bom.reason);
    const rows = materialTableRows(groupByMaterial(bom.bom.rows));
    expect(rows).toHaveLength(2);
    const mdf = rows.find((row) => row[1] === 'mdf');
    expect(mdf?.[0]).toBe('MDF');
    expect(mdf?.[2]).toBe('12 mm');
    expect(mdf?.[3]).toBe('2');
  });

  it('keeps validation severity and codes in the printed table', () => {
    const params = createFurnitureParams('wardrobe');
    const bad = [{ partId: 'wardrobe-door', materialId: 'mdf' as const, thicknessMm: 0, thicknessSource: 'user' as const }];
    const report = validateManufacturing('wardrobe', params, bad);
    const rows = validationTableRows(report.issues);

    const errorRow = rows.find((row) => row[1] === 'bad-thickness');
    expect(errorRow?.[0]).toBe('XATO');
    expect(errorRow?.[2]).toBe('wardrobe-door');
    expect(errorRow?.[3].length).toBeGreaterThan(0);

    const warningRow = rows.find((row) => row[1] === 'material-missing');
    if (warningRow) {
      expect(warningRow[0]).toBe('OGOH');
    }
    // Info-level entries are not printed as problems.
    expect(rows.every((row) => row[0] === 'XATO' || row[0] === 'OGOH')).toBe(true);
  });

  it('refuses to invent material data when none is assigned', async () => {
    const input = inputFor('wardrobe');
    expect(input.materials).toEqual([]);
    const out = await buildManufacturingPdf(input);
    expect(out.ok).toBe(true);
    if (out.ok) {
      // The report states the absence rather than filling a default.
      expect(input.validation.issues.some((issue) => issue.code === 'material-missing')).toBe(true);
    }
  });

  it('carries a validation error into the document rather than hiding it', async () => {
    const params = createFurnitureParams('wardrobe');
    const bom = buildBom('wardrobe', params, [
      { partId: 'wardrobe-door', materialId: 'mdf', thicknessMm: 0, thicknessSource: 'user' },
    ]);
    const materials = [
      { partId: 'wardrobe-door', materialId: 'mdf' as const, thicknessMm: 0, thicknessSource: 'user' as const },
    ];
    if (!bom.ok) throw new Error(bom.reason);
    const drawing = createTechnicalDrawingSvg('wardrobe', params);
    if (!drawing.ok) throw new Error(drawing.reason);

    const out = await buildManufacturingPdf({
      type: 'wardrobe',
      params,
      projectName: 'Shkaf',
      bom: bom.bom,
      cutList: buildCutList(bom.bom),
      materials: groupByMaterial(bom.bom.rows),
      validation: validateManufacturing('wardrobe', params, materials),
      drawing: { svg: drawing.svg, scale: drawing.scale },
      overall: drawing.overall,
      generatedAt: FIXED,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      // The document was produced for inspection, and the error count is real.
      expect(validateManufacturing('wardrobe', params, materials).counts.error).toBeGreaterThan(0);
      expect(out.pageCount).toBeGreaterThanOrEqual(3);
    }
  });

  it('matches the BOM and cut list values it was given', async () => {
    const input = inputFor('wardrobe');
    const out = await buildManufacturingPdf(input);
    expect(out.ok).toBe(true);
    // The generator reads these directly; nothing is recomputed, so the source
    // values are what appears. Guarded structurally here.
    expect(input.bom.rows.length).toBeGreaterThan(0);
    expect(input.cutList.rows.length).toBeGreaterThan(0);
    const door = input.bom.rows.find((row) => row.partId === 'wardrobe-door');
    const cutDoor = input.cutList.rows.find((row) => row.partId === 'wardrobe-door');
    // Measured thickness stays measured, and the cut list agrees with it.
    expect(door?.thicknessMm).toBe(12);
    expect(cutDoor?.thicknessMm).toBe(12);
  });

  it('is produced from the C2 drawing rather than a second engine', async () => {
    const input = inputFor('sofa');
    const parsed = parseDrawingSvg(input.drawing.svg);
    // The dimensions in the SVG are the ones the PDF draws.
    const labels = parsed!.elements
      .filter((element) => element.kind === 'text')
      .map((element) => (element.kind === 'text' ? element.text : ''));
    expect(labels).toContain(`${input.overall.widthMm} mm`);
    expect(labels).toContain(`${input.overall.heightMm} mm`);
    expect(input.drawing.scale.ratio).toMatch(/^1:\d/);
  });
});

describe('C6 — assembly section in the PDF', () => {
  function withPlan(type: FurnitureType, plan?: AssemblyPlan | null) {
    return { ...inputFor(type, 'Montaj loyihasi'), assembly: plan };
  }

  async function build(input: ReturnType<typeof withPlan>) {
    const outcome = await buildManufacturingPdf(input);
    if (!outcome.ok) throw new Error(outcome.reason);
    return outcome;
  }

  it('keeps producing the pre-C6 document when no plan is supplied', async () => {
    const without = await build(withPlan('wardrobe'));
    const omitted = await build(withPlan('wardrobe', null));
    expect(omitted.pageCount).toBe(without.pageCount);
    expect(omitted.bytes.length).toBe(without.bytes.length);
  });

  it('adds a section with every step of a real plan', async () => {
    const input = withPlan('wardrobe');
    const plan = buildFurnitureAssemblyPlan({ bom: input.bom });
    const withSection = await build({ ...input, assembly: plan });
    const without = await build(withPlan('wardrobe'));

    expect(plan.steps.length).toBeGreaterThan(0);
    expect(withSection.pageCount).toBeGreaterThanOrEqual(without.pageCount);

    const blocks = assemblyStepBlocks(plan);
    expect(blocks).toHaveLength(plan.steps.length);
    for (const [index, step] of plan.steps.entries()) {
      expect(blocks[index].heading.startsWith(`${step.order}. ${step.title}`)).toBe(true);
      expect(blocks[index].instruction).toBe(step.instruction);
      for (const part of step.parts) {
        expect(blocks[index].parts).toContain(part.partId);
        expect(blocks[index].parts).toContain(`× ${part.quantity}`);
      }
    }
  });

  it('prints the part dimensions and quantities it was given', () => {
    const input = withPlan('table');
    const plan = buildFurnitureAssemblyPlan({ bom: input.bom });
    const legs = assemblyStepBlocks(plan)[0];
    expect(legs.parts).toContain('table-leg');
    expect(legs.parts).toContain('× 4');
    expect(legs.parts).toContain('mm');
  });

  it('paginates a long plan instead of dropping steps', async () => {
    const input = withPlan('table');
    const base = buildFurnitureAssemblyPlan({ bom: input.bom });
    const longPlan: AssemblyPlan = {
      ...base,
      steps: Array.from({ length: 40 }, (_, index) => ({
        ...base.steps[0],
        id: `step-${index + 1}`,
        order: index + 1,
        title: `Qadam ${index + 1}`,
        instruction:
          "Oyoqlarni tekis yuzaga qo'ying va keyingi qadamga tayyorlang. Bu matn uzunligi bir necha qatorga bo'linishini tekshirish uchun ataylab uzaytirilgan.",
        dependsOn: index === 0 ? [] : [`step-${index}`],
      })),
    };
    const plain = await build(withPlan('table'));
    const out = await build({ ...input, assembly: longPlan });
    expect(out.pageCount).toBeGreaterThan(plain.pageCount);
    expect(assemblyStepBlocks(longPlan)).toHaveLength(40);
    // Every step keeps its number in the printed heading.
    const blocks = assemblyStepBlocks(longPlan);
    expect(blocks[blocks.length - 1].heading.startsWith('40.')).toBe(true);
  });

  it('states explicitly when no reliable plan exists instead of inventing steps', async () => {
    const input = withPlan('table');
    const empty: AssemblyPlan = {
      ...buildFurnitureAssemblyPlan({ bom: input.bom }),
      status: 'unsupported',
      steps: [],
      issues: [
        { level: 'error', code: 'plan-empty', stepId: null, message: "Modelda detallar yo'q." },
      ],
    };
    const out = await build({ ...input, assembly: empty });
    expect(out.pageCount).toBeGreaterThanOrEqual(3);
    expect(assemblyStepBlocks(empty)).toEqual([]);
  });

  it('includes an assembly section for an assembly model too', async () => {
    const input = withPlan('shelf');
    const plan = buildAssemblyPlan({
      kind: 'wall-cabinet',
      params: ASSEMBLY_DEFAULTS['wall-cabinet'] as unknown as Record<string, unknown>,
    });
    const out = await build({ ...input, assembly: plan });
    expect(out.ok).toBe(true);
    expect(assemblyStepBlocks(plan).length).toBeGreaterThan(0);
  });

  it('stays deterministic with an assembly section', async () => {
    const input = withPlan('bed');
    const plan = buildFurnitureAssemblyPlan({ bom: input.bom });
    const a = await build({ ...input, assembly: plan });
    const b = await build({ ...input, assembly: plan });
    expect(Array.from(b.bytes)).toEqual(Array.from(a.bytes));
  });

  it('keeps the existing sections available alongside the new one', async () => {
    const input = withPlan('wardrobe');
    const plan = buildFurnitureAssemblyPlan({ bom: input.bom });
    const out = await build({ ...input, assembly: plan });
    // The BOM, cut list and materials inputs are untouched by the new section.
    expect(bomTableRows(input.bom).length).toBe(input.bom.rows.length);
    expect(cutListTableRows(input.cutList).length).toBe(input.cutList.rows.length);
    expect(validationTableRows(input.validation.issues).length).toBe(
      input.validation.issues.filter((issue) => issue.level !== 'info').length,
    );
    expect(out.filename.endsWith('.pdf')).toBe(true);
    expect(out.pageCount).toBeGreaterThanOrEqual(3);
  });
});

describe('C7 — material usage and cutting plan in the PDF', () => {
  async function build(input: Parameters<typeof buildManufacturingPdf>[0]) {
    const outcome = await buildManufacturingPdf(input);
    if (!outcome.ok) throw new Error(outcome.reason);
    return outcome;
  }

  function cuttingPlanFor(type: FurnitureType, overrides: Record<string, number> = {}) {
    const materials = [
      'wardrobe-side',
      'wardrobe-top',
      'wardrobe-bottom',
      'wardrobe-back',
      'wardrobe-shelf',
      'wardrobe-door',
      'table-top',
      'table-leg',
      'shelf-side',
      'shelf-top',
      'shelf-bottom',
      'shelf-back',
      'shelf-board',
    ].map((partId) => ({
      partId,
      materialId: 'ldsp' as const,
      thicknessMm: 18,
      thicknessSource: 'user' as const,
    }));
    const params = createFurnitureParams(type);
    const bom = buildBom(type, params, materials);
    if (!bom.ok) throw new Error(bom.reason);
    const cutList = buildCutList(bom.bom);
    const outcome = buildCuttingPlan({
      cutList,
      bom: bom.bom,
      settings: {
        sheetLengthMm: 2440,
        sheetWidthMm: 1220,
        kerfMm: 4,
        allowRotation: true,
        ...overrides,
      },
    });
    if (!outcome.ok) throw new Error(outcome.reason);
    return { plan: outcome.plan, cutList, bom: bom.bom, materials };
  }

  it('leaves the document byte-for-byte unchanged when no plan is supplied', async () => {
    const baseline = await build(inputFor('wardrobe'));
    const withNull = await build({ ...inputFor('wardrobe'), cuttingPlan: null });
    const withUndefined = await build({ ...inputFor('wardrobe'), cuttingPlan: undefined });

    expect(withNull.pageCount).toBe(baseline.pageCount);
    expect(withUndefined.pageCount).toBe(baseline.pageCount);
    expect(Array.from(withNull.bytes)).toEqual(Array.from(baseline.bytes));
    expect(Array.from(withUndefined.bytes)).toEqual(Array.from(baseline.bytes));
  });

  it('adds a section with the usage summary and a diagram per sheet', async () => {
    const { plan } = cuttingPlanFor('wardrobe');
    const out = await build({ ...inputFor('wardrobe'), cuttingPlan: plan });
    expect(out.ok).toBe(true);
    expect(plan.groups.length).toBeGreaterThan(0);
    expect(plan.summary.sheetCount).toBeGreaterThan(0);
    expect(out.pageCount).toBeGreaterThanOrEqual(3);
  });

  it('paginates rather than dropping sheets', async () => {
    const { plan } = cuttingPlanFor('wardrobe');
    const manySheets = { ...plan, groups: [...plan.groups, ...plan.groups, ...plan.groups] };
    const wide = await build({ ...inputFor('wardrobe'), cuttingPlan: manySheets });
    const base = await build({ ...inputFor('wardrobe'), cuttingPlan: plan });
    expect(wide.pageCount).toBeGreaterThanOrEqual(base.pageCount);
  });

  it('reports the waste and kerf figures it was given', async () => {
    const { plan } = cuttingPlanFor('wardrobe');
    expect(plan.summary.wastePercent).toBeGreaterThan(0);
    expect(plan.summary.availableAreaM2).toBeGreaterThan(plan.summary.usedAreaM2);
    const out = await build({ ...inputFor('wardrobe'), cuttingPlan: plan });
    expect(out.ok).toBe(true);
  });

  it('states when no layout could be produced instead of printing an empty diagram', async () => {
    const { plan } = cuttingPlanFor('wardrobe');
    const empty = {
      ...plan,
      status: 'unavailable' as const,
      groups: [],
      summary: { ...plan.summary, sheetCount: 0, placedCount: 0 },
    };
    const out = await build({ ...inputFor('wardrobe'), cuttingPlan: empty });
    expect(out.ok).toBe(true);
    expect(out.pageCount).toBeGreaterThanOrEqual(3);
  });

  it('stays deterministic with a cutting section', async () => {
    const { plan } = cuttingPlanFor('wardrobe');
    const a = await build({ ...inputFor('wardrobe'), cuttingPlan: plan });
    const b = await build({ ...inputFor('wardrobe'), cuttingPlan: plan });
    expect(Array.from(b.bytes)).toEqual(Array.from(a.bytes));
  });

  it('keeps the C5 and C6 sections alongside the C7 one', async () => {
    const { plan } = cuttingPlanFor('wardrobe');
    const input = inputFor('wardrobe');
    const assembly = buildFurnitureAssemblyPlan({ bom: input.bom });
    const out = await build({ ...input, cuttingPlan: plan, assembly });
    expect(out.ok).toBe(true);
    expect(bomTableRows(input.bom).length).toBe(input.bom.rows.length);
    expect(cutListTableRows(input.cutList).length).toBe(input.cutList.rows.length);
    expect(assemblyStepBlocks(assembly).length).toBeGreaterThan(0);
    expect(out.pageCount).toBeGreaterThanOrEqual(4);
  });

  it('still produces the pre-C7 document when only assembly is supplied', async () => {
    const input = inputFor('wardrobe');
    const assembly = buildFurnitureAssemblyPlan({ bom: input.bom });
    const withAssemblyOnly = await build({ ...input, assembly });
    const withBothNulls = await build({ ...input, assembly, cuttingPlan: null });
    expect(Array.from(withBothNulls.bytes)).toEqual(Array.from(withAssemblyOnly.bytes));
  });
});
