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
  DEFAULT_DINING_CHAIR_SPEC,
  createDiningChairSpec,
  diningChairDefinition,
} from './definitions/chairDining';
import { DEFAULT_DESK_SPEC } from '../furniture/desk';
import { DEFAULT_GAMING_DESK_SPEC } from './definitions/deskGaming';
import { DEFAULT_DINING_TABLE_SPEC } from './definitions/tableDining';
import { DEFAULT_WRITING_DESK_SPEC } from './definitions/deskWriting';
import { DEFAULT_OFFICE_CHAIR_SPEC } from './definitions/chairOffice';

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

describe('chair.dining definition', () => {
  it('is registered with the expected metadata', () => {
    const definition = furnitureDefinitions.require('chair.dining');
    expect(definition.family).toBe('chair');
    expect(definition.label).toBe('Ovqat stuli');
    expect(new Set(definition.fields.map((field) => field.key))).toEqual(
      new Set(Object.keys(DEFAULT_DINING_CHAIR_SPEC)),
    );
  });

  it('parses the default spec', () => {
    const plan = createFurniturePlan('chair.dining', DEFAULT_DINING_CHAIR_SPEC);
    expect(plan.parts).toHaveLength(12);
    expect(plan.connections).toHaveLength(15);
    expect(slotCounts(plan)).toEqual({ structure: 10, hardware: 2 });
    expect(new Set(plan.parts.map((part) => part.materialSlot))).toEqual(
      new Set(['structure', 'hardware']),
    );
  });

  it('rejects invalid dimensions and angles', () => {
    const invalidSpecs = [
      { seatWidth: 0 },
      { seatHeight: 3 },
      { legInset: 22 },
      { backrestWidth: 50 },
      { backrestAngle: 40 },
      { armrestsEnabled: true, armrestHeight: 4 },
      { armrestsEnabled: true, armrestLength: 50 },
      { cornerRadius: 1.5 },
      { backrestEnabled: 'yes' },
    ];
    for (const overrides of invalidSpecs) {
      const result = tryCreateFurniturePlan('chair.dining', {
        ...DEFAULT_DINING_CHAIR_SPEC,
        ...overrides,
      });
      expect(result.ok).toBe(false);
    }
  });

  it('rejects unknown channels', () => {
    const result = tryCreateFurniturePlan('chair.dining', {
      ...DEFAULT_DINING_CHAIR_SPEC,
      castersEnabled: true,
    });
    expect(result.ok).toBe(false);
  });

  it('places four legs on the floor and under the seat', () => {
    const plan = createFurniturePlan('chair.dining', DEFAULT_DINING_CHAIR_SPEC);
    const legs = plan.parts.filter((part) => part.id.startsWith('dining-chair-leg-'));
    expect(legs).toHaveLength(4);
    for (const leg of legs) {
      expect(leg.dimensions).toEqual({ width: 4, height: 43, depth: 4 });
      expect(leg.position[1]).toBe(21.5);
      expect(Math.abs(leg.position[0])).toBeCloseTo(16.5, 6);
      expect(Math.abs(leg.position[2])).toBeCloseTo(15, 6);
    }
    const built = buildPlan(plan);
    try {
      built.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(built.group);
      expect(box.min.y).toBeCloseTo(0, 6);
      expect(box.max.y).toBeGreaterThan(80);
    } finally {
      built.dispose();
    }
  });

  it('supports backrest ON/OFF', () => {
    const off = createFurniturePlan(
      'chair.dining',
      createDiningChairSpec({ backrestEnabled: false }),
    );
    expect(off.parts).toHaveLength(9);
    expect(off.connections).toHaveLength(12);
    expect(off.parts.some((part) => part.id.includes('backrest'))).toBe(false);
    expect(slotCounts(off)).toEqual({ structure: 9 });
  });

  it('supports armrest ON/OFF symmetrically', () => {
    const on = createFurniturePlan(
      'chair.dining',
      createDiningChairSpec({ armrestsEnabled: true }),
    );
    expect(on.parts).toHaveLength(18);
    expect(on.connections).toHaveLength(21);
    expect(slotCounts(on)).toEqual({ structure: 14, hardware: 4 });
    const left = on.parts.find((part) => part.id === 'dining-chair-armrest-pad-left');
    const right = on.parts.find((part) => part.id === 'dining-chair-armrest-pad-right');
    expect(left?.position[0]).toBeCloseTo(23.5, 6);
    expect(right?.position[0]).toBeCloseTo(-23.5, 6);
    expect(left?.position[1]).toBeCloseTo(64.5, 6);
    expect(left?.position[2]).toBe(0);
    expect(right?.position[2]).toBe(0);

    const off = createFurniturePlan('chair.dining', DEFAULT_DINING_CHAIR_SPEC);
    expect(off.parts.some((part) => part.id.includes('armrest'))).toBe(false);
  });

  it('supports support rail ON/OFF', () => {
    const off = createFurniturePlan(
      'chair.dining',
      createDiningChairSpec({ supportRailsEnabled: false }),
    );
    expect(off.parts).toHaveLength(8);
    expect(off.connections).toHaveLength(7);
    expect(off.parts.some((part) => part.id.includes('rail'))).toBe(false);
    expect(off.connections.some((connection) => connection.id.includes('rail'))).toBe(false);
  });

  it('keeps part ids unique and connection references valid', () => {
    const combinations = [
      {},
      { backrestEnabled: false },
      { supportRailsEnabled: false },
      { armrestsEnabled: true },
      { backrestEnabled: false, supportRailsEnabled: false, armrestsEnabled: true },
    ];
    for (const overrides of combinations) {
      const plan = createFurniturePlan('chair.dining', createDiningChairSpec(overrides));
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
      ...diningChairDefinition,
      limits: {
        ...diningChairDefinition.limits,
        maxPartVertices: 1,
        maxTotalVertices: 1,
      },
    });
    const result = tryCreatePlanFromDefinition(strict, DEFAULT_DINING_CHAIR_SPEC);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain('geometry_budget_exceeded');
    }
  });

  it('is deterministic', () => {
    const first = createFurniturePlan('chair.dining', DEFAULT_DINING_CHAIR_SPEC);
    const second = createFurniturePlan('chair.dining', { ...DEFAULT_DINING_CHAIR_SPEC });
    expect(second.parts).toEqual(first.parts);
    expect(second.connections).toEqual(first.connections);
  });

  it('builds mesh groups and material slots', () => {
    const plan = createFurniturePlan('chair.dining', DEFAULT_DINING_CHAIR_SPEC);
    const built = buildPlan(plan);
    try {
      expect(built.group.name).toBe('dining-chair-assembly');
      expect(built.materialSlots).toEqual(['structure', 'hardware']);
      expect(built.materialNames).toEqual([
        'dining-chair-structure-group-material',
        'dining-chair-hardware-group-material',
      ]);
      const expected = slotCounts(plan);
      const actual = Object.fromEntries(
        built.group.children.map((child) => [child.name, child.children.length]),
      );
      expect(actual).toEqual({
        'dining-chair-structure-group': expected.structure,
        'dining-chair-hardware-group': expected.hardware,
      });
      expect(actual).toEqual({
        'dining-chair-structure-group': 10,
        'dining-chair-hardware-group': 2,
      });
    } finally {
      built.dispose();
    }
    expect(built.group.children).toHaveLength(0);
  });

  it('publishes manufacturing metadata only for rectangular boxes', () => {
    const plan = createFurniturePlan('chair.dining', DEFAULT_DINING_CHAIR_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));
    expect(byId.get('dining-chair-leg-front-left')?.manufacturing).toEqual({
      boxCm: [4, 43, 4],
      cutFromSheet: false,
    });
    expect(byId.get('dining-chair-rail-front')?.manufacturing).toEqual({
      boxCm: [33, 3, 2.5],
      cutFromSheet: false,
    });
    expect(byId.get('dining-chair-rail-left')?.manufacturing).toEqual({
      boxCm: [2.5, 3, 30],
      cutFromSheet: false,
    });
    expect(byId.get('dining-chair-seat')?.manufacturing).toBeUndefined();
    expect(byId.get('dining-chair-backrest')?.manufacturing).toBeUndefined();
    expect(
      plan.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(8);

    const withArmrests = createFurniturePlan(
      'chair.dining',
      createDiningChairSpec({ armrestsEnabled: true }),
    );
    expect(
      withArmrests.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(10);
  });

  it('exports readable GLB bytes', async () => {
    const plan = createFurniturePlan('chair.dining', DEFAULT_DINING_CHAIR_SPEC);
    const built = buildPlan(plan);
    try {
      const glb = await exportGroupToGlb(built.group);
      expect(glb.byteLength).toBeGreaterThan(0);
      const summary = summarizeGlb(glb);
      expect(summary.ok).toBe(true);
      if (summary.ok) {
        expect(summary.summary.meshes).toBeGreaterThanOrEqual(12);
        expect(summary.summary.materials).toHaveLength(2);
      }
    } finally {
      built.dispose();
    }
  });

  it('keeps the previous definitions intact', () => {
    expect(createFurniturePlan('desk.computer', DEFAULT_DESK_SPEC).parts).toHaveLength(24);
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
  });
});
