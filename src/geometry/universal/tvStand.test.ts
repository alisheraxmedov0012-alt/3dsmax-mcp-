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
  DEFAULT_TV_STAND_SPEC,
  createTvStandSpec,
  tvStandDefinition,
} from './definitions/tvStand';
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
import { DEFAULT_KITCHEN_BASE_CABINET_SPEC } from './definitions/kitchenBaseCabinet';

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

describe('stand.tv definition', () => {
  it('is registered with the expected metadata', () => {
    const definition = furnitureDefinitions.require('stand.tv');
    expect(definition.family).toBe('dresser');
    expect(definition.label).toBe('TV stand / media konsol');
    expect(new Set(definition.fields.map((field) => field.key))).toEqual(
      new Set(Object.keys(DEFAULT_TV_STAND_SPEC)),
    );
  });

  it('parses the default spec', () => {
    const plan = createFurniturePlan('stand.tv', DEFAULT_TV_STAND_SPEC);
    expect(plan.parts).toHaveLength(28);
    expect(plan.connections).toHaveLength(31);
    expect(slotCounts(plan)).toEqual({ structure: 12, fronts: 4, hardware: 12 });
  });

  it('rejects invalid dimensions and counts', () => {
    const invalidSpecs = [
      { width: 0 },
      { depth: 5 },
      { doorCount: 1 },
      { drawerCount: 1 },
      { totalHeight: 10 },
      { legHeight: 60 },
      { panelThickness: 40 },
      { doorGap: 200 },
      { handlesEnabled: 'yes' },
    ];
    for (const overrides of invalidSpecs) {
      const result = tryCreateFurniturePlan('stand.tv', {
        ...DEFAULT_TV_STAND_SPEC,
        ...overrides,
      });
      expect(result.ok).toBe(false);
    }
  });

  it('rejects unknown channels', () => {
    const result = tryCreateFurniturePlan('stand.tv', {
      ...DEFAULT_TV_STAND_SPEC,
      tvMountEnabled: true,
    });
    expect(result.ok).toBe(false);
  });

  it('places the carcass panels and keeps the external envelope', () => {
    const plan = createFurniturePlan('stand.tv', DEFAULT_TV_STAND_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));
    expect(byId.get('tv-stand-side-left')?.geometry).toEqual({
      kind: 'box',
      width: 2,
      height: 45,
      depth: 40,
    });
    expect(byId.get('tv-stand-side-left')?.position).toEqual([-79, 32.5, 0]);
    expect(byId.get('tv-stand-top')?.geometry).toEqual({
      kind: 'box',
      width: 156,
      height: 2,
      depth: 40,
    });
    expect(byId.get('tv-stand-top')?.position).toEqual([0, 54, 0]);
    expect(byId.get('tv-stand-bottom')?.position).toEqual([0, 11, 0]);
    expect(byId.get('tv-stand-back')?.geometry).toEqual({
      kind: 'box',
      width: 156,
      height: 41,
      depth: 0.6,
    });

    const built = buildPlan(plan);
    try {
      built.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(built.group);
      expect(box.max.x - box.min.x).toBeCloseTo(160, 6);
      expect(box.max.y - box.min.y).toBeCloseTo(55, 6);
      expect(box.min.y).toBeCloseTo(0, 6);
    } finally {
      built.dispose();
    }
  });

  it('computes the inner opening and shelf dimensions', () => {
    const plan = createFurniturePlan('stand.tv', DEFAULT_TV_STAND_SPEC);
    const shelf = plan.parts.find((part) => part.id === 'tv-stand-shelf');
    expect(shelf?.geometry).toEqual({ kind: 'box', width: 156, height: 2, depth: 39.4 });
  });

  it('supports shelf ON/OFF and side attachments', () => {
    const on = createFurniturePlan('stand.tv', DEFAULT_TV_STAND_SPEC);
    expect(on.connections.some((connection) => connection.id === 'tv-stand-shelf-left')).toBe(
      true,
    );
    expect(on.connections.some((connection) => connection.id === 'tv-stand-shelf-right')).toBe(
      true,
    );
    const off = createFurniturePlan(
      'stand.tv',
      createTvStandSpec({ shelfEnabled: false }),
    );
    expect(off.parts).toHaveLength(27);
    expect(off.connections).toHaveLength(29);
    expect(off.parts.some((part) => part.id === 'tv-stand-shelf')).toBe(false);
    expect(off.connections.some((connection) => connection.id.includes('shelf'))).toBe(false);
  });

  it('creates two symmetric doors with a uniform gap', () => {
    const plan = createFurniturePlan('stand.tv', DEFAULT_TV_STAND_SPEC);
    const left = plan.parts.find((part) => part.id === 'tv-stand-door-left');
    const right = plan.parts.find((part) => part.id === 'tv-stand-door-right');
    expect(left?.dimensions.width).toBeCloseTo(77.85, 6);
    expect(left?.dimensions.height).toBeCloseTo(27.4, 6);
    expect(left?.dimensions.depth).toBe(2);
    expect(right?.dimensions.width).toBeCloseTo(77.85, 6);
    expect(left?.position[0]).toBeCloseTo(-39.075, 6);
    expect(right?.position[0]).toBeCloseTo(39.075, 6);
    expect(left?.position[1]).toBeCloseTo(39, 6);
    const gap =
      right!.position[0] - right!.dimensions.width / 2 -
      (left!.position[0] + left!.dimensions.width / 2);
    expect(gap).toBeCloseTo(0.3, 6);
  });

  it('creates two drawer assemblies below the doors', () => {
    const plan = createFurniturePlan('stand.tv', DEFAULT_TV_STAND_SPEC);
    const bodies = plan.parts.filter((part) => part.id.startsWith('tv-stand-drawer-body-'));
    const fronts = plan.parts.filter((part) => part.id.startsWith('tv-stand-drawer-front-'));
    expect(bodies).toHaveLength(2);
    expect(fronts).toHaveLength(2);
    expect(bodies[0].position[1]).toBe(17.5);
    expect(bodies[1].position[1]).toBe(17.5);
    expect(fronts[0].geometry).toEqual({ kind: 'box', width: 77.85, height: 15, depth: 2 });
    expect(fronts[0].position[1]).toBe(17.5);
  });

  it('creates four hinges with door and carcass references', () => {
    const plan = createFurniturePlan('stand.tv', DEFAULT_TV_STAND_SPEC);
    const hinges = plan.parts.filter((part) => part.id.startsWith('tv-stand-hinge-'));
    expect(hinges).toHaveLength(4);
    for (const hinge of hinges) {
      expect(
        plan.connections.filter((connection) => connection.id.startsWith(hinge.id)).length,
      ).toBe(2);
    }
  });

  it('supports doors ON/OFF including hinges and door handles', () => {
    const off = createFurniturePlan(
      'stand.tv',
      createTvStandSpec({ doorsEnabled: false }),
    );
    expect(off.parts).toHaveLength(20);
    expect(off.connections).toHaveLength(21);
    expect(off.parts.some((part) => part.id.includes('door'))).toBe(false);
    expect(off.parts.some((part) => part.id.includes('hinge'))).toBe(false);
    expect(slotCounts(off)).toEqual({ structure: 12, fronts: 2, hardware: 6 });
  });

  it('supports drawers ON/OFF', () => {
    const off = createFurniturePlan(
      'stand.tv',
      createTvStandSpec({ drawersEnabled: false }),
    );
    expect(off.parts).toHaveLength(22);
    expect(off.connections).toHaveLength(25);
    expect(off.parts.some((part) => part.id.includes('drawer'))).toBe(false);
    expect(slotCounts(off)).toEqual({ structure: 10, fronts: 2, hardware: 10 });
  });

  it('supports handles ON/OFF symmetrically', () => {
    const on = createFurniturePlan('stand.tv', DEFAULT_TV_STAND_SPEC);
    const doorHandles = on.parts.filter((part) =>
      part.id.startsWith('tv-stand-door-handle-'),
    );
    const drawerHandles = on.parts.filter((part) =>
      part.id.startsWith('tv-stand-drawer-handle-'),
    );
    expect(doorHandles).toHaveLength(2);
    expect(drawerHandles).toHaveLength(2);
    expect(doorHandles[0].position[0]).toBeCloseTo(-4.15, 6);
    expect(doorHandles[1].position[0]).toBeCloseTo(4.15, 6);
    expect(drawerHandles[0].position[0]).toBeCloseTo(-39.075, 6);
    expect(drawerHandles[1].position[0]).toBeCloseTo(39.075, 6);

    const off = createFurniturePlan(
      'stand.tv',
      createTvStandSpec({ handlesEnabled: false }),
    );
    expect(off.parts).toHaveLength(24);
    expect(off.connections).toHaveLength(27);
    expect(off.parts.some((part) => part.id.includes('handle'))).toBe(false);
  });

  it('supports legs ON/OFF and keeps floor contact', () => {
    const on = createFurniturePlan('stand.tv', DEFAULT_TV_STAND_SPEC);
    const legs = on.parts.filter(
      (part) => part.id.startsWith('tv-stand-leg-') && !part.id.includes('screw'),
    );
    expect(legs).toHaveLength(4);
    for (const leg of legs) {
      expect(Math.abs(leg.position[0])).toBeCloseTo(72.5, 6);
      expect(Math.abs(leg.position[2])).toBeCloseTo(12.5, 6);
      expect(leg.position[1]).toBe(5);
    }

    const off = createFurniturePlan(
      'stand.tv',
      createTvStandSpec({ legsEnabled: false }),
    );
    expect(off.parts).toHaveLength(20);
    expect(off.connections).toHaveLength(23);
    expect(off.parts.some((part) => part.id.includes('leg'))).toBe(false);

    for (const spec of [DEFAULT_TV_STAND_SPEC, createTvStandSpec({ legsEnabled: false })]) {
      const plan = createFurniturePlan('stand.tv', spec);
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
      { doorsEnabled: false },
      { drawersEnabled: false },
      { handlesEnabled: false },
      { legsEnabled: false },
      {
        shelfEnabled: false,
        doorsEnabled: false,
        drawersEnabled: false,
        handlesEnabled: false,
        legsEnabled: false,
      },
    ];
    for (const overrides of combinations) {
      const plan = createFurniturePlan('stand.tv', createTvStandSpec(overrides));
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
      ...tvStandDefinition,
      limits: {
        ...tvStandDefinition.limits,
        maxPartVertices: 1,
        maxTotalVertices: 1,
      },
    });
    const result = tryCreatePlanFromDefinition(strict, DEFAULT_TV_STAND_SPEC);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain('geometry_budget_exceeded');
    }
  });

  it('is deterministic', () => {
    const first = createFurniturePlan('stand.tv', DEFAULT_TV_STAND_SPEC);
    const second = createFurniturePlan('stand.tv', { ...DEFAULT_TV_STAND_SPEC });
    expect(second.parts).toEqual(first.parts);
    expect(second.connections).toEqual(first.connections);
  });

  it('builds mesh groups and material slots', () => {
    const plan = createFurniturePlan('stand.tv', DEFAULT_TV_STAND_SPEC);
    const built = buildPlan(plan);
    try {
      expect(built.group.name).toBe('tv-stand-assembly');
      expect(built.materialSlots).toEqual(['structure', 'fronts', 'hardware']);
      expect(built.materialNames).toEqual([
        'tv-stand-structure-group-material',
        'tv-stand-fronts-group-material',
        'tv-stand-hardware-group-material',
      ]);
      const expected = slotCounts(plan);
      const actual = Object.fromEntries(
        built.group.children.map((child) => [child.name, child.children.length]),
      );
      expect(actual).toEqual({
        'tv-stand-structure-group': expected.structure,
        'tv-stand-fronts-group': expected.fronts,
        'tv-stand-hardware-group': expected.hardware,
      });
      expect(actual).toEqual({
        'tv-stand-structure-group': 12,
        'tv-stand-fronts-group': 4,
        'tv-stand-hardware-group': 12,
      });
    } finally {
      built.dispose();
    }
    expect(built.group.children).toHaveLength(0);
  });

  it('publishes manufacturing metadata only for box parts', () => {
    const plan = createFurniturePlan('stand.tv', DEFAULT_TV_STAND_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));
    expect(byId.get('tv-stand-shelf')?.manufacturing).toEqual({
      boxCm: [156, 2, 39.4],
      cutFromSheet: true,
    });
    expect(byId.get('tv-stand-door-left')?.manufacturing?.boxCm).toEqual([
      77.85, 27.4, 2,
    ]);
    expect(byId.get('tv-stand-drawer-front-1')?.manufacturing).toEqual({
      boxCm: [77.85, 15, 2],
      cutFromSheet: true,
    });
    expect(byId.get('tv-stand-leg-front-left')?.manufacturing).toEqual({
      boxCm: [5, 10, 5],
      cutFromSheet: false,
    });
    expect(byId.get('tv-stand-drawer-body-1')?.manufacturing).toBeUndefined();
    expect(byId.get('tv-stand-hinge-left-1')?.manufacturing).toBeUndefined();
    expect(byId.get('tv-stand-door-handle-left')?.manufacturing).toBeUndefined();
    expect(
      plan.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(14);

    const legsOff = createFurniturePlan(
      'stand.tv',
      createTvStandSpec({ legsEnabled: false }),
    );
    expect(
      legsOff.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(10);
  });

  it('exports readable GLB bytes', async () => {
    const plan = createFurniturePlan('stand.tv', DEFAULT_TV_STAND_SPEC);
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
    expect(createFurniturePlan('bed.standard', DEFAULT_BED_STANDARD_SPEC).parts).toHaveLength(35);
    expect(createFurniturePlan('kitchen.baseCabinet', DEFAULT_KITCHEN_BASE_CABINET_SPEC).parts).toHaveLength(16);
  });
});
