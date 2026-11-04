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
  DEFAULT_CABINET_STANDARD_SPEC,
  cabinetStandardDefinition,
  createCabinetStandardSpec,
} from './definitions/cabinetStandard';
import { DEFAULT_DESK_SPEC } from '../furniture/desk';
import { DEFAULT_GAMING_DESK_SPEC } from './definitions/deskGaming';
import { DEFAULT_DINING_TABLE_SPEC } from './definitions/tableDining';
import { DEFAULT_WRITING_DESK_SPEC } from './definitions/deskWriting';
import { DEFAULT_OFFICE_CHAIR_SPEC } from './definitions/chairOffice';
import { DEFAULT_DINING_CHAIR_SPEC } from './definitions/chairDining';
import { DEFAULT_ARMCHAIR_SPEC } from './definitions/chairArmchair';
import { DEFAULT_ERGONOMIC_CHAIR_SPEC } from './definitions/chairErgonomic';
import { DEFAULT_SOFA_STANDARD_SPEC } from './definitions/sofaStandard';

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

describe('cabinet.standard definition', () => {
  it('is registered with the expected metadata', () => {
    const definition = furnitureDefinitions.require('cabinet.standard');
    expect(definition.family).toBe('dresser');
    expect(definition.label).toBe('Standart shkaf');
    expect(new Set(definition.fields.map((field) => field.key))).toEqual(
      new Set(Object.keys(DEFAULT_CABINET_STANDARD_SPEC)),
    );
  });

  it('parses the default spec', () => {
    const plan = createFurniturePlan('cabinet.standard', DEFAULT_CABINET_STANDARD_SPEC);
    expect(plan.parts).toHaveLength(28);
    expect(plan.connections).toHaveLength(31);
    expect(slotCounts(plan)).toEqual({ structure: 12, fronts: 4, hardware: 12 });
  });

  it('rejects invalid dimensions and counts', () => {
    const invalidSpecs = [
      { width: 0 },
      { doorCount: 1 },
      { drawerCount: 1 },
      { shelfCount: 2 },
      { drawerDepth: 50 },
      { height: 50 },
      { panelThickness: 25 },
      { legHeight: 100 },
      { doorsEnabled: 'yes' },
    ];
    for (const overrides of invalidSpecs) {
      const result = tryCreateFurniturePlan('cabinet.standard', {
        ...DEFAULT_CABINET_STANDARD_SPEC,
        ...overrides,
      });
      expect(result.ok).toBe(false);
    }
  });

  it('rejects unknown channels', () => {
    const result = tryCreateFurniturePlan('cabinet.standard', {
      ...DEFAULT_CABINET_STANDARD_SPEC,
      softCloseEnabled: true,
    });
    expect(result.ok).toBe(false);
  });

  it('places the carcass panels inside the external envelope', () => {
    const plan = createFurniturePlan('cabinet.standard', DEFAULT_CABINET_STANDARD_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));
    expect(byId.get('cabinet-side-left')?.geometry).toEqual({
      kind: 'box',
      width: 2,
      height: 90,
      depth: 45,
    });
    expect(byId.get('cabinet-side-left')?.position).toEqual([-59, 55, 0]);
    expect(byId.get('cabinet-side-right')?.position).toEqual([59, 55, 0]);
    expect(byId.get('cabinet-top')?.geometry).toEqual({
      kind: 'box',
      width: 116,
      height: 2,
      depth: 45,
    });
    expect(byId.get('cabinet-top')?.position).toEqual([0, 99, 0]);
    expect(byId.get('cabinet-bottom')?.position).toEqual([0, 11, 0]);
    expect(byId.get('cabinet-back')?.geometry).toEqual({
      kind: 'box',
      width: 116,
      height: 86,
      depth: 0.6,
    });
    expect(byId.get('cabinet-back')?.position[2]).toBeCloseTo(-22.2, 6);

    const built = buildPlan(plan);
    try {
      built.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(built.group);
      expect(box.max.x - box.min.x).toBeCloseTo(120, 6);
      expect(box.max.y - box.min.y).toBeCloseTo(100, 6);
      expect(box.min.y).toBeCloseTo(0, 6);
    } finally {
      built.dispose();
    }
  });

  it('computes the internal opening from the panel thicknesses', () => {
    const plan = createFurniturePlan('cabinet.standard', DEFAULT_CABINET_STANDARD_SPEC);
    const shelf = plan.parts.find((part) => part.id === 'cabinet-shelf');
    expect(shelf?.geometry).toEqual({ kind: 'box', width: 116, height: 2, depth: 44.4 });
    const drawerBody = plan.parts.find((part) => part.id === 'cabinet-drawer-body-1');
    expect(drawerBody?.dimensions).toEqual({ width: 114, height: 18, depth: 38 });
  });

  it('supports shelf ON/OFF and attaches the shelf to both sides', () => {
    const on = createFurniturePlan('cabinet.standard', DEFAULT_CABINET_STANDARD_SPEC);
    expect(on.connections.some((connection) => connection.id === 'cabinet-shelf-left')).toBe(
      true,
    );
    expect(on.connections.some((connection) => connection.id === 'cabinet-shelf-right')).toBe(
      true,
    );

    const off = createFurniturePlan(
      'cabinet.standard',
      createCabinetStandardSpec({ shelfEnabled: false }),
    );
    expect(off.parts).toHaveLength(27);
    expect(off.connections).toHaveLength(29);
    expect(off.parts.some((part) => part.id === 'cabinet-shelf')).toBe(false);
    expect(off.connections.some((connection) => connection.id.includes('shelf'))).toBe(false);
  });

  it('creates two symmetric doors with a uniform gap', () => {
    const plan = createFurniturePlan('cabinet.standard', DEFAULT_CABINET_STANDARD_SPEC);
    const left = plan.parts.find((part) => part.id === 'cabinet-door-left');
    const right = plan.parts.find((part) => part.id === 'cabinet-door-right');
    expect(left?.dimensions).toEqual({ width: 57.5, height: 52, depth: 2 });
    expect(right?.dimensions).toEqual({ width: 57.5, height: 52, depth: 2 });
    expect(left?.position).toEqual([-29.25, 72, 21.5]);
    expect(right?.position).toEqual([29.25, 72, 21.5]);
    const gap =
      right!.position[0] - right!.dimensions.width / 2 -
      (left!.position[0] + left!.dimensions.width / 2);
    expect(gap).toBeCloseTo(1, 6);
  });

  it('creates four hinges and their reference connections', () => {
    const plan = createFurniturePlan('cabinet.standard', DEFAULT_CABINET_STANDARD_SPEC);
    const hinges = plan.parts.filter((part) => part.id.startsWith('cabinet-hinge-'));
    expect(hinges).toHaveLength(4);
    for (const hinge of hinges) {
      expect(hinge.materialSlot).toBe('hardware');
      expect(
        plan.connections.filter((connection) => connection.id.startsWith(hinge.id)).length,
      ).toBe(2);
    }
    expect(plan.parts.find((part) => part.id === 'cabinet-hinge-left-1')?.position).toEqual([
      -57, 54, 21.5,
    ]);
  });

  it('supports doors ON/OFF including hinges and door handles', () => {
    const off = createFurniturePlan(
      'cabinet.standard',
      createCabinetStandardSpec({ doorsEnabled: false }),
    );
    expect(off.parts).toHaveLength(20);
    expect(off.connections).toHaveLength(21);
    expect(off.parts.some((part) => part.id.includes('door'))).toBe(false);
    expect(off.parts.some((part) => part.id.includes('hinge'))).toBe(false);
    expect(off.connections.some((connection) => connection.id.includes('hinge'))).toBe(false);
    expect(slotCounts(off)).toEqual({ structure: 12, fronts: 2, hardware: 6 });
  });

  it('creates two drawer assemblies with separate fronts', () => {
    const plan = createFurniturePlan('cabinet.standard', DEFAULT_CABINET_STANDARD_SPEC);
    const bodies = plan.parts.filter((part) => part.id.startsWith('cabinet-drawer-body-'));
    const fronts = plan.parts.filter((part) => part.id.startsWith('cabinet-drawer-front-'));
    expect(bodies).toHaveLength(2);
    expect(fronts).toHaveLength(2);
    expect(bodies[0].position).toEqual([0, 19, 1.5]);
    expect(bodies[1].position).toEqual([0, 37, 1.5]);
    expect(fronts[0].position).toEqual([0, 19, 21.5]);
    expect(fronts[1].position).toEqual([0, 37, 21.5]);
    expect(fronts[0].geometry).toEqual({ kind: 'box', width: 114, height: 18, depth: 2 });
  });

  it('supports drawers ON/OFF and validates drawer depth', () => {
    const off = createFurniturePlan(
      'cabinet.standard',
      createCabinetStandardSpec({ drawersEnabled: false }),
    );
    expect(off.parts).toHaveLength(22);
    expect(off.connections).toHaveLength(25);
    expect(off.parts.some((part) => part.id.includes('drawer'))).toBe(false);
    expect(off.connections.some((connection) => connection.id.includes('drawer'))).toBe(false);
    expect(slotCounts(off)).toEqual({ structure: 10, fronts: 2, hardware: 10 });

    const invalid = tryCreateFurniturePlan('cabinet.standard', {
      ...DEFAULT_CABINET_STANDARD_SPEC,
      drawerDepth: 50,
    });
    expect(invalid.ok).toBe(false);
  });

  it('supports handle ON/OFF symmetrically', () => {
    const on = createFurniturePlan('cabinet.standard', DEFAULT_CABINET_STANDARD_SPEC);
    const doorHandles = on.parts.filter((part) => part.id.startsWith('cabinet-door-handle-'));
    const drawerHandles = on.parts.filter((part) =>
      part.id.startsWith('cabinet-drawer-handle-'),
    );
    expect(doorHandles).toHaveLength(2);
    expect(drawerHandles).toHaveLength(2);
    expect(doorHandles[0].position[0]).toBeCloseTo(-5.5, 6);
    expect(doorHandles[1].position[0]).toBeCloseTo(5.5, 6);
    expect(drawerHandles.map((part) => part.position[0])).toEqual([0, 0]);
    for (const handle of [...doorHandles, ...drawerHandles]) {
      expect(handle.materialSlot).toBe('hardware');
      expect(
        on.connections.some((connection) => connection.id.startsWith(handle.id)),
      ).toBe(true);
    }

    const off = createFurniturePlan(
      'cabinet.standard',
      createCabinetStandardSpec({ handleEnabled: false }),
    );
    expect(off.parts).toHaveLength(24);
    expect(off.connections).toHaveLength(27);
    expect(off.parts.some((part) => part.id.includes('handle'))).toBe(false);
  });

  it('places four legs on the floor under the bottom panel', () => {
    const plan = createFurniturePlan('cabinet.standard', DEFAULT_CABINET_STANDARD_SPEC);
    const legs = plan.parts.filter(
      (part) => part.id.startsWith('cabinet-leg-') && !part.id.includes('screw'),
    );
    expect(legs).toHaveLength(4);
    for (const leg of legs) {
      expect(leg.dimensions).toEqual({ width: 5, height: 10, depth: 5 });
      expect(leg.position[1]).toBe(5);
      expect(Math.abs(leg.position[0])).toBeCloseTo(52.5, 6);
      expect(Math.abs(leg.position[2])).toBeCloseTo(15, 6);
    }
  });

  it('keeps ids unique and references valid in every toggle state', () => {
    const combinations = [
      {},
      { shelfEnabled: false },
      { doorsEnabled: false },
      { drawersEnabled: false },
      { handleEnabled: false },
      {
        shelfEnabled: false,
        doorsEnabled: false,
        drawersEnabled: false,
        handleEnabled: false,
      },
    ];
    for (const overrides of combinations) {
      const plan = createFurniturePlan('cabinet.standard', createCabinetStandardSpec(overrides));
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
      ...cabinetStandardDefinition,
      limits: {
        ...cabinetStandardDefinition.limits,
        maxPartVertices: 1,
        maxTotalVertices: 1,
      },
    });
    const result = tryCreatePlanFromDefinition(strict, DEFAULT_CABINET_STANDARD_SPEC);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain('geometry_budget_exceeded');
    }
  });

  it('is deterministic', () => {
    const first = createFurniturePlan('cabinet.standard', DEFAULT_CABINET_STANDARD_SPEC);
    const second = createFurniturePlan('cabinet.standard', { ...DEFAULT_CABINET_STANDARD_SPEC });
    expect(second.parts).toEqual(first.parts);
    expect(second.connections).toEqual(first.connections);
  });

  it('builds mesh groups and material slots', () => {
    const plan = createFurniturePlan('cabinet.standard', DEFAULT_CABINET_STANDARD_SPEC);
    const built = buildPlan(plan);
    try {
      expect(built.group.name).toBe('cabinet-standard-assembly');
      expect(built.materialSlots).toEqual(['structure', 'fronts', 'hardware']);
      expect(built.materialNames).toEqual([
        'cabinet-structure-group-material',
        'cabinet-fronts-group-material',
        'cabinet-hardware-group-material',
      ]);
      const expected = slotCounts(plan);
      const actual = Object.fromEntries(
        built.group.children.map((child) => [child.name, child.children.length]),
      );
      expect(actual).toEqual({
        'cabinet-structure-group': expected.structure,
        'cabinet-fronts-group': expected.fronts,
        'cabinet-hardware-group': expected.hardware,
      });
      expect(actual).toEqual({
        'cabinet-structure-group': 12,
        'cabinet-fronts-group': 4,
        'cabinet-hardware-group': 12,
      });
    } finally {
      built.dispose();
    }
    expect(built.group.children).toHaveLength(0);
  });

  it('publishes manufacturing metadata only for real box parts', () => {
    const plan = createFurniturePlan('cabinet.standard', DEFAULT_CABINET_STANDARD_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));
    expect(byId.get('cabinet-shelf')?.manufacturing).toEqual({
      boxCm: [116, 2, 44.4],
      cutFromSheet: true,
    });
    expect(byId.get('cabinet-door-left')?.manufacturing).toEqual({
      boxCm: [57.5, 52, 2],
      cutFromSheet: true,
    });
    expect(byId.get('cabinet-drawer-front-1')?.manufacturing).toEqual({
      boxCm: [114, 18, 2],
      cutFromSheet: true,
    });
    expect(byId.get('cabinet-leg-front-left')?.manufacturing).toEqual({
      boxCm: [5, 10, 5],
      cutFromSheet: false,
    });
    expect(byId.get('cabinet-drawer-body-1')?.manufacturing).toBeUndefined();
    expect(byId.get('cabinet-hinge-left-1')?.manufacturing).toBeUndefined();
    expect(byId.get('cabinet-door-handle-left')?.manufacturing).toBeUndefined();
    expect(
      plan.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(14);
  });

  it('exports readable GLB bytes', async () => {
    const plan = createFurniturePlan('cabinet.standard', DEFAULT_CABINET_STANDARD_SPEC);
    const built = buildPlan(plan);
    try {
      const glb = await exportGroupToGlb(built.group);
      expect(glb.byteLength).toBeGreaterThan(0);
      const summary = summarizeGlb(glb);
      expect(summary.ok).toBe(true);
      if (summary.ok) {
        expect(summary.summary.meshes).toBeGreaterThanOrEqual(28);
        expect(summary.summary.materials).toHaveLength(3);
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
  });
});
