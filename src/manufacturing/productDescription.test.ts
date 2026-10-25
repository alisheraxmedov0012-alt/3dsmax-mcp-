import { describe, expect, it } from 'vitest';
import {
  PRODUCT_ENGLISH_NAMES,
  buildProductDescription,
  isProductDescriptionStale,
  productDescriptionFingerprint,
  productDescriptionMarkdown,
  type ProductDescriptionInput,
} from './productDescription';
import { buildBom } from './bom';
import { buildCutList } from './cutList';
import { buildCuttingPlan } from './cuttingPlan';
import { buildFurnitureAssemblyPlan } from './assemblyInstructions';
import { validateManufacturing } from './validation';
import { createTechnicalDrawingSvg } from './technicalDrawing';
import { createFurnitureParams, FURNITURE_TYPES, type FurnitureParams } from '../geometry/furniture/types';
import type { SheetMaterialEntry } from './sheetMaterial';

const SETTINGS = {
  sheetLengthMm: 2440,
  sheetWidthMm: 1220,
  kerfMm: 4,
  allowRotation: true,
} as const;

const DOCUMENTS = ['document.pdf', 'BOM.csv', 'product-description.md'];

function materialsFor(type: 'table' | 'chair' | 'wardrobe' = 'table'): SheetMaterialEntry[] {
  const bom = buildBom(type, createFurnitureParams(type));
  if (!bom.ok) throw new Error(bom.reason);
  return bom.bom.rows.map((row) => ({
    partId: row.partId,
    materialId: 'ldsp',
    thicknessMm: 18,
    thicknessSource: 'user',
  }));
}

function descriptionInput(
  overrides: Partial<ProductDescriptionInput> = {},
  paramsOverride?: FurnitureParams,
): ProductDescriptionInput {
  const type = overrides.type ?? 'table';
  const params = paramsOverride ?? createFurnitureParams(type);
  const materials = materialsFor(type === 'wardrobe' ? 'wardrobe' : 'table');
  const bom = buildBom(type, params, materials);
  if (!bom.ok) throw new Error(bom.reason);
  const cutList = buildCutList(bom.bom);
  const validation = validateManufacturing(type, params, materials);
  const drawing = createTechnicalDrawingSvg(type, params, { title: 'T', date: '2026-01-01' });
  if (!drawing.ok) throw new Error(drawing.reason);
  const assembly = buildFurnitureAssemblyPlan({ bom: bom.bom, validation });
  const cutting = buildCuttingPlan({ cutList, bom: bom.bom, settings: SETTINGS });
  return {
    type,
    overallMm: drawing.overall,
    bom: bom.bom,
    cutList,
    validation,
    assembly,
    cuttingPlan: cutting.ok ? cutting.plan : null,
    ...overrides,
  };
}

describe('C8 description — content comes from the model', () => {
  it('names the product in English and keeps the local name for reference', () => {
    const description = buildProductDescription(descriptionInput(), DOCUMENTS);
    expect(description.name).toBe('Dining Table');
    expect(description.localName).toBe('Stol');
    expect(PRODUCT_ENGLISH_NAMES.table).toBe('Dining Table');
  });

  it('quotes the measured overall dimensions', () => {
    const input = descriptionInput();
    const description = buildProductDescription(input, DOCUMENTS);
    const overall = description.dimensions[0];
    expect(overall).toContain('1200 mm W');
    expect(overall).toContain('750 mm H');
    expect(overall).toContain('600 mm D');
    expect(overall).toMatch(/measured from the model geometry/i);
  });

  it('lists every BOM part with its quantity and size', () => {
    const input = descriptionInput();
    const description = buildProductDescription(input, DOCUMENTS);
    for (const row of input.bom.rows) {
      const line = description.dimensions.find((entry) => entry.includes(row.partId));
      expect(line).toBeDefined();
      expect(line).toContain(`× ${row.quantity}`);
    }
  });

  it('states the materials the user actually assigned', () => {
    const description = buildProductDescription(descriptionInput(), DOCUMENTS);
    const text = description.materials.join(' ');
    expect(text).toContain('LDSP');
    expect(text).toContain('nominal 18 mm');
    expect(text).toMatch(/assigned by the user/i);
  });

  it('says "not specified" instead of inventing a material', () => {
    const params = createFurnitureParams('table');
    const bom = buildBom('table', params);
    if (!bom.ok) throw new Error(bom.reason);
    const description = buildProductDescription(
      {
        type: 'table',
        overallMm: { widthMm: 1200, heightMm: 750, depthMm: 600 },
        bom: bom.bom,
        cutList: buildCutList(bom.bom),
        validation: validateManufacturing('table', params),
        assembly: buildFurnitureAssemblyPlan({ bom: bom.bom }),
        cuttingPlan: null,
      },
      DOCUMENTS,
    );
    const text = description.materials.join(' ');
    expect(text).toMatch(/not specified/i);
    expect(text).not.toMatch(/LDSP|MDF|plywood/i);
  });

  it('lists the documents it will actually ship', () => {
    const description = buildProductDescription(descriptionInput(), DOCUMENTS);
    expect(description.documents).toEqual(DOCUMENTS);
  });

  it('always carries a non-empty limitations section', () => {
    const description = buildProductDescription(descriptionInput(), DOCUMENTS);
    expect(description.limitations.length).toBeGreaterThan(3);
    const text = description.limitations.join(' ');
    expect(text).toMatch(/not modelled|not analysed|not verified/i);
  });

  it('surfaces C4 errors as a limitation rather than hiding them', () => {
    const params = { ...createFurnitureParams('table'), topThicknessCm: 60 } as FurnitureParams;
    const bom = buildBom('table', params, materialsFor('table'));
    if (!bom.ok) throw new Error(bom.reason);
    const validation = validateManufacturing('table', params, materialsFor('table'));
    expect(validation.counts.error).toBeGreaterThan(0);

    const description = buildProductDescription(
      {
        type: 'table',
        overallMm: { widthMm: 1200, heightMm: 750, depthMm: 600 },
        bom: bom.bom,
        cutList: buildCutList(bom.bom),
        validation,
      },
      DOCUMENTS,
    );
    expect(description.limitations[0]).toMatch(/error\(s\)/);
  });
});

describe('C8 description — no unsupported claims', () => {
  const FORBIDDEN = [
    /certified/i,
    /load[- ]?rating/i,
    /load[- ]?bearing capacity (?:is )?verified/i,
    /structurally safe/i,
    /fully compliant/i,
    /ready for production/i,
    /guaranteed/i,
    /weather[- ]?proof/i,
    /fire[- ]?resistant/i,
  ];

  it.each(FURNITURE_TYPES)('makes no certification claim for a %s', (type) => {
    const bom = buildBom(type, createFurnitureParams(type));
    if (!bom.ok) throw new Error(bom.reason);
    const description = buildProductDescription(
      {
        type,
        overallMm: { widthMm: 1000, heightMm: 800, depthMm: 500 },
        bom: bom.bom,
        cutList: buildCutList(bom.bom),
        validation: validateManufacturing(type, createFurnitureParams(type)),
      },
      DOCUMENTS,
    );
    const body = [
      description.purpose,
      ...description.features,
      ...description.dimensions,
      ...description.materials,
      ...description.documents,
    ].join(' ');
    for (const pattern of FORBIDDEN) {
      expect(body).not.toMatch(pattern);
    }
    // The limitations may *deny* such claims, but must never assert them.
    expect(description.limitations.join(' ')).toMatch(/not |never/i);
  });

  it('says in the Markdown that it is not a certificate', () => {
    const markdown = productDescriptionMarkdown(
      buildProductDescription(descriptionInput(), DOCUMENTS),
    );
    expect(markdown).toMatch(/not a certificate/i);
    expect(markdown).toContain('# Dining Table');
    expect(markdown).toContain('## Limitations and what was not verified');
  });
});

describe('C8 description — follows the model', () => {
  it('changes when a dimension changes', () => {
    const before = buildProductDescription(descriptionInput(), DOCUMENTS);
    const wider = { ...createFurnitureParams('table'), widthCm: 180 } as FurnitureParams;
    const after = buildProductDescription(descriptionInput({}, wider), DOCUMENTS);

    expect(after.dimensions).not.toEqual(before.dimensions);
    expect(after.dimensions.join(' ')).toContain('1800 mm W');
    expect(
      isProductDescriptionStale(before, productDescriptionFingerprint(descriptionInput({}, wider))),
    ).toBe(true);
  });

  it('is stable for identical input', () => {
    const a = buildProductDescription(descriptionInput(), DOCUMENTS);
    const b = buildProductDescription(descriptionInput(), DOCUMENTS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(isProductDescriptionStale(a, b.fingerprint)).toBe(false);
  });

  it('drops the sheet-layout feature when no cutting plan exists', () => {
    const withPlan = buildProductDescription(descriptionInput(), DOCUMENTS);
    const without = buildProductDescription(
      descriptionInput({ cuttingPlan: null }),
      DOCUMENTS,
    );
    expect(withPlan.features.join(' ')).toMatch(/Sheet layout/);
    expect(without.features.join(' ')).not.toMatch(/Sheet layout/);
  });
});
