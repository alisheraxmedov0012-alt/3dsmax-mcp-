import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { summarizeGlb } from '../../export/glbSummary';
import { exportGroupToGlb } from '../../export/sceneExport';
import {
  buildPlan,
  createFurniturePlan,
  defineFurniture,
  furnitureDefinitions,
  tryCreateFurniturePlan,
  tryCreatePlanFromDefinition,
  type FurniturePlan,
} from './index';
import {
  DEFAULT_BED_STANDARD_SPEC,
  bedStandardDefinition,
  createBedStandardSpec,
} from './definitions/bedStandard';
import { DEFAULT_DESK_SPEC } from '../furniture/desk';
import { DEFAULT_GAMING_DESK_SPEC } from './definitions/deskGaming';
import { DEFAULT_DINING_TABLE_SPEC } from './definitions/tableDining';
import { DEFAULT_WRITING_DESK_SPEC } from './definitions/deskWriting';
import { DEFAULT_OFFICE_CHAIR_SPEC } from './definitions/chairOffice';
import { DEFAULT_DINING_CHAIR_SPEC } from './definitions/chairDining';
import { DEFAULT_ARMCHAIR_SPEC } from './definitions/chairArmchair';
import { DEFAULT_ERGONOMIC_CHAIR_SPEC } from './definitions/chairErgonomic';
import { DEFAULT_SOFA_STANDARD_SPEC } from './definitions/sofaStandard';
import { DEFAULT_CABINET_STANDARD_SPEC } from './definitions/cabinetStandard';

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
  (globalThis as unknown as { FileReader: typeof TestFileReader }).FileReader = TestFileReader;
});

afterAll(() => {
  delete (globalThis as unknown as { FileReader?: typeof TestFileReader }).FileReader;
});

function slotCounts(plan: FurniturePlan): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const part of plan.parts) {
    counts[part.materialSlot] = (counts[part.materialSlot] ?? 0) + 1;
  }
  return counts;
}

describe('bed.standard definition', () => {
  it('is registered with the expected metadata', () => {
    const definition = furnitureDefinitions.require('bed.standard');
    expect(definition.family).toBe('bed');
    expect(definition.label).toBe('Standart ikki kishilik karavot');
    expect(new Set(definition.fields.map((field) => field.key))).toEqual(
      new Set(Object.keys(DEFAULT_BED_STANDARD_SPEC)),
    );
  });

  it('parses the default spec', () => {
    const plan = createFurniturePlan('bed.standard', DEFAULT_BED_STANDARD_SPEC);
    expect(plan.parts).toHaveLength(35);
    expect(plan.connections).toHaveLength(49);
    expect(slotCounts(plan)).toEqual({
      structure: 26,
      mattress: 1,
      upholstery: 1,
      hardware: 7,
    });
  });

  it('rejects invalid dimensions, counts and heights', () => {
    const invalidSpecs = [
      { width: 0 },
      { legCount: 3 },
      { slatCount: 13 },
      { totalHeight: 109 },
      { headboardWidth: 170 },
      { mattressInset: 40 },
      { slatWidth: 13 },
      { headboardThickness: 200 },
      { footboardEnabled: true, footboardHeight: 81 },
      { frameThickness: 60 },
      { legHeight: 30 },
      { centerSupportEnabled: 'yes' },
    ];
    for (const overrides of invalidSpecs) {
      const result = tryCreateFurniturePlan('bed.standard', {
        ...DEFAULT_BED_STANDARD_SPEC,
        ...overrides,
      });
      expect(result.ok).toBe(false);
    }
  });

  it('rejects unknown channels', () => {
    const result = tryCreateFurniturePlan('bed.standard', {
      ...DEFAULT_BED_STANDARD_SPEC,
      storageEnabled: true,
    });
    expect(result.ok).toBe(false);
  });

  it('places the four frame rails inside the envelope', () => {
    const plan = createFurniturePlan('bed.standard', DEFAULT_BED_STANDARD_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));
    expect(byId.get('bed-side-rail-left')?.geometry).toEqual({
      kind: 'box',
      width: 5,
      height: 10,
      depth: 190,
    });
    expect(byId.get('bed-side-rail-left')?.position).toEqual([-77.5, 25, 0]);
    expect(byId.get('bed-side-rail-right')?.position).toEqual([77.5, 25, 0]);
    expect(byId.get('bed-head-rail')?.geometry).toEqual({
      kind: 'box',
      width: 150,
      height: 10,
      depth: 5,
    });
    expect(byId.get('bed-head-rail')?.position).toEqual([0, 25, -97.5]);
    expect(byId.get('bed-foot-rail')?.position).toEqual([0, 25, 97.5]);

    const built = buildPlan(plan);
    try {
      built.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(built.group);
      expect(box.max.x - box.min.x).toBeCloseTo(160, 6);
      expect(box.max.z - box.min.z).toBeCloseTo(200, 6);
      expect(box.max.y - box.min.y).toBeCloseTo(110, 6);
      expect(box.min.y).toBeCloseTo(0, 6);
    } finally {
      built.dispose();
    }
  });

  it('computes the inner frame, mattress and slat dimensions', () => {
    const plan = createFurniturePlan('bed.standard', DEFAULT_BED_STANDARD_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));
    expect(byId.get('bed-mattress')?.dimensions).toEqual({
      width: 150,
      height: 20,
      depth: 184,
    });
    expect(byId.get('bed-mattress')?.position).toEqual([0, 38, -2]);
    expect(byId.get('bed-slat-1')?.dimensions).toEqual({
      width: 150,
      height: 2,
      depth: 8,
    });
  });

  it('creates 14 evenly spaced slats without overlap', () => {
    const plan = createFurniturePlan('bed.standard', DEFAULT_BED_STANDARD_SPEC);
    const slats = plan.parts.filter((part) => part.id.startsWith('bed-slat-'));
    expect(slats).toHaveLength(14);
    const positions = slats.map((slat) => slat.position[2]);
    const gaps = positions.slice(1).map((value, index) => value - positions[index]);
    for (const gap of gaps) {
      expect(gap).toBeCloseTo(gaps[0], 6);
      expect(gap).toBeGreaterThan(8);
    }
  });

  it('attaches every slat to both side rails', () => {
    const plan = createFurniturePlan('bed.standard', DEFAULT_BED_STANDARD_SPEC);
    for (let index = 1; index <= 14; index += 1) {
      expect(
        plan.connections.some((connection) => connection.id === `bed-slat-${index}-left`),
      ).toBe(true);
      expect(
        plan.connections.some((connection) => connection.id === `bed-slat-${index}-right`),
      ).toBe(true);
    }
  });

  it('places the mattress above the slats', () => {
    const plan = createFurniturePlan('bed.standard', DEFAULT_BED_STANDARD_SPEC);
    const slat = plan.parts.find((part) => part.id === 'bed-slat-1');
    const mattress = plan.parts.find((part) => part.id === 'bed-mattress');
    expect(slat!.position[1] + slat!.dimensions.height / 2).toBeCloseTo(28, 6);
    expect(mattress!.position[1] - mattress!.dimensions.height / 2).toBeCloseTo(28, 6);
  });

  it('places the headboard on the frame and connects it', () => {
    const plan = createFurniturePlan('bed.standard', DEFAULT_BED_STANDARD_SPEC);
    const headboard = plan.parts.find((part) => part.id === 'bed-headboard');
    expect(headboard?.geometry).toEqual({ kind: 'box', width: 160, height: 80, depth: 6 });
    expect(headboard?.position).toEqual([0, 70, -97]);
    expect(
      plan.connections.some((connection) => connection.id === 'bed-headboard-head-rail'),
    ).toBe(true);
  });

  it('supports headboard padding ON/OFF', () => {
    const on = createFurniturePlan('bed.standard', DEFAULT_BED_STANDARD_SPEC);
    const padding = on.parts.find((part) => part.id === 'bed-headboard-padding');
    expect(padding?.geometry).toEqual({
      kind: 'roundedBox',
      width: 144,
      height: 50,
      depth: 4,
      radius: 1.5,
      segments: 4,
    });
    expect(padding?.position).toEqual([0, 75, -92]);
    expect(
      on.connections.some((connection) => connection.id.includes('headboard-padding')),
    ).toBe(true);

    const off = createFurniturePlan(
      'bed.standard',
      createBedStandardSpec({ headboardPaddingEnabled: false }),
    );
    expect(off.parts).toHaveLength(34);
    expect(off.connections).toHaveLength(48);
    expect(off.parts.some((part) => part.id.includes('padding'))).toBe(false);
    expect(off.connections.some((connection) => connection.id.includes('padding'))).toBe(false);
  });

  it('supports footboard ON/OFF', () => {
    const off = createFurniturePlan('bed.standard', DEFAULT_BED_STANDARD_SPEC);
    expect(off.parts.some((part) => part.id === 'bed-footboard')).toBe(false);

    const on = createFurniturePlan(
      'bed.standard',
      createBedStandardSpec({ footboardEnabled: true }),
    );
    expect(on.parts).toHaveLength(36);
    expect(on.connections).toHaveLength(51);
    const footboard = on.parts.find((part) => part.id === 'bed-footboard');
    expect(footboard?.dimensions).toEqual({ width: 160, height: 35, depth: 5 });
    expect(footboard?.position).toEqual([0, 47.5, 97.5]);
    expect(on.connections.some((connection) => connection.id === 'bed-footboard-left')).toBe(
      true,
    );
    expect(on.connections.some((connection) => connection.id === 'bed-footboard-right')).toBe(
      true,
    );
  });

  it('supports centre support ON/OFF with its extra legs', () => {
    const on = createFurniturePlan('bed.standard', DEFAULT_BED_STANDARD_SPEC);
    expect(on.parts.find((part) => part.id === 'bed-center-support')?.position).toEqual([
      0, 23, 0,
    ]);
    expect(on.parts.find((part) => part.id === 'bed-center-leg-1')?.position).toEqual([
      0, 10, 47.5,
    ]);
    expect(on.parts.find((part) => part.id === 'bed-center-leg-2')?.position).toEqual([
      0, 10, -47.5,
    ]);

    const off = createFurniturePlan(
      'bed.standard',
      createBedStandardSpec({ centerSupportEnabled: false }),
    );
    expect(off.parts).toHaveLength(31);
    expect(off.connections).toHaveLength(45);
    expect(off.parts.some((part) => part.id.includes('center'))).toBe(false);
    expect(off.connections.some((connection) => connection.id.includes('center'))).toBe(false);
  });

  it('places four legs symmetrically and on the floor', () => {
    const plan = createFurniturePlan('bed.standard', DEFAULT_BED_STANDARD_SPEC);
    const legs = plan.parts.filter(
      (part) => part.id.startsWith('bed-leg-') && !part.id.includes('screw'),
    );
    expect(legs).toHaveLength(4);
    for (const leg of legs) {
      expect(leg.dimensions).toEqual({ width: 8, height: 20, depth: 8 });
      expect(leg.position[1]).toBe(10);
      expect(Math.abs(leg.position[0])).toBeCloseTo(71, 6);
      expect(Math.abs(leg.position[2])).toBeCloseTo(91, 6);
    }
  });

  it('keeps ids unique and references valid in every toggle state', () => {
    const combinations = [
      {},
      { headboardPaddingEnabled: false },
      { footboardEnabled: true },
      { centerSupportEnabled: false },
      {
        headboardPaddingEnabled: false,
        footboardEnabled: true,
        centerSupportEnabled: false,
      },
    ];
    for (const overrides of combinations) {
      const plan = createFurniturePlan('bed.standard', createBedStandardSpec(overrides));
      const ids = new Set(plan.parts.map((part) => part.id));
      expect(ids.size).toBe(plan.parts.length);
      for (const connection of plan.connections) {
        expect(ids.has(connection.componentIds[0])).toBe(true);
        expect(ids.has(connection.componentIds[1])).toBe(true);
        if (connection.hardwareId !== undefined) {
          expect(ids.has(connection.hardwareId)).toBe(true);
        }
      }
    }
  });

  it('enforces the geometry budget', () => {
    const strict = defineFurniture({
      ...bedStandardDefinition,
      limits: {
        ...bedStandardDefinition.limits,
        maxPartVertices: 1,
        maxTotalVertices: 1,
      },
    });
    const result = tryCreatePlanFromDefinition(strict, DEFAULT_BED_STANDARD_SPEC);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain('geometry_budget_exceeded');
    }
  });

  it('is deterministic', () => {
    const first = createFurniturePlan('bed.standard', DEFAULT_BED_STANDARD_SPEC);
    const second = createFurniturePlan('bed.standard', { ...DEFAULT_BED_STANDARD_SPEC });
    expect(second.parts).toEqual(first.parts);
    expect(second.connections).toEqual(first.connections);
  });

  it('builds mesh groups and material slots', () => {
    const plan = createFurniturePlan('bed.standard', DEFAULT_BED_STANDARD_SPEC);
    const built = buildPlan(plan);
    try {
      expect(built.group.name).toBe('bed-standard-assembly');
      expect(built.materialSlots).toEqual([
        'structure',
        'mattress',
        'upholstery',
        'hardware',
      ]);
      expect(built.materialNames).toEqual([
        'bed-structure-group-material',
        'bed-mattress-group-material',
        'bed-upholstery-group-material',
        'bed-hardware-group-material',
      ]);
      const expected = slotCounts(plan);
      const actual = Object.fromEntries(
        built.group.children.map((child) => [child.name, child.children.length]),
      );
      expect(actual).toEqual({
        'bed-structure-group': expected.structure,
        'bed-mattress-group': expected.mattress,
        'bed-upholstery-group': expected.upholstery,
        'bed-hardware-group': expected.hardware,
      });
    } finally {
      built.dispose();
    }
    expect(built.group.children).toHaveLength(0);
  });

  it('publishes manufacturing metadata only for box parts', () => {
    const plan = createFurniturePlan('bed.standard', DEFAULT_BED_STANDARD_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));
    expect(byId.get('bed-side-rail-left')?.manufacturing).toEqual({
      boxCm: [5, 10, 190],
      cutFromSheet: true,
    });
    expect(byId.get('bed-slat-1')?.manufacturing).toEqual({
      boxCm: [150, 2, 8],
      cutFromSheet: true,
    });
    expect(byId.get('bed-headboard')?.manufacturing).toEqual({
      boxCm: [160, 80, 6],
      cutFromSheet: true,
    });
    expect(byId.get('bed-leg-head-left')?.manufacturing).toEqual({
      boxCm: [8, 20, 8],
      cutFromSheet: false,
    });
    expect(byId.get('bed-mattress')?.manufacturing).toBeUndefined();
    expect(byId.get('bed-headboard-padding')?.manufacturing).toBeUndefined();
    expect(byId.get('bed-center-support')?.manufacturing).toEqual({
      boxCm: [8, 6, 190],
      cutFromSheet: false,
    });
    expect(
      plan.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(26);

    const withFootboard = createFurniturePlan(
      'bed.standard',
      createBedStandardSpec({ footboardEnabled: true }),
    );
    expect(
      withFootboard.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(27);
    const noCenter = createFurniturePlan(
      'bed.standard',
      createBedStandardSpec({ centerSupportEnabled: false }),
    );
    expect(
      noCenter.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(23);
  });

  it('exports readable GLB bytes', async () => {
    const plan = createFurniturePlan('bed.standard', DEFAULT_BED_STANDARD_SPEC);
    const built = buildPlan(plan);
    try {
      const glb = await exportGroupToGlb(built.group);
      expect(glb.byteLength).toBeGreaterThan(0);
      const summary = summarizeGlb(glb);
      expect(summary.ok).toBe(true);
      if (summary.ok) {
        expect(summary.summary.meshes).toBeGreaterThanOrEqual(35);
        expect(summary.summary.materials).toHaveLength(4);
      }
    } finally {
      built.dispose();
    }
  });

  it('keeps the previous definitions intact', () => {
    expect(createFurniturePlan('desk.computer', DEFAULT_DESK_SPEC).parts).toHaveLength(24);
    expect(createFurniturePlan('desk.gaming', DEFAULT_GAMING_DESK_SPEC).parts).toHaveLength(21);
    expect(createFurniturePlan('table.dining', DEFAULT_DINING_TABLE_SPEC).parts).toHaveLength(14);
    expect(createFurniturePlan('desk.writing', DEFAULT_WRITING_DESK_SPEC).parts).toHaveLength(17);
    expect(createFurniturePlan('chair.office', DEFAULT_OFFICE_CHAIR_SPEC).parts).toHaveLength(27);
    expect(createFurniturePlan('chair.dining', DEFAULT_DINING_CHAIR_SPEC).parts).toHaveLength(12);
    expect(createFurniturePlan('chair.armchair', DEFAULT_ARMCHAIR_SPEC).parts).toHaveLength(16);
    expect(createFurniturePlan('chair.ergonomic', DEFAULT_ERGONOMIC_CHAIR_SPEC).parts).toHaveLength(32);
    expect(createFurniturePlan('sofa.standard', DEFAULT_SOFA_STANDARD_SPEC).parts).toHaveLength(29);
    expect(createFurniturePlan('cabinet.standard', DEFAULT_CABINET_STANDARD_SPEC).parts).toHaveLength(28);
  });
});
