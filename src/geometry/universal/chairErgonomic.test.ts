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
  DEFAULT_ERGONOMIC_CHAIR_SPEC,
  createErgonomicChairSpec,
  ergonomicChairDefinition,
} from './definitions/chairErgonomic';
import { DEFAULT_DESK_SPEC } from '../furniture/desk';
import { DEFAULT_GAMING_DESK_SPEC } from './definitions/deskGaming';
import { DEFAULT_DINING_TABLE_SPEC } from './definitions/tableDining';
import { DEFAULT_WRITING_DESK_SPEC } from './definitions/deskWriting';
import { DEFAULT_OFFICE_CHAIR_SPEC } from './definitions/chairOffice';
import { DEFAULT_DINING_CHAIR_SPEC } from './definitions/chairDining';
import { DEFAULT_ARMCHAIR_SPEC } from './definitions/chairArmchair';

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

describe('chair.ergonomic definition', () => {
  it('is registered with the expected metadata', () => {
    const definition = furnitureDefinitions.require('chair.ergonomic');
    expect(definition.family).toBe('chair');
    expect(definition.label).toBe('Ergonomik kreslo');
    expect(new Set(definition.fields.map((field) => field.key))).toEqual(
      new Set(Object.keys(DEFAULT_ERGONOMIC_CHAIR_SPEC)),
    );
  });

  it('parses the default spec', () => {
    const plan = createFurniturePlan('chair.ergonomic', DEFAULT_ERGONOMIC_CHAIR_SPEC);
    expect(plan.parts).toHaveLength(32);
    expect(plan.connections).toHaveLength(31);
    expect(slotCounts(plan)).toEqual({ upholstery: 6, structure: 11, hardware: 15 });
    expect(new Set(plan.parts.map((part) => part.materialSlot))).toEqual(
      new Set(['upholstery', 'structure', 'hardware']),
    );
  });

  it('rejects invalid dimensions, toggles and relationships', () => {
    const invalidSpecs = [
      { seatWidth: 0 },
      { seatCushionThickness: 8 },
      { seatCushionThickness: 4 },
      { backrestWidth: 51 },
      { backrestAngle: 40 },
      { lumbarHeight: 60 },
      { headrestWidth: 50 },
      { headrestThickness: 7 },
      { armrestHeight: 7 },
      { armrestLength: 49 },
      { gasLiftHeight: 44 },
      { baseLegCount: 4 },
      { casterDiameter: 70 },
      { lumbarSupportEnabled: 'yes' },
    ];
    for (const overrides of invalidSpecs) {
      const result = tryCreateFurniturePlan('chair.ergonomic', {
        ...DEFAULT_ERGONOMIC_CHAIR_SPEC,
        ...overrides,
      });
      expect(result.ok).toBe(false);
    }
  });

  it('rejects unknown channels', () => {
    const result = tryCreateFurniturePlan('chair.ergonomic', {
      ...DEFAULT_ERGONOMIC_CHAIR_SPEC,
      rgbEnabled: true,
    });
    expect(result.ok).toBe(false);
  });

  it('creates a seat base and a separate volumetric cushion', () => {
    const plan = createFurniturePlan('chair.ergonomic', DEFAULT_ERGONOMIC_CHAIR_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));
    expect(byId.get('ergonomic-chair-seat-base')?.geometry).toEqual({
      kind: 'box',
      width: 50,
      height: 3,
      depth: 48,
    });
    expect(byId.get('ergonomic-chair-seat-base')?.position).toEqual([0, 41.5, 0]);
    expect(byId.get('ergonomic-chair-seat-cushion')?.geometry).toEqual({
      kind: 'roundedBox',
      width: 50,
      height: 5,
      depth: 48,
      radius: 2,
      segments: 6,
    });
    expect(byId.get('ergonomic-chair-seat-cushion')?.position).toEqual([0, 45.5, 0]);
  });

  it('places the backrest at the configured angle', () => {
    const plan = createFurniturePlan('chair.ergonomic', DEFAULT_ERGONOMIC_CHAIR_SPEC);
    const cushion = plan.parts.find((part) => part.id === 'ergonomic-chair-backrest-cushion');
    expect(cushion?.rotation).toEqual([-10, 0, 0]);
    expect(cushion?.position[1]).toBeCloseTo(76.559, 3);
    expect(cushion?.position[2]).toBeCloseTo(-26.5358, 3);
    const frame = plan.parts.find((part) => part.id === 'ergonomic-chair-backrest-frame');
    expect(frame?.geometry).toEqual({ kind: 'box', width: 40, height: 52, depth: 3 });
    expect(frame?.position[2]).toBeLessThan(cushion?.position[2] ?? 0);
  });

  it('supports lumbar ON/OFF', () => {
    const on = createFurniturePlan('chair.ergonomic', DEFAULT_ERGONOMIC_CHAIR_SPEC);
    expect(on.parts.some((part) => part.id === 'ergonomic-chair-lumbar-support')).toBe(true);
    expect(on.connections.some((connection) => connection.id.includes('lumbar'))).toBe(true);

    const off = createFurniturePlan(
      'chair.ergonomic',
      createErgonomicChairSpec({ lumbarSupportEnabled: false }),
    );
    expect(off.parts).toHaveLength(31);
    expect(off.connections).toHaveLength(30);
    expect(off.parts.some((part) => part.id.includes('lumbar'))).toBe(false);
    expect(off.connections.some((connection) => connection.id.includes('lumbar'))).toBe(false);
    expect(slotCounts(off)).toEqual({ upholstery: 5, structure: 11, hardware: 15 });
  });

  it('supports headrest ON/OFF', () => {
    const off = createFurniturePlan(
      'chair.ergonomic',
      createErgonomicChairSpec({ headrestEnabled: false }),
    );
    expect(off.parts).toHaveLength(30);
    expect(off.connections).toHaveLength(29);
    expect(off.parts.some((part) => part.id.includes('headrest'))).toBe(false);
    expect(off.connections.some((connection) => connection.id.includes('headrest'))).toBe(
      false,
    );
    expect(slotCounts(off)).toEqual({ upholstery: 5, structure: 10, hardware: 15 });
  });

  it('supports armrest ON/OFF and exposes adjustable metadata', () => {
    const off = createFurniturePlan(
      'chair.ergonomic',
      createErgonomicChairSpec({ armrestsEnabled: false }),
    );
    expect(off.parts).toHaveLength(26);
    expect(off.connections).toHaveLength(25);
    expect(off.parts.some((part) => part.id.includes('armrest'))).toBe(false);
    expect(off.connections.some((connection) => connection.id.includes('armrest'))).toBe(
      false,
    );

    const on = createFurniturePlan('chair.ergonomic', DEFAULT_ERGONOMIC_CHAIR_SPEC);
    const left = on.parts.find((part) => part.id === 'ergonomic-chair-armrest-pad-left');
    const right = on.parts.find((part) => part.id === 'ergonomic-chair-armrest-pad-right');
    expect(left?.position).toEqual([28, 70.5, 0]);
    expect(right?.position).toEqual([-28, 70.5, 0]);
    expect(left?.metadata).toMatchObject({
      adjustable: true,
      adjustment: 'static-height-slider',
    });

    const fixed = createFurniturePlan(
      'chair.ergonomic',
      createErgonomicChairSpec({ armrestAdjustable: false }),
    );
    expect(
      fixed.parts.find((part) => part.id === 'ergonomic-chair-armrest-pad-left')?.metadata,
    ).toMatchObject({ adjustable: false, adjustment: 'fixed' });
  });

  it('distributes five base arms evenly and keeps the gas lift central', () => {
    const plan = createFurniturePlan('chair.ergonomic', DEFAULT_ERGONOMIC_CHAIR_SPEC);
    const arms = plan.parts.filter((part) =>
      part.id.startsWith('ergonomic-chair-base-arm-'),
    );
    expect(arms).toHaveLength(5);
    expect(arms.map((part) => part.rotation[1])).toEqual([0, 72, 144, 216, 288]);
    const sumX = arms.reduce((sum, part) => sum + part.position[0], 0);
    const sumZ = arms.reduce((sum, part) => sum + part.position[2], 0);
    expect(sumX).toBeCloseTo(0, 6);
    expect(sumZ).toBeCloseTo(0, 6);
    for (const arm of arms) {
      expect(Math.hypot(arm.position[0], arm.position[2])).toBeCloseTo(17, 6);
    }
    const gasLift = plan.parts.find((part) => part.id === 'ergonomic-chair-gas-lift');
    expect(gasLift?.position).toEqual([0, 21, 0]);
    expect(gasLift?.dimensions.height).toBe(42);
  });

  it('supports caster ON/OFF and keeps floor contact', () => {
    const off = createFurniturePlan(
      'chair.ergonomic',
      createErgonomicChairSpec({ casterEnabled: false }),
    );
    expect(off.parts).toHaveLength(22);
    expect(off.connections).toHaveLength(21);
    expect(off.parts.some((part) => part.id.includes('caster'))).toBe(false);
    expect(slotCounts(off)).toEqual({ upholstery: 6, structure: 11, hardware: 5 });

    for (const spec of [DEFAULT_ERGONOMIC_CHAIR_SPEC, createErgonomicChairSpec({ casterEnabled: false })]) {
      const plan = createFurniturePlan('chair.ergonomic', spec);
      const built = buildPlan(plan);
      try {
        built.group.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(built.group);
        expect(box.min.y).toBeCloseTo(0, 6);
      } finally {
        built.dispose();
      }
    }
  });

  it('keeps part ids unique and connection references valid in every toggle state', () => {
    const combinations = [
      {},
      { lumbarSupportEnabled: false },
      { headrestEnabled: false },
      { armrestsEnabled: false },
      { casterEnabled: false },
      {
        lumbarSupportEnabled: false,
        headrestEnabled: false,
        armrestsEnabled: false,
        casterEnabled: false,
      },
    ];
    for (const overrides of combinations) {
      const plan = createFurniturePlan('chair.ergonomic', createErgonomicChairSpec(overrides));
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
      ...ergonomicChairDefinition,
      limits: {
        ...ergonomicChairDefinition.limits,
        maxPartVertices: 1,
        maxTotalVertices: 1,
      },
    });
    const result = tryCreatePlanFromDefinition(strict, DEFAULT_ERGONOMIC_CHAIR_SPEC);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain('geometry_budget_exceeded');
    }
  });

  it('is deterministic', () => {
    const first = createFurniturePlan('chair.ergonomic', DEFAULT_ERGONOMIC_CHAIR_SPEC);
    const second = createFurniturePlan('chair.ergonomic', { ...DEFAULT_ERGONOMIC_CHAIR_SPEC });
    expect(second.parts).toEqual(first.parts);
    expect(second.connections).toEqual(first.connections);
  });

  it('builds mesh groups and material slots', () => {
    const plan = createFurniturePlan('chair.ergonomic', DEFAULT_ERGONOMIC_CHAIR_SPEC);
    const built = buildPlan(plan);
    try {
      expect(built.group.name).toBe('ergonomic-chair-assembly');
      expect(built.materialSlots).toEqual(['upholstery', 'structure', 'hardware']);
      expect(built.materialNames).toEqual([
        'ergonomic-chair-upholstery-group-material',
        'ergonomic-chair-structure-group-material',
        'ergonomic-chair-hardware-group-material',
      ]);
      const expected = slotCounts(plan);
      const actual = Object.fromEntries(
        built.group.children.map((child) => [child.name, child.children.length]),
      );
      expect(actual).toEqual({
        'ergonomic-chair-upholstery-group': expected.upholstery,
        'ergonomic-chair-structure-group': expected.structure,
        'ergonomic-chair-hardware-group': expected.hardware,
      });
      expect(actual).toEqual({
        'ergonomic-chair-upholstery-group': 6,
        'ergonomic-chair-structure-group': 11,
        'ergonomic-chair-hardware-group': 15,
      });
      built.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(built.group);
      expect(box.min.y).toBeCloseTo(0, 6);
      expect(box.max.y).toBeGreaterThan(110);
    } finally {
      built.dispose();
    }
    expect(built.group.children).toHaveLength(0);
  });

  it('publishes manufacturing metadata only for rectangular boxes', () => {
    const plan = createFurniturePlan('chair.ergonomic', DEFAULT_ERGONOMIC_CHAIR_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));
    expect(byId.get('ergonomic-chair-seat-base')?.manufacturing).toEqual({
      boxCm: [50, 3, 48],
      cutFromSheet: false,
    });
    expect(byId.get('ergonomic-chair-backrest-frame')?.manufacturing).toEqual({
      boxCm: [40, 52, 3],
      cutFromSheet: false,
    });
    expect(byId.get('ergonomic-chair-headrest-support')?.manufacturing).toEqual({
      boxCm: [8, 12, 4],
      cutFromSheet: false,
    });
    expect(byId.get('ergonomic-chair-seat-cushion')?.manufacturing).toBeUndefined();
    expect(byId.get('ergonomic-chair-lumbar-support')?.manufacturing).toBeUndefined();
    expect(byId.get('ergonomic-chair-headrest-cushion')?.manufacturing).toBeUndefined();
    expect(byId.get('ergonomic-chair-gas-lift')?.manufacturing).toBeUndefined();
    expect(
      plan.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(15);

    const noHeadrest = createFurniturePlan(
      'chair.ergonomic',
      createErgonomicChairSpec({ headrestEnabled: false }),
    );
    expect(
      noHeadrest.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(14);
    const noExtras = createFurniturePlan(
      'chair.ergonomic',
      createErgonomicChairSpec({
        headrestEnabled: false,
        armrestsEnabled: false,
        casterEnabled: false,
      }),
    );
    expect(
      noExtras.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(7);
  });

  it('exports readable GLB bytes', async () => {
    const plan = createFurniturePlan('chair.ergonomic', DEFAULT_ERGONOMIC_CHAIR_SPEC);
    const built = buildPlan(plan);
    try {
      const glb = await exportGroupToGlb(built.group);
      expect(glb.byteLength).toBeGreaterThan(0);
      const summary = summarizeGlb(glb);
      expect(summary.ok).toBe(true);
      if (summary.ok) {
        expect(summary.summary.meshes).toBeGreaterThanOrEqual(32);
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
    expect(
      createFurniturePlan('chair.armchair', DEFAULT_ARMCHAIR_SPEC).parts,
    ).toHaveLength(16);
  });
});
