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
  DEFAULT_SOFA_STANDARD_SPEC,
  createSofaStandardSpec,
  sofaStandardDefinition,
} from './definitions/sofaStandard';
import { DEFAULT_DESK_SPEC } from '../furniture/desk';
import { DEFAULT_GAMING_DESK_SPEC } from './definitions/deskGaming';
import { DEFAULT_DINING_TABLE_SPEC } from './definitions/tableDining';
import { DEFAULT_WRITING_DESK_SPEC } from './definitions/deskWriting';
import { DEFAULT_OFFICE_CHAIR_SPEC } from './definitions/chairOffice';
import { DEFAULT_DINING_CHAIR_SPEC } from './definitions/chairDining';
import { DEFAULT_ARMCHAIR_SPEC } from './definitions/chairArmchair';
import { DEFAULT_ERGONOMIC_CHAIR_SPEC } from './definitions/chairErgonomic';

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

describe('sofa.standard definition', () => {
  it('is registered with the expected metadata', () => {
    const definition = furnitureDefinitions.require('sofa.standard');
    expect(definition.family).toBe('sofa');
    expect(definition.label).toBe('Uch o‘rinli divan');
    expect(new Set(definition.fields.map((field) => field.key))).toEqual(
      new Set(Object.keys(DEFAULT_SOFA_STANDARD_SPEC)),
    );
  });

  it('parses the default spec', () => {
    const plan = createFurniturePlan('sofa.standard', DEFAULT_SOFA_STANDARD_SPEC);
    expect(plan.parts).toHaveLength(29);
    expect(plan.connections).toHaveLength(23);
    expect(slotCounts(plan)).toEqual({ upholstery: 8, structure: 13, hardware: 8 });
    expect(new Set(plan.parts.map((part) => part.materialSlot))).toEqual(
      new Set(['upholstery', 'structure', 'hardware']),
    );
  });

  it('rejects invalid dimensions and inconsistent heights', () => {
    const invalidSpecs = [
      { width: 0 },
      { seatCount: 2 },
      { legCount: 6 },
      { seatHeight: 46 },
      { totalHeight: 86 },
      { frameThickness: 20 },
      { seatCushionDepth: 90 },
      { backrestThickness: 20 },
      { seatCushionThickness: 50 },
      { armrestHeight: 5 },
      { armrestLength: 95 },
      { backCushionEnabled: 'yes' },
    ];
    for (const overrides of invalidSpecs) {
      const result = tryCreateFurniturePlan('sofa.standard', {
        ...DEFAULT_SOFA_STANDARD_SPEC,
        ...overrides,
      });
      expect(result.ok).toBe(false);
    }
  });

  it('rejects unknown channels', () => {
    const result = tryCreateFurniturePlan('sofa.standard', {
      ...DEFAULT_SOFA_STANDARD_SPEC,
      chaiseEnabled: true,
    });
    expect(result.ok).toBe(false);
  });

  it('creates three separate seat cushions with symmetric centres', () => {
    const plan = createFurniturePlan('sofa.standard', DEFAULT_SOFA_STANDARD_SPEC);
    const cushions = plan.parts.filter((part) => part.id.startsWith('sofa-seat-cushion-'));
    expect(cushions).toHaveLength(3);
    expect(cushions.map((part) => Math.round(part.position[0] * 10) / 10)).toEqual([
      -58.5, 0, 58.5,
    ]);
    expect(cushions[0].dimensions.width).toBeCloseTo(57, 6);
    expect(cushions[0].dimensions.height).toBe(15);
    expect(cushions[0].dimensions.depth).toBe(58);
    expect(cushions[0].position[1]).toBe(52.5);
    expect(cushions[0].position[2]).toBe(12);
  });

  it('leaves a gap between neighbouring seat cushions and no overlap', () => {
    const plan = createFurniturePlan('sofa.standard', DEFAULT_SOFA_STANDARD_SPEC);
    const cushions = plan.parts.filter((part) => part.id.startsWith('sofa-seat-cushion-'));
    const left = cushions[0];
    const middle = cushions[1];
    const gap =
      middle.position[0] - middle.dimensions.width / 2 -
      (left.position[0] + left.dimensions.width / 2);
    expect(gap).toBeCloseTo(1.5, 6);
    expect(gap).toBeGreaterThan(0);
  });

  it('creates three back cushions aligned with the seat cushions', () => {
    const plan = createFurniturePlan('sofa.standard', DEFAULT_SOFA_STANDARD_SPEC);
    const seats = plan.parts.filter((part) => part.id.startsWith('sofa-seat-cushion-'));
    const backs = plan.parts.filter((part) => part.id.startsWith('sofa-back-cushion-'));
    expect(backs).toHaveLength(3);
    expect(backs.map((part) => part.position[0])).toEqual(seats.map((part) => part.position[0]));
    expect(backs[0].position[1]).toBe(65);
    expect(backs[0].position[2]).toBe(-27);
  });

  it('supports back cushion ON/OFF while keeping the backrest support', () => {
    const off = createFurniturePlan(
      'sofa.standard',
      createSofaStandardSpec({ backCushionEnabled: false }),
    );
    expect(off.parts).toHaveLength(26);
    expect(off.connections).toHaveLength(20);
    expect(off.parts.some((part) => part.id.includes('back-cushion'))).toBe(false);
    expect(off.connections.some((connection) => connection.id.includes('back-cushion'))).toBe(
      false,
    );
    expect(off.parts.some((part) => part.id === 'sofa-backrest-support')).toBe(true);
    expect(slotCounts(off)).toEqual({ upholstery: 5, structure: 13, hardware: 8 });
  });

  it('supports armrest ON/OFF symmetrically', () => {
    const off = createFurniturePlan(
      'sofa.standard',
      createSofaStandardSpec({ armrestsEnabled: false }),
    );
    expect(off.parts).toHaveLength(23);
    expect(off.connections).toHaveLength(17);
    expect(off.parts.some((part) => part.id.includes('armrest'))).toBe(false);
    expect(off.connections.some((connection) => connection.id.includes('armrest'))).toBe(
      false,
    );
    expect(slotCounts(off)).toEqual({ upholstery: 6, structure: 11, hardware: 6 });

    const on = createFurniturePlan('sofa.standard', DEFAULT_SOFA_STANDARD_SPEC);
    const left = on.parts.find((part) => part.id === 'sofa-armrest-pad-left');
    const right = on.parts.find((part) => part.id === 'sofa-armrest-pad-right');
    expect(left?.position).toEqual([96, 67.5, 0]);
    expect(right?.position).toEqual([-96, 67.5, 0]);
  });

  it('places four legs under the frame and on the floor', () => {
    const plan = createFurniturePlan('sofa.standard', DEFAULT_SOFA_STANDARD_SPEC);
    const legs = plan.parts.filter((part) => part.id.startsWith('sofa-leg-') && !part.id.includes('screw'));
    expect(legs).toHaveLength(4);
    for (const leg of legs) {
      expect(leg.dimensions).toEqual({ width: 5, height: 10, depth: 5 });
      expect(leg.position[1]).toBe(5);
      expect(Math.abs(leg.position[0])).toBeCloseTo(97.5, 6);
      expect(Math.abs(leg.position[2])).toBeCloseTo(37.5, 6);
    }
    expect(
      plan.connections.filter((connection) => connection.componentIds[0].startsWith('sofa-leg-')).length,
    ).toBeGreaterThanOrEqual(4);

    const built = buildPlan(plan);
    try {
      built.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(built.group);
      expect(box.min.y).toBeCloseTo(0, 6);
      expect(box.max.y).toBeCloseTo(85, 6);
    } finally {
      built.dispose();
    }
  });

  it('keeps part ids unique and connection references valid in toggle states', () => {
    const combinations = [
      {},
      { backCushionEnabled: false },
      { armrestsEnabled: false },
      { backCushionEnabled: false, armrestsEnabled: false },
    ];
    for (const overrides of combinations) {
      const plan = createFurniturePlan('sofa.standard', createSofaStandardSpec(overrides));
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
      ...sofaStandardDefinition,
      limits: {
        ...sofaStandardDefinition.limits,
        maxPartVertices: 1,
        maxTotalVertices: 1,
      },
    });
    const result = tryCreatePlanFromDefinition(strict, DEFAULT_SOFA_STANDARD_SPEC);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain('geometry_budget_exceeded');
    }
  });

  it('is deterministic', () => {
    const first = createFurniturePlan('sofa.standard', DEFAULT_SOFA_STANDARD_SPEC);
    const second = createFurniturePlan('sofa.standard', { ...DEFAULT_SOFA_STANDARD_SPEC });
    expect(second.parts).toEqual(first.parts);
    expect(second.connections).toEqual(first.connections);
  });

  it('builds mesh groups and material slots', () => {
    const plan = createFurniturePlan('sofa.standard', DEFAULT_SOFA_STANDARD_SPEC);
    const built = buildPlan(plan);
    try {
      expect(built.group.name).toBe('sofa-standard-assembly');
      expect(built.materialSlots).toEqual(['upholstery', 'structure', 'hardware']);
      expect(built.materialNames).toEqual([
        'sofa-upholstery-group-material',
        'sofa-structure-group-material',
        'sofa-hardware-group-material',
      ]);
      const expected = slotCounts(plan);
      const actual = Object.fromEntries(
        built.group.children.map((child) => [child.name, child.children.length]),
      );
      expect(actual).toEqual({
        'sofa-upholstery-group': expected.upholstery,
        'sofa-structure-group': expected.structure,
        'sofa-hardware-group': expected.hardware,
      });
      expect(actual).toEqual({
        'sofa-upholstery-group': 8,
        'sofa-structure-group': 13,
        'sofa-hardware-group': 8,
      });
    } finally {
      built.dispose();
    }
    expect(built.group.children).toHaveLength(0);
  });

  it('publishes manufacturing metadata only for structural boxes', () => {
    const plan = createFurniturePlan('sofa.standard', DEFAULT_SOFA_STANDARD_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));
    expect(byId.get('sofa-frame-bottom')?.manufacturing).toEqual({
      boxCm: [210, 5, 90],
      cutFromSheet: false,
    });
    expect(byId.get('sofa-backrest-support')?.manufacturing).toEqual({
      boxCm: [174, 40, 12],
      cutFromSheet: false,
    });
    expect(byId.get('sofa-armrest-support-left')?.manufacturing).toEqual({
      boxCm: [18, 20, 85],
      cutFromSheet: false,
    });
    expect(byId.get('sofa-leg-front-left')?.manufacturing).toEqual({
      boxCm: [5, 10, 5],
      cutFromSheet: false,
    });
    expect(byId.get('sofa-seat-cushion-1')?.manufacturing).toBeUndefined();
    expect(byId.get('sofa-back-cushion-1')?.manufacturing).toBeUndefined();
    expect(byId.get('sofa-armrest-pad-left')?.manufacturing).toBeUndefined();
    expect(
      plan.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(13);

    const noArmrests = createFurniturePlan(
      'sofa.standard',
      createSofaStandardSpec({ armrestsEnabled: false }),
    );
    expect(
      noArmrests.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(11);
  });

  it('exports readable GLB bytes', async () => {
    const plan = createFurniturePlan('sofa.standard', DEFAULT_SOFA_STANDARD_SPEC);
    const built = buildPlan(plan);
    try {
      const glb = await exportGroupToGlb(built.group);
      expect(glb.byteLength).toBeGreaterThan(0);
      const summary = summarizeGlb(glb);
      expect(summary.ok).toBe(true);
      if (summary.ok) {
        expect(summary.summary.meshes).toBeGreaterThanOrEqual(29);
        expect(summary.summary.materials).toHaveLength(3);
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
    expect(
      createFurniturePlan('chair.dining', DEFAULT_DINING_CHAIR_SPEC).parts,
    ).toHaveLength(12);
    expect(
      createFurniturePlan('chair.armchair', DEFAULT_ARMCHAIR_SPEC).parts,
    ).toHaveLength(16);
    expect(
      createFurniturePlan('chair.ergonomic', DEFAULT_ERGONOMIC_CHAIR_SPEC).parts,
    ).toHaveLength(32);
  });
});
