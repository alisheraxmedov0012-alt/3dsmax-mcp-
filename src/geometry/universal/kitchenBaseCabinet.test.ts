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
  DEFAULT_KITCHEN_BASE_CABINET_SPEC,
  createKitchenBaseCabinetSpec,
  kitchenBaseCabinetDefinition,
} from './definitions/kitchenBaseCabinet';
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
import { DEFAULT_BED_STANDARD_SPEC } from './definitions/bedStandard';

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

describe('kitchen.baseCabinet definition', () => {
  it('is registered with the expected metadata', () => {
    const definition = furnitureDefinitions.require('kitchen.baseCabinet');
    expect(definition.family).toBe('dresser');
    expect(definition.label).toBe('Oshxona pastki shkafi');
    expect(new Set(definition.fields.map((field) => field.key))).toEqual(
      new Set(Object.keys(DEFAULT_KITCHEN_BASE_CABINET_SPEC)),
    );
  });

  it('parses the default spec', () => {
    const plan = createFurniturePlan('kitchen.baseCabinet', DEFAULT_KITCHEN_BASE_CABINET_SPEC);
    expect(plan.parts).toHaveLength(16);
    expect(plan.connections).toHaveLength(19);
    expect(slotCounts(plan)).toEqual({ structure: 7, fronts: 2, countertop: 1, hardware: 6 });
  });

  it('rejects invalid dimensions and height inconsistencies', () => {
    const invalidSpecs = [
      { width: 0 },
      { doorCount: 1 },
      { carcassHeight: 72 },
      { totalHeight: 85.8 },
      { panelThickness: 40 },
      { plinthInset: 30 },
      { doorGap: 70 },
      { shelfThickness: 50 },
      { countertopOverhangFront: -1 },
      { shelfEnabled: 'yes' },
    ];
    for (const overrides of invalidSpecs) {
      const result = tryCreateFurniturePlan('kitchen.baseCabinet', {
        ...DEFAULT_KITCHEN_BASE_CABINET_SPEC,
        ...overrides,
      });
      expect(result.ok).toBe(false);
    }
  });

  it('rejects unknown channels', () => {
    const result = tryCreateFurniturePlan('kitchen.baseCabinet', {
      ...DEFAULT_KITCHEN_BASE_CABINET_SPEC,
      sinkCutout: true,
    });
    expect(result.ok).toBe(false);
  });

  it('places the carcass panels inside the carcass envelope', () => {
    const plan = createFurniturePlan('kitchen.baseCabinet', DEFAULT_KITCHEN_BASE_CABINET_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));
    expect(byId.get('kitchen-base-side-left')?.geometry).toEqual({
      kind: 'box',
      width: 2,
      height: 76.2,
      depth: 60,
    });
    expect(byId.get('kitchen-base-side-left')?.position).toEqual([-29, 48.1, 0]);
    expect(byId.get('kitchen-base-top')?.geometry).toEqual({
      kind: 'box',
      width: 56,
      height: 2,
      depth: 60,
    });
    expect(byId.get('kitchen-base-top')?.position).toEqual([0, 85.2, 0]);
    expect(byId.get('kitchen-base-bottom')?.position).toEqual([0, 11, 0]);
    expect(byId.get('kitchen-base-back')?.geometry).toEqual({
      kind: 'box',
      width: 56,
      height: 72.2,
      depth: 0.6,
    });
    expect(byId.get('kitchen-base-back')?.position[2]).toBeCloseTo(-29.7, 6);
  });

  it('computes the internal opening from the panel thicknesses', () => {
    const plan = createFurniturePlan('kitchen.baseCabinet', DEFAULT_KITCHEN_BASE_CABINET_SPEC);
    const shelf = plan.parts.find((part) => part.id === 'kitchen-base-shelf');
    expect(shelf?.geometry).toEqual({ kind: 'box', width: 56, height: 2, depth: 59.4 });
  });

  it('places the countertop with exact overhangs and total height', () => {
    const plan = createFurniturePlan('kitchen.baseCabinet', DEFAULT_KITCHEN_BASE_CABINET_SPEC);
    const countertop = plan.parts.find((part) => part.id === 'kitchen-base-countertop');
    expect(countertop?.geometry).toEqual({
      kind: 'box',
      width: 62,
      height: 3.8,
      depth: 62,
    });
    expect(countertop?.position[0]).toBe(0);
    expect(countertop?.position[1]).toBeCloseTo(88.1, 6);
    expect(countertop?.position[2]).toBe(1);
    expect(10 + 76.2 + 3.8).toBeCloseTo(90, 6);

    const built = buildPlan(plan);
    try {
      built.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(built.group);
      expect(box.max.y - box.min.y).toBeCloseTo(90, 6);
      expect(box.min.y).toBeCloseTo(0, 6);
      expect(box.max.x - box.min.x).toBeCloseTo(62, 6);
    } finally {
      built.dispose();
    }
  });

  it('supports shelf ON/OFF and attaches it to both sides', () => {
    const on = createFurniturePlan('kitchen.baseCabinet', DEFAULT_KITCHEN_BASE_CABINET_SPEC);
    expect(on.connections.some((connection) => connection.id === 'kitchen-base-shelf-left')).toBe(
      true,
    );
    expect(on.connections.some((connection) => connection.id === 'kitchen-base-shelf-right')).toBe(
      true,
    );

    const off = createFurniturePlan(
      'kitchen.baseCabinet',
      createKitchenBaseCabinetSpec({ shelfEnabled: false }),
    );
    expect(off.parts).toHaveLength(15);
    expect(off.connections).toHaveLength(17);
    expect(off.parts.some((part) => part.id.includes('shelf'))).toBe(false);
    expect(off.connections.some((connection) => connection.id.includes('shelf'))).toBe(false);
  });

  it('creates two symmetric doors with the configured gap', () => {
    const plan = createFurniturePlan('kitchen.baseCabinet', DEFAULT_KITCHEN_BASE_CABINET_SPEC);
    const left = plan.parts.find((part) => part.id === 'kitchen-base-door-left');
    const right = plan.parts.find((part) => part.id === 'kitchen-base-door-right');
    expect(left?.dimensions.width).toBeCloseTo(27.85, 6);
    expect(left?.dimensions.height).toBeCloseTo(75.6, 6);
    expect(left?.dimensions.depth).toBe(2);
    expect(right?.dimensions.width).toBeCloseTo(27.85, 6);
    expect(right?.dimensions.height).toBeCloseTo(75.6, 6);
    expect(right?.dimensions.depth).toBe(2);
    expect(left?.position[0]).toBeCloseTo(-14.075, 6);
    expect(left?.position[1]).toBeCloseTo(48.1, 6);
    expect(left?.position[2]).toBe(29);
    expect(right?.position[0]).toBeCloseTo(14.075, 6);
    expect(right?.position[1]).toBeCloseTo(48.1, 6);
    expect(right?.position[2]).toBe(29);
    const gap =
      right!.position[0] - right!.dimensions.width / 2 -
      (left!.position[0] + left!.dimensions.width / 2);
    expect(gap).toBeCloseTo(0.3, 6);
  });

  it('creates four hinges with valid door and carcass references', () => {
    const plan = createFurniturePlan('kitchen.baseCabinet', DEFAULT_KITCHEN_BASE_CABINET_SPEC);
    const hinges = plan.parts.filter((part) => part.id.startsWith('kitchen-base-hinge-'));
    expect(hinges).toHaveLength(4);
    for (const hinge of hinges) {
      expect(hinge.materialSlot).toBe('hardware');
      expect(
        plan.connections.filter((connection) => connection.id.startsWith(hinge.id)).length,
      ).toBe(2);
    }
    expect(plan.parts.find((part) => part.id === 'kitchen-base-hinge-left-1')?.position).toEqual([
      -27, 18, 29,
    ]);
  });

  it('supports handle ON/OFF symmetrically', () => {
    const on = createFurniturePlan('kitchen.baseCabinet', DEFAULT_KITCHEN_BASE_CABINET_SPEC);
    const handles = on.parts.filter((part) =>
      part.id.startsWith('kitchen-base-door-handle-'),
    );
    expect(handles).toHaveLength(2);
    expect(handles[0].position[0]).toBeCloseTo(-4.15, 6);
    expect(handles[1].position[0]).toBeCloseTo(4.15, 6);
    expect(handles[0].position[1]).toBe(48.1);
    for (const handle of handles) {
      expect(handle.materialSlot).toBe('hardware');
      expect(on.connections.some((connection) => connection.id.startsWith(handle.id))).toBe(true);
    }

    const off = createFurniturePlan(
      'kitchen.baseCabinet',
      createKitchenBaseCabinetSpec({ handleEnabled: false }),
    );
    expect(off.parts).toHaveLength(14);
    expect(off.connections).toHaveLength(17);
    expect(off.parts.some((part) => part.id.includes('handle'))).toBe(false);
    expect(slotCounts(off).hardware).toBe(4);
  });

  it('supports plinth ON/OFF and provides floor contact either way', () => {
    const on = createFurniturePlan('kitchen.baseCabinet', DEFAULT_KITCHEN_BASE_CABINET_SPEC);
    const plinth = on.parts.find((part) => part.id === 'kitchen-base-plinth');
    expect(plinth?.geometry).toEqual({ kind: 'box', width: 50, height: 10, depth: 55 });
    expect(plinth?.position).toEqual([0, 5, -2.5]);
    expect(on.connections.some((connection) => connection.id === 'kitchen-base-plinth-bottom')).toBe(
      true,
    );

    const off = createFurniturePlan(
      'kitchen.baseCabinet',
      createKitchenBaseCabinetSpec({ plinthEnabled: false }),
    );
    expect(off.parts).toHaveLength(19);
    expect(off.connections).toHaveLength(22);
    expect(off.parts.some((part) => part.id === 'kitchen-base-plinth')).toBe(false);
    expect(off.parts.filter((part) => part.id.startsWith('kitchen-base-foot-'))).toHaveLength(4);

    for (const spec of [DEFAULT_KITCHEN_BASE_CABINET_SPEC, createKitchenBaseCabinetSpec({ plinthEnabled: false })]) {
      const plan = createFurniturePlan('kitchen.baseCabinet', spec);
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

  it('keeps ids unique and references valid in every toggle state', () => {
    const combinations = [
      {},
      { shelfEnabled: false },
      { plinthEnabled: false },
      { handleEnabled: false },
      { shelfEnabled: false, plinthEnabled: false, handleEnabled: false },
    ];
    for (const overrides of combinations) {
      const plan = createFurniturePlan('kitchen.baseCabinet', createKitchenBaseCabinetSpec(overrides));
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
      ...kitchenBaseCabinetDefinition,
      limits: {
        ...kitchenBaseCabinetDefinition.limits,
        maxPartVertices: 1,
        maxTotalVertices: 1,
      },
    });
    const result = tryCreatePlanFromDefinition(strict, DEFAULT_KITCHEN_BASE_CABINET_SPEC);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain('geometry_budget_exceeded');
    }
  });

  it('is deterministic', () => {
    const first = createFurniturePlan('kitchen.baseCabinet', DEFAULT_KITCHEN_BASE_CABINET_SPEC);
    const second = createFurniturePlan('kitchen.baseCabinet', {
      ...DEFAULT_KITCHEN_BASE_CABINET_SPEC,
    });
    expect(second.parts).toEqual(first.parts);
    expect(second.connections).toEqual(first.connections);
  });

  it('builds mesh groups and material slots', () => {
    const plan = createFurniturePlan('kitchen.baseCabinet', DEFAULT_KITCHEN_BASE_CABINET_SPEC);
    const built = buildPlan(plan);
    try {
      expect(built.group.name).toBe('kitchen-base-cabinet-assembly');
      expect(built.materialSlots).toEqual(['structure', 'fronts', 'countertop', 'hardware']);
      expect(built.materialNames).toEqual([
        'kitchen-base-structure-group-material',
        'kitchen-base-fronts-group-material',
        'kitchen-base-countertop-group-material',
        'kitchen-base-hardware-group-material',
      ]);
      const expected = slotCounts(plan);
      const actual = Object.fromEntries(
        built.group.children.map((child) => [child.name, child.children.length]),
      );
      expect(actual).toEqual({
        'kitchen-base-structure-group': expected.structure,
        'kitchen-base-fronts-group': expected.fronts,
        'kitchen-base-countertop-group': expected.countertop,
        'kitchen-base-hardware-group': expected.hardware,
      });
      expect(actual).toEqual({
        'kitchen-base-structure-group': 7,
        'kitchen-base-fronts-group': 2,
        'kitchen-base-countertop-group': 1,
        'kitchen-base-hardware-group': 6,
      });
    } finally {
      built.dispose();
    }
    expect(built.group.children).toHaveLength(0);
  });

  it('publishes manufacturing metadata only for box parts', () => {
    const plan = createFurniturePlan('kitchen.baseCabinet', DEFAULT_KITCHEN_BASE_CABINET_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));
    expect(byId.get('kitchen-base-countertop')?.manufacturing).toEqual({
      boxCm: [62, 3.8, 62],
      cutFromSheet: true,
    });
    expect(byId.get('kitchen-base-shelf')?.manufacturing).toEqual({
      boxCm: [56, 2, 59.4],
      cutFromSheet: true,
    });
    const doorBox = byId.get('kitchen-base-door-left')?.manufacturing?.boxCm;
    expect(doorBox?.[0]).toBeCloseTo(27.85, 6);
    expect(doorBox?.[1]).toBeCloseTo(75.6, 6);
    expect(doorBox?.[2]).toBe(2);
    expect(byId.get('kitchen-base-door-left')?.manufacturing?.cutFromSheet).toBe(true);
    expect(byId.get('kitchen-base-plinth')?.manufacturing).toEqual({
      boxCm: [50, 10, 55],
      cutFromSheet: true,
    });
    expect(byId.get('kitchen-base-hinge-left-1')?.manufacturing).toBeUndefined();
    expect(byId.get('kitchen-base-door-handle-left')?.manufacturing).toBeUndefined();
    expect(
      plan.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(10);

    const withoutPlinth = createFurniturePlan(
      'kitchen.baseCabinet',
      createKitchenBaseCabinetSpec({ plinthEnabled: false }),
    );
    expect(
      withoutPlinth.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(9);
    const withoutShelf = createFurniturePlan(
      'kitchen.baseCabinet',
      createKitchenBaseCabinetSpec({ shelfEnabled: false }),
    );
    expect(
      withoutShelf.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(9);
  });

  it('exports readable GLB bytes', async () => {
    const plan = createFurniturePlan('kitchen.baseCabinet', DEFAULT_KITCHEN_BASE_CABINET_SPEC);
    const built = buildPlan(plan);
    try {
      const glb = await exportGroupToGlb(built.group);
      expect(glb.byteLength).toBeGreaterThan(0);
      const summary = summarizeGlb(glb);
      expect(summary.ok).toBe(true);
      if (summary.ok) {
        expect(summary.summary.meshes).toBeGreaterThanOrEqual(16);
        expect(summary.summary.materials).toHaveLength(4);
      }
    } finally {
      built.dispose();
    }
  });

  it('keeps the previous definitions intact', () => {
    expect(createFurniturePlan('desk.computer', DEFAULT_DESK_SPEC).parts).toHaveLength(16);
    expect(createFurniturePlan('desk.gaming', DEFAULT_GAMING_DESK_SPEC).parts).toHaveLength(21);
    expect(createFurniturePlan('table.dining', DEFAULT_DINING_TABLE_SPEC).parts).toHaveLength(14);
    expect(createFurniturePlan('desk.writing', DEFAULT_WRITING_DESK_SPEC).parts).toHaveLength(17);
    expect(createFurniturePlan('chair.office', DEFAULT_OFFICE_CHAIR_SPEC).parts).toHaveLength(27);
    expect(createFurniturePlan('chair.dining', DEFAULT_DINING_CHAIR_SPEC).parts).toHaveLength(12);
    expect(createFurniturePlan('chair.armchair', DEFAULT_ARMCHAIR_SPEC).parts).toHaveLength(16);
    expect(createFurniturePlan('chair.ergonomic', DEFAULT_ERGONOMIC_CHAIR_SPEC).parts).toHaveLength(32);
    expect(createFurniturePlan('sofa.standard', DEFAULT_SOFA_STANDARD_SPEC).parts).toHaveLength(29);
    expect(createFurniturePlan('cabinet.standard', DEFAULT_CABINET_STANDARD_SPEC).parts).toHaveLength(28);
    expect(createFurniturePlan('bed.standard', DEFAULT_BED_STANDARD_SPEC).parts).toHaveLength(35);
  });
});
