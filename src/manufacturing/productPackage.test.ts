/**
 * C8 product package: the bundle must be complete, intact, deterministic, and
 * must not disturb the frozen C1 archive contract.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
  PRODUCT_PACKAGE_ENTRIES,
  assemblyText,
  buildProductPackage,
  cuttingPlanCsv,
  materialsCsv,
  productPackageFilename,
  validationReportText,
  verifyProductExports,
} from './productPackage';
import { buildManufacturingPackage, PACKAGE_ENTRIES } from './manufacturingPackage';
import { createCuttingPlanSvg } from './cuttingPlanSvg';
import { buildBom } from './bom';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  type SceneData,
  type SceneObject,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { createFurnitureParams, type FurnitureType } from '../geometry/furniture/types';
import type { SheetMaterialEntry } from './sheetMaterial';

/** Node has no FileReader, which GLTFExporter uses for the .glb payload. */
class TestFileReader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    blob
      .arrayBuffer()
      .then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      })
      .catch((error) => this.onerror?.(error));
  }
}

beforeAll(() => {
  vi.stubGlobal('FileReader', TestFileReader);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const FIXED = new Date('2026-05-06T07:08:09.000Z');
const SETTINGS = {
  sheetLengthMm: 2440,
  sheetWidthMm: 1220,
  kerfMm: 4,
  allowRotation: true,
} as const;

function materialsFor(type: FurnitureType = 'table'): SheetMaterialEntry[] {
  const bom = buildBom(type, createFurnitureParams(type));
  if (!bom.ok) throw new Error(bom.reason);
  return bom.bom.rows.map((row) => ({
    partId: row.partId,
    materialId: 'ldsp',
    thicknessMm: 18,
    thicknessSource: 'user',
  }));
}

function objectFor(type: FurnitureType = 'table', withMaterials = true): SceneObject {
  return createFurnitureSceneObject(type, `${type}-1`, {
    sheetMaterials: withMaterials ? materialsFor(type) : [],
  });
}

function sceneWith(object: SceneObject): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects: [object],
    settings: createDefaultSettings(),
  };
}

function packageInput(object: SceneObject = objectFor()) {
  return {
    scene: sceneWith(object),
    object,
    projectName: 'Stol loyihasi',
    cuttingSettings: SETTINGS,
    generatedAt: FIXED,
  };
}

describe('C8 package — contents', () => {
  it('contains exactly the declared entries', async () => {
    const outcome = await buildProductPackage(packageInput());
    expect(outcome.ok, outcome.ok ? '' : outcome.reason).toBe(true);
    if (!outcome.ok) return;

    const names = Object.keys(unzipSync(outcome.product.bytes)).sort();
    expect(names).toEqual([...PRODUCT_PACKAGE_ENTRIES].sort());
    expect(outcome.product.entries.map((entry) => entry.name).sort()).toEqual(
      [...PRODUCT_PACKAGE_ENTRIES].sort(),
    );
  });

  it('writes a non-empty, readable file for every entry', async () => {
    const outcome = await buildProductPackage(packageInput());
    if (!outcome.ok) throw new Error(outcome.reason);
    const files = unzipSync(outcome.product.bytes);
    for (const name of PRODUCT_PACKAGE_ENTRIES) {
      expect(files[name], name).toBeDefined();
      expect(files[name].length, name).toBeGreaterThan(0);
    }
  });

  it('carries the ten deliverables a buyer is promised', async () => {
    const outcome = await buildProductPackage(packageInput());
    if (!outcome.ok) throw new Error(outcome.reason);
    const files = unzipSync(outcome.product.bytes);

    // 1. 3D model
    expect(files['model.glb'].length).toBeGreaterThan(0);
    // 2. BOM
    expect(strFromU8(files['BOM.csv'])).toContain('partId');
    expect(strFromU8(files['BOM.csv'])).toContain('table-top');
    // 3. Cut list
    expect(strFromU8(files['cutlist.csv'])).toContain('Uzunlik_mm');
    // 4. Dimensioned drawing
    expect(strFromU8(files['drawing.svg'])).toContain('<svg');
    // 5. Material information
    expect(strFromU8(files['materials.csv'])).toContain('LDSP');
    // 6. Validation and its limitations
    expect(strFromU8(files['validation.txt'])).toMatch(/Cheklovlar/);
    // 7. Assembly instructions
    expect(strFromU8(files['assembly.txt'])).toMatch(/Montaj/);
    // 8. Material usage and cutting plan
    expect(strFromU8(files['cutting-plan.csv'])).toContain('joylashtirilgan');
    const cuttingSvg = strFromU8(files['cutting-plan.svg']);
    expect(cuttingSvg).toContain('<svg');
    expect(cuttingSvg).toContain('table-top #1');
    expect(cuttingSvg).toContain('Masshtab: 1:');
    // 9. PDF
    const pdf = files['document.pdf'];
    expect(String.fromCharCode(...pdf.slice(0, 4))).toBe('%PDF');
    // 10. English description
    const description = strFromU8(files['product-description.md']);
    expect(description).toContain('Dining Table');
    expect(description).toMatch(/not a certificate/i);
  });

  it('writes a meta.json that agrees with the documents', async () => {
    const outcome = await buildProductPackage(packageInput());
    if (!outcome.ok) throw new Error(outcome.reason);
    const files = unzipSync(outcome.product.bytes);
    const meta = JSON.parse(strFromU8(files['meta.json']));

    expect(meta.format).toBe('3d-studio-ai-product-package');
    expect(meta.version).toBe(3);
    expect(meta.entries).toEqual([...PRODUCT_PACKAGE_ENTRIES]);
    expect(meta.entries).toEqual(Object.keys(unzipSync(outcome.product.bytes)));
    expect(meta.bom.totalParts).toBe(outcome.product.totalParts);
    expect(meta.cutList.pieces).toBe(outcome.product.cutPieces);
    expect(meta.cutting.sheets).toBe(outcome.product.sheetCount);
    expect(meta.skipped).toEqual([]);
  });

  it('writes general listing metadata without inventing seller fields', async () => {
    const outcome = await buildProductPackage({
      ...packageInput(),
      listing: {
        title: '  Dining Table  ',
        sku: 'TABLE-1',
        tags: [' oak ', 'table', 'oak'],
      },
    });
    if (!outcome.ok) throw new Error(outcome.reason);
    const files = unzipSync(outcome.product.bytes);
    const meta = JSON.parse(strFromU8(files['meta.json']));

    expect(meta.listing.title).toBe('Dining Table');
    expect(meta.listing.sku).toBe('TABLE-1');
    expect(meta.listing.tags).toEqual(['oak', 'table']);
    expect(meta.listing.formats).toEqual(expect.arrayContaining(['glb', 'pdf', 'svg']));
    expect(meta.listing.dimensionsMm).toEqual({
      widthMm: 1200,
      heightMm: 750,
      depthMm: 600,
    });
    expect(meta.listing.unit).toBe('mm');
    // Not supplied, so not invented.
    for (const key of ['version', 'category', 'author', 'license', 'textureResolutionPx']) {
      expect(meta.listing).not.toHaveProperty(key);
    }
  });

  it('agrees with the BOM it was built from', async () => {
    const object = objectFor();
    const outcome = await buildProductPackage(packageInput(object));
    if (!outcome.ok) throw new Error(outcome.reason);
    const files = unzipSync(outcome.product.bytes);
    const csv = strFromU8(files['BOM.csv']);

    const bom = buildBom(object.type, object.params, object.sheetMaterials);
    if (!bom.ok) throw new Error(bom.reason);
    for (const row of bom.bom.rows) {
      expect(csv).toContain(row.partId);
    }
  });
});

describe('C6 hardware in the product package', () => {
  it('ships supplied hardware in its own CSV and metadata row', async () => {
    const outcome = await buildProductPackage({
      ...packageInput(),
      hardware: [
        {
          kind: 'screw',
          name: 'Konfirmat',
          quantity: 12,
          unit: 'pcs',
          size: '4×40 mm',
          stepIds: ['step-leg'],
        },
      ],
    });
    if (!outcome.ok) throw new Error(outcome.reason);
    const files = unzipSync(outcome.product.bytes);
    expect(strFromU8(files['hardware.csv'])).toContain('Konfirmat');
    expect(strFromU8(files['hardware.csv'])).toContain('specified');
    const meta = JSON.parse(strFromU8(files['meta.json']));
    expect(meta.hardware.specified).toBe(true);
    expect(meta.hardware.totalPieces).toBe(12);
    expect(meta.hardware.list[0].stepIds).toEqual(['step-leg']);
    expect(meta.hardware.list[0].stepLabels).toEqual(['1. Oyoqlar']);
    expect(strFromU8(files['hardware.csv'])).toContain('step-leg:1. Oyoqlar');
    expect(strFromU8(files['README.txt'])).toContain('Furnitura: 1 yozuv');
  });

  it('rejects a legacy numeric link with a rebind instruction', async () => {
    const outcome = await buildProductPackage({
      ...packageInput(),
      hardware: [
        {
          kind: 'screw',
          name: 'Konfirmat',
          quantity: 4,
          unit: 'pcs',
          size: null,
          stepIds: ['step-1'],
        },
      ],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/eski formatdagi qadam/);
    expect(outcome.reason).toMatch(/qayta bog'lang/);
  });

  it('rejects a hardware row linked to a step the plan does not contain', async () => {
    const outcome = await buildProductPackage({
      ...packageInput(),
      hardware: [
        {
          kind: 'screw',
          name: 'Konfirmat',
          quantity: 4,
          unit: 'pcs',
          size: null,
          stepIds: ['step-missing'],
        },
      ],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/noma'lum montaj qadamiga/i);
  });

  it('states when hardware is not specified instead of printing an empty table', async () => {
    const outcome = await buildProductPackage(packageInput());
    if (!outcome.ok) throw new Error(outcome.reason);
    const files = unzipSync(outcome.product.bytes);
    expect(strFromU8(files['hardware.csv'])).toContain('not-specified');
    expect(strFromU8(files['README.txt'])).toContain("ko'rsatilmagan");
  });
});

describe('C8 package — integrity and determinism', () => {
  it('survives a round trip, which is what verifies the CRCs', async () => {
    const outcome = await buildProductPackage(packageInput());
    if (!outcome.ok) throw new Error(outcome.reason);
    // unzipSync inflates every entry and validates its CRC; a corrupt archive
    // throws instead of returning short data.
    const files = unzipSync(outcome.product.bytes);
    expect(Object.keys(files)).toHaveLength(PRODUCT_PACKAGE_ENTRIES.length);
  });

  it('produces byte-identical archives for identical input', async () => {
    const a = await buildProductPackage(packageInput());
    const b = await buildProductPackage(packageInput());
    if (!a.ok || !b.ok) throw new Error('package failed');
    expect(Array.from(b.product.bytes)).toEqual(Array.from(a.product.bytes));
    expect(b.product.filename).toBe(a.product.filename);
  });

  it('names the archive distinctly from the C1 package', () => {
    expect(productPackageFilename('Stol loyihasi')).toMatch(/-product\.zip$/);
    expect(productPackageFilename('Stol loyihasi')).not.toMatch(/-package\.zip$/);
  });

  it('rejects a model that is not in the scene', async () => {
    const object = objectFor();
    const outcome = await buildProductPackage({
      ...packageInput(object),
      scene: { ...sceneWith(object), objects: [] },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/topilmadi/);
  });

  it('refuses a model with no panels instead of inventing a cut list', async () => {
    const object = objectFor('sofa');
    const outcome = await buildProductPackage(packageInput(object));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/Kesish royxati bosh/);
  });
});

describe('C8 package — partial bundles are reported as partial', () => {
  it('lists every unplaced piece with its reason when no material is assigned', async () => {
    const object = objectFor('table', false); // no material assigned
    const outcome = await buildProductPackage(packageInput(object));
    expect(outcome.ok, outcome.ok ? '' : outcome.reason).toBe(true);
    if (!outcome.ok) return;

    const files = unzipSync(outcome.product.bytes);
    const csv = strFromU8(files['cutting-plan.csv']);
    // The layout could not be produced, and the file says so per piece rather
    // than handing over an empty table.
    expect(csv).toContain('joylashtirilmagan: no-material');
    expect(outcome.product.sheetCount).toBe(0);

    const meta = JSON.parse(strFromU8(files['meta.json']));
    expect(meta.cutting.status).toBe('unavailable');
    // Nothing was skipped: every declared entry was written.
    expect(outcome.product.skipped).toEqual([]);
  });

  it('records a file it could not produce, with the reason', async () => {
    // A negative kerf is rejected by the C7 settings validator, so the layout
    // cannot be computed at all — a genuine skipped entry, not a partial one.
    const outcome = await buildProductPackage({
      ...packageInput(),
      cuttingSettings: { ...SETTINGS, kerfMm: -1 },
    });
    expect(outcome.ok, outcome.ok ? '' : outcome.reason).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.product.skipped.map((entry) => entry.name)).toContain('cutting-plan.csv');
    const files = unzipSync(outcome.product.bytes);
    expect(strFromU8(files['cutting-plan.csv'])).toContain('hisoblanmagan');
    const meta = JSON.parse(strFromU8(files['meta.json']));
    expect(meta.cutting).toBeNull();
    expect(meta.skipped).toHaveLength(2);
  });
});

describe('C8 package — export verification', () => {
  it('verifies every export and passes for a complete model', async () => {
    const verification = await verifyProductExports({
      ...packageInput(),
      verifyC1Package: true,
    });
    const byId = new Map(verification.checks.map((check) => [check.id, check]));
    expect(byId.get('package')?.status).toBe('pass');
    expect(byId.get('package-integrity')?.status).toBe('pass');
    expect(byId.get('pdf')?.status).toBe('pass');
    expect(byId.get('c1-package')?.status).toBe('pass');
    expect(verification.product).not.toBeNull();
  });

  it('fails the export checks, with reasons, when the package cannot be built', async () => {
    const verification = await verifyProductExports(packageInput(objectFor('sofa')));
    expect(verification.product).toBeNull();
    const statuses = verification.checks.map((check) => `${check.id}:${check.status}`);
    expect(statuses).toContain('package:fail');
    expect(statuses).toContain('package-integrity:fail');
    expect(statuses).toContain('pdf:fail');
    for (const check of verification.checks) {
      expect(check.detail.length).toBeGreaterThan(0);
    }
  });

  it('warns instead of passing when a file was skipped', async () => {
    const verification = await verifyProductExports({
      ...packageInput(),
      cuttingSettings: { ...SETTINGS, kerfMm: -1 },
    });
    const packageCheck = verification.checks.find((check) => check.id === 'package');
    expect(packageCheck?.status).toBe('warning');
    expect(packageCheck?.detail).toMatch(/cutting-plan\.csv/);
  });

  it('proves the C1 archive still holds exactly six entries', async () => {
    const object = objectFor();
    const outcome = await buildManufacturingPackage({
      scene: sceneWith(object),
      object,
      projectName: 'Stol loyihasi',
      generatedAt: FIXED,
    });
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(Object.keys(unzipSync(outcome.package.bytes)).sort()).toEqual([...PACKAGE_ENTRIES].sort());
    expect(PACKAGE_ENTRIES).toHaveLength(6);
  });
});

describe('C8 package — document writers', () => {
  it('writes a cutting-plan CSV with one row per placed piece and per unplaced group', async () => {
    const object = objectFor('wardrobe');
    const outcome = await buildProductPackage(packageInput(object));
    if (!outcome.ok) throw new Error(outcome.reason);
    if (!outcome.artifacts.cuttingPlan) throw new Error('expected a cutting plan');

    const csv = cuttingPlanCsv(outcome.artifacts.cuttingPlan);
    const rows = csv.trim().split('\n');
    const placed = rows.filter((line) => line.startsWith('joylashtirilgan'));
    const unplaced = rows.filter((line) => line.startsWith('joylashtirilmagan'));

    expect(placed).toHaveLength(outcome.artifacts.cuttingPlan.summary.placedCount);
    expect(unplaced).toHaveLength(outcome.artifacts.cuttingPlan.unplaced.length);
  });

  it('states in the CSV and SVG that no layout was computed', () => {
    expect(cuttingPlanCsv(null)).toContain('hisoblanmagan');
    expect(createCuttingPlanSvg(null)).toContain('hisoblanmagan');
  });

  it('says a material list is empty instead of printing only a header', () => {
    const bom = buildBom('table', createFurnitureParams('table'));
    if (!bom.ok) throw new Error(bom.reason);
    expect(materialsCsv(bom.bom)).toContain('Material tayinlanmagan');
  });

  it('carries every validation limitation into the text report', () => {
    const validation = {
      ok: true,
      issues: [],
      counts: { error: 0, warning: 0, info: 0 },
      limitations: ['cheklov A', 'cheklov B'],
    };
    const text = validationReportText(validation);
    expect(text).toContain('cheklov A');
    expect(text).toContain('cheklov B');
    expect(text).toMatch(/sertifikati emas/);
  });

  it('keeps fastening gaps visible in the assembly text', async () => {
    const outcome = await buildProductPackage(packageInput());
    if (!outcome.ok) throw new Error(outcome.reason);
    const text = assemblyText(outcome.artifacts.assembly);
    expect(text).toMatch(/Mahkamlash/);
    expect(text).toMatch(/1\./);
  });
});

describe('C8 — package README, metadata and safe names', () => {
  it('writes a README that explains files, units, dimensions, material and checks', async () => {
    const outcome = await buildProductPackage(packageInput());
    if (!outcome.ok) throw new Error(outcome.reason);
    const files = unzipSync(outcome.product.bytes);
    const readme = strFromU8(files['README.txt']);
    const meta = JSON.parse(strFromU8(files['meta.json']));

    expect(readme).toContain('Paket formati: 3d-studio-ai-product-package v3');
    expect(readme).toContain('Umumiy o\'lcham: W 1200 x H 750 x D 600 mm');
    expect(readme).toContain("O'lchov birligi: mm");
    expect(readme).toContain('BOM.csv — detallar ro\'yxati');
    expect(readme).toContain('cutting-plan.svg — kesish joylashuvining ko\'rinishi');
    expect(readme).toContain('LDSP, nominal 18 mm');
    expect(readme).toContain('Ishlab chiqarishdan oldin tekshiring:');
    for (const entry of meta.entries) {
      expect(readme, entry).toContain(entry);
    }
    expect(meta.materials[0]).toMatchObject({ name: 'LDSP', thicknessMm: 18, unit: 'mm' });
    expect(meta.validation.limitations.length).toBeGreaterThan(0);
    expect(meta.cutting.status).toBe('ok');
    expect(meta.cutting.kerfMm).toBe(4);
  });

  it('states a missing cutting plan explicitly in README and metadata', async () => {
    const object = objectFor('table', true);
    const outcome = await buildProductPackage({
      scene: sceneWith(object),
      object,
      projectName: 'No layout',
      generatedAt: FIXED,
    });
    if (!outcome.ok) throw new Error(outcome.reason);
    const files = unzipSync(outcome.product.bytes);
    const readme = strFromU8(files['README.txt']);
    const meta = JSON.parse(strFromU8(files['meta.json']));
    expect(readme).toContain('Kesish rejasi: hisoblanmagan');
    expect(meta.cutting).toBeNull();
    expect(strFromU8(files['cutting-plan.svg'])).toContain('hisoblanmagan');
  });

  it('keeps archive names safe and collision-resistant', () => {
    const names = [
      '',
      'Stol loyihasi',
      '../../etc/passwd',
      'Ошхона шкаф',
      'a'.repeat(200),
      'Kitchen Table',
      'Kitchen-Table',
    ].map((name) => productPackageFilename(name));
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9.-]+\.zip$/);
      expect(name).not.toContain('/');
      expect(name).not.toContain('\\');
      expect(name).not.toContain('..');
      expect(name.length).toBeLessThan(90);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it('has unique, path-safe ZIP entries', async () => {
    const outcome = await buildProductPackage(packageInput());
    if (!outcome.ok) throw new Error(outcome.reason);
    const names = Object.keys(unzipSync(outcome.product.bytes));
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).not.toContain('/');
      expect(name).not.toContain('\\');
      expect(name).not.toContain('..');
      expect(name).not.toMatch(/^[A-Za-z]:/);
    }
  });
});
