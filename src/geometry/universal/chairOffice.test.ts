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
  DEFAULT_OFFICE_CHAIR_SPEC,
  createOfficeChairSpec,
  officeChairDefinition,
} from './definitions/chairOffice';
import { DEFAULT_DESK_SPEC } from '../furniture/desk';
import { DEFAULT_GAMING_DESK_SPEC } from './definitions/deskGaming';
import { DEFAULT_DINING_TABLE_SPEC } from './definitions/tableDining';
import { DEFAULT_WRITING_DESK_SPEC } from './definitions/deskWriting';

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

describe('chair.office definition', () => {
  it('is registered with the expected metadata', () => {
    const definition = furnitureDefinitions.require('chair.office');
    expect(definition.family).toBe('chair');
    expect(definition.label).toBe('Ofis kreslosi');
    expect(new Set(definition.fields.map((field) => field.key))).toEqual(
      new Set(Object.keys(DEFAULT_OFFICE_CHAIR_SPEC)),
    );
  });

  it('parses the default spec', () => {
    const plan = createFurniturePlan('chair.office', DEFAULT_OFFICE_CHAIR_SPEC);
    expect(plan.parts).toHaveLength(27);
    expect(plan.connections).toHaveLength(26);
    expect(slotCounts(plan)).toEqual({ upholstery: 2, structure: 11, hardware: 14 });
    expect(new Set(plan.parts.map((part) => part.materialSlot))).toEqual(
      new Set(['upholstery', 'structure', 'hardware']),
    );
  });

  it('rejects invalid dimensions, angles and base counts', () => {
    const invalidSpecs = [
      { seatWidth: 0 },
      { seatHeight: 7 },
      { backrestWidth: 50 },
      { backrestThickness: 30 },
      { backrestAngle: 40 },
      { baseLegCount: 4 },
      { baseLegCount: 6 },
      { gasLiftHeight: 41 },
      { armrestHeight: 4 },
      { armrestLength: 50 },
      { casterDiameter: 70 },
      { castersEnabled: 'yes' },
    ];
    for (const overrides of invalidSpecs) {
      const result = tryCreateFurniturePlan('chair.office', {
        ...DEFAULT_OFFICE_CHAIR_SPEC,
        ...overrides,
      });
      expect(result.ok).toBe(false);
    }
  });

  it('rejects unknown channels', () => {
    const result = tryCreateFurniturePlan('chair.office', {
      ...DEFAULT_OFFICE_CHAIR_SPEC,
      rgbEnabled: true,
    });
    expect(result.ok).toBe(false);
  });

  it('places five base arms symmetrically', () => {
    const plan = createFurniturePlan('chair.office', DEFAULT_OFFICE_CHAIR_SPEC);
    const arms = plan.parts.filter((part) => part.id.startsWith('office-chair-base-arm-'));
    expect(arms).toHaveLength(5);
    expect(arms.map((part) => part.rotation[1])).toEqual([0, 72, 144, 216, 288]);
    const sumX = arms.reduce((sum, part) => sum + part.position[0], 0);
    const sumZ = arms.reduce((sum, part) => sum + part.position[2], 0);
    expect(sumX).toBeCloseTo(0, 6);
    expect(sumZ).toBeCloseTo(0, 6);
    for (const arm of arms) {
      expect(Math.hypot(arm.position[0], arm.position[2])).toBeCloseTo(16, 6);
    }
  });

  it('supports armrest ON/OFF', () => {
    const plan = createFurniturePlan(
      'chair.office',
      createOfficeChairSpec({ armrestsEnabled: false }),
    );
    expect(plan.parts).toHaveLength(21);
    expect(plan.connections).toHaveLength(20);
    expect(plan.parts.some((part) => part.id.startsWith('office-chair-arm-'))).toBe(false);
    expect(slotCounts(plan)).toEqual({ upholstery: 2, structure: 7, hardware: 12 });
  });

  it('supports caster ON/OFF', () => {
    const plan = createFurniturePlan(
      'chair.office',
      createOfficeChairSpec({ castersEnabled: false }),
    );
    expect(plan.parts).toHaveLength(17);
    expect(plan.connections).toHaveLength(16);
    expect(plan.parts.some((part) => part.id.includes('caster'))).toBe(false);
    expect(slotCounts(plan)).toEqual({ upholstery: 2, structure: 11, hardware: 4 });
  });

  it('supports both optional groups off', () => {
    const plan = createFurniturePlan(
      'chair.office',
      createOfficeChairSpec({ armrestsEnabled: false, castersEnabled: false }),
    );
    expect(plan.parts).toHaveLength(11);
    expect(plan.connections).toHaveLength(10);
  });

  it('keeps part ids unique and connection references valid', () => {
    for (const overrides of [
      {},
      { armrestsEnabled: false },
      { castersEnabled: false },
      { armrestsEnabled: false, castersEnabled: false },
    ]) {
      const plan = createFurniturePlan('chair.office', createOfficeChairSpec(overrides));
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

  it('places seat, backrest, armrests and gas lift coherently', () => {
    const plan = createFurniturePlan('chair.office', DEFAULT_OFFICE_CHAIR_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));
    expect(byId.get('office-chair-seat')?.position).toEqual([0, 44, 0]);
    const backrest = byId.get('office-chair-backrest');
    expect(backrest?.rotation).toEqual([-10, 0, 0]);
    expect(backrest?.position[0]).toBe(0);
    expect(backrest?.position[1]).toBeCloseTo(75.0822, 3);
    expect(backrest?.position[2]).toBeCloseTo(-24.7753, 3);
    expect(byId.get('office-chair-arm-pad-1')?.position).toEqual([25.5, 68.5, 0]);
    expect(byId.get('office-chair-arm-pad-2')?.position).toEqual([-25.5, 68.5, 0]);
    expect(byId.get('office-chair-arm-post-1')?.position).toEqual([25.5, 57.5, -10]);
    expect(byId.get('office-chair-gas-lift')?.position).toEqual([0, 20, 0]);
    expect(byId.get('office-chair-base-hub')?.position).toEqual([0, 10.5, 0]);
  });

  it('enforces the geometry budget', () => {
    const strict = defineFurniture({
      ...officeChairDefinition,
      limits: {
        ...officeChairDefinition.limits,
        maxPartVertices: 1,
        maxTotalVertices: 1,
      },
    });
    const result = tryCreatePlanFromDefinition(strict, DEFAULT_OFFICE_CHAIR_SPEC);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain('geometry_budget_exceeded');
    }
  });

  it('is deterministic', () => {
    const first = createFurniturePlan('chair.office', DEFAULT_OFFICE_CHAIR_SPEC);
    const second = createFurniturePlan('chair.office', { ...DEFAULT_OFFICE_CHAIR_SPEC });
    expect(second.parts).toEqual(first.parts);
    expect(second.connections).toEqual(first.connections);
  });

  it('builds mesh groups and material slots', () => {
    const plan = createFurniturePlan('chair.office', DEFAULT_OFFICE_CHAIR_SPEC);
    const built = buildPlan(plan);
    try {
      expect(built.group.name).toBe('office-chair-assembly');
      expect(built.materialSlots).toEqual(['upholstery', 'structure', 'hardware']);
      expect(built.materialNames).toEqual([
        'office-chair-upholstery-group-material',
        'office-chair-structure-group-material',
        'office-chair-hardware-group-material',
      ]);
      const expected = slotCounts(plan);
      const actual = Object.fromEntries(
        built.group.children.map((child) => [child.name, child.children.length]),
      );
      expect(actual).toEqual({
        'office-chair-upholstery-group': expected.upholstery,
        'office-chair-structure-group': expected.structure,
        'office-chair-hardware-group': expected.hardware,
      });
      expect(actual).toEqual({
        'office-chair-upholstery-group': 2,
        'office-chair-structure-group': 11,
        'office-chair-hardware-group': 14,
      });

      built.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(built.group);
      expect(box.min.y).toBeCloseTo(0, 6);
      expect(box.max.y).toBeGreaterThan(100);
    } finally {
      built.dispose();
    }
    expect(built.group.children).toHaveLength(0);
  });

  it('publishes manufacturing metadata only for rectangular boxes', () => {
    const plan = createFurniturePlan('chair.office', DEFAULT_OFFICE_CHAIR_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));
    expect(byId.get('office-chair-base-arm-1')?.manufacturing).toEqual({
      boxCm: [4, 3, 32],
      cutFromSheet: false,
    });
    expect(byId.get('office-chair-caster-housing-1')?.manufacturing).toEqual({
      boxCm: [3, 4, 3],
      cutFromSheet: false,
    });
    expect(byId.get('office-chair-arm-post-1')?.manufacturing).toEqual({
      boxCm: [4, 19, 5],
      cutFromSheet: false,
    });
    expect(byId.get('office-chair-seat')?.manufacturing).toBeUndefined();
    expect(byId.get('office-chair-backrest')?.manufacturing).toBeUndefined();
    expect(byId.get('office-chair-gas-lift')?.manufacturing).toBeUndefined();
    expect(byId.get('office-chair-caster-wheel-1')?.manufacturing).toBeUndefined();
    expect(
      plan.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(12);
  });

  it('exports readable GLB bytes', async () => {
    const plan = createFurniturePlan('chair.office', DEFAULT_OFFICE_CHAIR_SPEC);
    const built = buildPlan(plan);
    try {
      const glb = await exportGroupToGlb(built.group);
      expect(glb.byteLength).toBeGreaterThan(0);
      const summary = summarizeGlb(glb);
      expect(summary.ok).toBe(true);
      if (summary.ok) {
        expect(summary.summary.meshes).toBeGreaterThanOrEqual(27);
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
  });
});
