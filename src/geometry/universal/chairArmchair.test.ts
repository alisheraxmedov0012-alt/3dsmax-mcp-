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
  DEFAULT_ARMCHAIR_SPEC,
  armchairDefinition,
  createArmchairSpec,
} from './definitions/chairArmchair';
import { DEFAULT_DESK_SPEC } from '../furniture/desk';
import { DEFAULT_GAMING_DESK_SPEC } from './definitions/deskGaming';
import { DEFAULT_DINING_TABLE_SPEC } from './definitions/tableDining';
import { DEFAULT_WRITING_DESK_SPEC } from './definitions/deskWriting';
import { DEFAULT_OFFICE_CHAIR_SPEC } from './definitions/chairOffice';
import { DEFAULT_DINING_CHAIR_SPEC } from './definitions/chairDining';

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

describe('chair.armchair definition', () => {
  it('is registered with the expected metadata', () => {
    const definition = furnitureDefinitions.require('chair.armchair');
    expect(definition.family).toBe('armchair');
    expect(definition.label).toBe('Yumshoq kreslo');
    expect(new Set(definition.fields.map((field) => field.key))).toEqual(
      new Set(Object.keys(DEFAULT_ARMCHAIR_SPEC)),
    );
  });

  it('parses the default spec', () => {
    const plan = createFurniturePlan('chair.armchair', DEFAULT_ARMCHAIR_SPEC);
    expect(plan.parts).toHaveLength(16);
    expect(plan.connections).toHaveLength(15);
    expect(slotCounts(plan)).toEqual({ upholstery: 4, structure: 8, hardware: 4 });
    expect(new Set(plan.parts.map((part) => part.materialSlot))).toEqual(
      new Set(['upholstery', 'structure', 'hardware']),
    );
  });

  it('rejects invalid dimensions and inconsistencies', () => {
    const invalidSpecs = [
      { seatWidth: 0 },
      { seatHeight: 45 },
      { seatThickness: 4 },
      { seatCushionRadius: 5 },
      { backrestWidth: 53 },
      { backrestAngle: 40 },
      { armrestHeight: 9 },
      { armrestLength: 51 },
      { legInset: 25 },
      { armrestsEnabled: 'yes' },
    ];
    for (const overrides of invalidSpecs) {
      const result = tryCreateFurniturePlan('chair.armchair', {
        ...DEFAULT_ARMCHAIR_SPEC,
        ...overrides,
      });
      expect(result.ok).toBe(false);
    }
  });

  it('rejects unknown channels', () => {
    const result = tryCreateFurniturePlan('chair.armchair', {
      ...DEFAULT_ARMCHAIR_SPEC,
      reclineEnabled: true,
    });
    expect(result.ok).toBe(false);
  });

  it('builds a volumetric seat cushion over a structural base', () => {
    const plan = createFurniturePlan('chair.armchair', DEFAULT_ARMCHAIR_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));
    expect(byId.get('armchair-seat-base')?.geometry).toEqual({
      kind: 'box',
      width: 52,
      height: 4,
      depth: 50,
    });
    expect(byId.get('armchair-seat-cushion')?.geometry).toEqual({
      kind: 'roundedBox',
      width: 52,
      height: 8,
      depth: 50,
      radius: 2,
      segments: 6,
    });
    expect(byId.get('armchair-seat-cushion')?.position).toEqual([0, 40, 0]);
  });

  it('builds a cushioned backrest on a structural frame', () => {
    const plan = createFurniturePlan('chair.armchair', DEFAULT_ARMCHAIR_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));
    const cushion = byId.get('armchair-backrest-cushion');
    expect(cushion?.geometry).toEqual({
      kind: 'roundedBox',
      width: 50,
      height: 48,
      depth: 10,
      radius: 2,
      segments: 6,
    });
    expect(cushion?.rotation).toEqual([-10, 0, 0]);
    expect(cushion?.position[1]).toBeCloseTo(67.635, 3);
    expect(cushion?.position[2]).toBeCloseTo(-24.1676, 3);

    const frame = byId.get('armchair-backrest-frame');
    expect(frame?.geometry).toEqual({
      kind: 'box',
      width: 44,
      height: 42,
      depth: 4,
    });
    expect(frame?.rotation).toEqual([-10, 0, 0]);
    expect(frame?.position[2]).toBeLessThan(cushion?.position[2] ?? 0);
  });

  it('supports armrest ON/OFF symmetrically', () => {
    const off = createFurniturePlan(
      'chair.armchair',
      createArmchairSpec({ armrestsEnabled: false }),
    );
    expect(off.parts).toHaveLength(10);
    expect(off.connections).toHaveLength(9);
    expect(off.parts.some((part) => part.id.includes('armrest'))).toBe(false);
    expect(slotCounts(off)).toEqual({ upholstery: 2, structure: 6, hardware: 2 });

    const on = createFurniturePlan('chair.armchair', DEFAULT_ARMCHAIR_SPEC);
    const left = on.parts.find((part) => part.id === 'armchair-armrest-pad-left');
    const right = on.parts.find((part) => part.id === 'armchair-armrest-pad-right');
    expect(left?.position).toEqual([28, 65.5, 0]);
    expect(right?.position).toEqual([-28, 65.5, 0]);
  });

  it('places four legs on the floor under the seat base', () => {
    const plan = createFurniturePlan('chair.armchair', DEFAULT_ARMCHAIR_SPEC);
    const legs = plan.parts.filter((part) => part.id.startsWith('armchair-leg-'));
    expect(legs).toHaveLength(4);
    for (const leg of legs) {
      expect(leg.dimensions).toEqual({ width: 6, height: 32, depth: 6 });
      expect(leg.position[1]).toBe(16);
      expect(Math.abs(leg.position[0])).toBeCloseTo(18, 6);
      expect(Math.abs(leg.position[2])).toBeCloseTo(17, 6);
    }
    const built = buildPlan(plan);
    try {
      built.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(built.group);
      expect(box.min.y).toBeCloseTo(0, 6);
      expect(box.max.y).toBeGreaterThan(85);
    } finally {
      built.dispose();
    }
  });

  it('keeps part ids unique and connection references valid', () => {
    for (const overrides of [{}, { armrestsEnabled: false }]) {
      const plan = createFurniturePlan('chair.armchair', createArmchairSpec(overrides));
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
      ...armchairDefinition,
      limits: {
        ...armchairDefinition.limits,
        maxPartVertices: 1,
        maxTotalVertices: 1,
      },
    });
    const result = tryCreatePlanFromDefinition(strict, DEFAULT_ARMCHAIR_SPEC);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain('geometry_budget_exceeded');
    }
  });

  it('is deterministic', () => {
    const first = createFurniturePlan('chair.armchair', DEFAULT_ARMCHAIR_SPEC);
    const second = createFurniturePlan('chair.armchair', { ...DEFAULT_ARMCHAIR_SPEC });
    expect(second.parts).toEqual(first.parts);
    expect(second.connections).toEqual(first.connections);
  });

  it('builds mesh groups and material slots', () => {
    const plan = createFurniturePlan('chair.armchair', DEFAULT_ARMCHAIR_SPEC);
    const built = buildPlan(plan);
    try {
      expect(built.group.name).toBe('armchair-assembly');
      expect(built.materialSlots).toEqual(['upholstery', 'structure', 'hardware']);
      expect(built.materialNames).toEqual([
        'armchair-upholstery-group-material',
        'armchair-structure-group-material',
        'armchair-hardware-group-material',
      ]);
      const expected = slotCounts(plan);
      const actual = Object.fromEntries(
        built.group.children.map((child) => [child.name, child.children.length]),
      );
      expect(actual).toEqual({
        'armchair-upholstery-group': expected.upholstery,
        'armchair-structure-group': expected.structure,
        'armchair-hardware-group': expected.hardware,
      });
      expect(actual).toEqual({
        'armchair-upholstery-group': 4,
        'armchair-structure-group': 8,
        'armchair-hardware-group': 4,
      });
    } finally {
      built.dispose();
    }
    expect(built.group.children).toHaveLength(0);
  });

  it('publishes manufacturing metadata only for structural boxes', () => {
    const plan = createFurniturePlan('chair.armchair', DEFAULT_ARMCHAIR_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));
    expect(byId.get('armchair-seat-base')?.manufacturing).toEqual({
      boxCm: [52, 4, 50],
      cutFromSheet: false,
    });
    expect(byId.get('armchair-backrest-frame')?.manufacturing).toEqual({
      boxCm: [44, 42, 4],
      cutFromSheet: false,
    });
    expect(byId.get('armchair-leg-front-left')?.manufacturing).toEqual({
      boxCm: [6, 32, 6],
      cutFromSheet: false,
    });
    expect(byId.get('armchair-armrest-support-left')?.manufacturing).toEqual({
      boxCm: [6, 19, 42],
      cutFromSheet: false,
    });
    expect(byId.get('armchair-seat-cushion')?.manufacturing).toBeUndefined();
    expect(byId.get('armchair-backrest-cushion')?.manufacturing).toBeUndefined();
    expect(byId.get('armchair-armrest-pad-left')?.manufacturing).toBeUndefined();
    expect(
      plan.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(8);

    const withoutArmrests = createFurniturePlan(
      'chair.armchair',
      createArmchairSpec({ armrestsEnabled: false }),
    );
    expect(
      withoutArmrests.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(6);
  });

  it('exports readable GLB bytes', async () => {
    const plan = createFurniturePlan('chair.armchair', DEFAULT_ARMCHAIR_SPEC);
    const built = buildPlan(plan);
    try {
      const glb = await exportGroupToGlb(built.group);
      expect(glb.byteLength).toBeGreaterThan(0);
      const summary = summarizeGlb(glb);
      expect(summary.ok).toBe(true);
      if (summary.ok) {
        expect(summary.summary.meshes).toBeGreaterThanOrEqual(16);
        expect(summary.summary.materials).toHaveLength(3);
      }
    } finally {
      built.dispose();
    }
  });

  it('keeps the previous definitions intact', () => {
    expect(createFurniturePlan('desk.computer', DEFAULT_DESK_SPEC).parts).toHaveLength(16);
    expect(
      createFurniturePlan('desk.gaming', DEFAULT_GAMING_DESK_SPEC).parts,
    ).toHaveLength(21);
    expect(
      createFurniturePlan('table.dining', DEFAULT_DINING_TABLE_SPEC).parts,
    ).toHaveLength(14);
    expect(
      createFurniturePlan('desk.writing', DEFAULT_WRITING_DESK_SPEC).parts,
    ).toHaveLength(17);
    expect(
      createFurniturePlan('chair.office', DEFAULT_OFFICE_CHAIR_SPEC).parts,
    ).toHaveLength(27);
    expect(
      createFurniturePlan('chair.dining', DEFAULT_DINING_CHAIR_SPEC).parts,
    ).toHaveLength(12);
  });
});
