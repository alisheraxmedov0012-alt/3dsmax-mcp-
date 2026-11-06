import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { summarizeGlb } from '../../export/glbSummary';
import { exportGroupToGlb } from '../../export/sceneExport';
import { DEFAULT_DESK_SPEC } from '../furniture/desk';
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
  DEFAULT_WRITING_DESK_SPEC,
  createWritingDeskSpec,
  writingDeskDefinition,
} from './definitions/deskWriting';
import { DEFAULT_GAMING_DESK_SPEC } from './definitions/deskGaming';
import { DEFAULT_DINING_TABLE_SPEC } from './definitions/tableDining';

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

describe('desk.writing definition', () => {
  it('is registered with the expected metadata', () => {
    const definition = furnitureDefinitions.require('desk.writing');
    expect(definition.family).toBe('table');
    expect(definition.label).toBe('Yozuv stoli');
    expect(new Set(definition.fields.map((field) => field.key))).toEqual(
      new Set(Object.keys(DEFAULT_WRITING_DESK_SPEC)),
    );
  });

  it('parses the default spec', () => {
    const plan = createFurniturePlan('desk.writing', DEFAULT_WRITING_DESK_SPEC);
    expect(plan.parts).toHaveLength(17);
    expect(plan.connections).toHaveLength(13);
    expect(slotCounts(plan)).toEqual({ surface: 2, structure: 8, hardware: 7 });
    expect(new Set(plan.parts.map((part) => part.materialSlot))).toEqual(
      new Set(['surface', 'structure', 'hardware']),
    );
  });

  it('rejects invalid dimensions and relationships', () => {
    const invalidSpecs = [
      { width: 0 },
      { height: 10 },
      { legInset: 70 },
      { frameThickness: 30 },
      { drawerWidth: 126 },
      { drawerDepth: 55 },
      { drawerHeight: 72 },
      { drawerFrontThickness: 0 },
      { drawerWidth: 20 },
      { drawerHeight: 8 },
      { cornerRadius: 1.5 },
      { drawerEnabled: 'yes' },
    ];
    for (const overrides of invalidSpecs) {
      const result = tryCreateFurniturePlan('desk.writing', {
        ...DEFAULT_WRITING_DESK_SPEC,
        ...overrides,
      });
      expect(result.ok).toBe(false);
    }
  });

  it('rejects unknown channels', () => {
    const result = tryCreateFurniturePlan('desk.writing', {
      ...DEFAULT_WRITING_DESK_SPEC,
      cableTrayEnabled: true,
    });
    expect(result.ok).toBe(false);
  });

  it('supports drawer and handle toggles', () => {
    const handleOff = createFurniturePlan(
      'desk.writing',
      createWritingDeskSpec({ handleEnabled: false }),
    );
    expect(handleOff.parts).toHaveLength(16);
    expect(handleOff.connections).toHaveLength(12);
    expect(handleOff.parts.some((part) => part.id === 'writing-desk-drawer-handle')).toBe(
      false,
    );
    expect(slotCounts(handleOff).hardware).toBe(6);

    const drawerOff = createFurniturePlan(
      'desk.writing',
      createWritingDeskSpec({ drawerEnabled: false }),
    );
    expect(drawerOff.parts).toHaveLength(14);
    expect(drawerOff.connections).toHaveLength(10);
    expect(drawerOff.parts.some((part) => part.id.includes('drawer'))).toBe(false);
    expect(drawerOff.connections.some((connection) => connection.id.includes('drawer'))).toBe(
      false,
    );
    expect(slotCounts(drawerOff)).toEqual({ surface: 1, structure: 7, hardware: 6 });
  });

  it('keeps part ids unique and connection references valid', () => {
    for (const overrides of [
      {},
      { handleEnabled: false },
      { drawerEnabled: false },
      { drawerEnabled: false, handleEnabled: false },
    ]) {
      const plan = createFurniturePlan('desk.writing', createWritingDeskSpec(overrides));
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

  it('places the drawer body, front and handle without overlap', () => {
    const plan = createFurniturePlan('desk.writing', DEFAULT_WRITING_DESK_SPEC);
    const body = plan.parts.find((part) => part.id === 'writing-desk-drawer-body');
    const front = plan.parts.find((part) => part.id === 'writing-desk-drawer-front');
    const handle = plan.parts.find((part) => part.id === 'writing-desk-drawer-handle');
    expect(body?.geometry.kind).toBe('custom');
    expect(body?.dimensions).toEqual({ width: 45, height: 12, depth: 40 });
    expect(body?.position).toEqual([0, 66, 0]);
    expect(front?.geometry.kind).toBe('box');
    expect(front?.dimensions).toEqual({ width: 45, height: 12, depth: 2 });
    expect(front?.position).toEqual([0, 66, 21]);
    expect(handle?.geometry.kind).toBe('tube');
    expect(handle?.position).toEqual([0, 66, 23.5]);
    expect(handle?.rotation).toEqual([90, 0, 0]);
  });

  it('enforces the geometry budget', () => {
    const strict = defineFurniture({
      ...writingDeskDefinition,
      limits: {
        ...writingDeskDefinition.limits,
        maxPartVertices: 1,
        maxTotalVertices: 1,
      },
    });
    const result = tryCreatePlanFromDefinition(strict, DEFAULT_WRITING_DESK_SPEC);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain('geometry_budget_exceeded');
    }
  });

  it('is deterministic', () => {
    const first = createFurniturePlan('desk.writing', DEFAULT_WRITING_DESK_SPEC);
    const second = createFurniturePlan('desk.writing', { ...DEFAULT_WRITING_DESK_SPEC });
    expect(second.parts).toEqual(first.parts);
    expect(second.connections).toEqual(first.connections);
  });

  it('builds mesh groups and material slots', () => {
    const plan = createFurniturePlan('desk.writing', DEFAULT_WRITING_DESK_SPEC);
    const built = buildPlan(plan);
    try {
      expect(built.group.name).toBe('writing-desk-assembly');
      expect(built.materialSlots).toEqual(['surface', 'structure', 'hardware']);
      expect(built.materialNames).toEqual([
        'writing-desk-surface-group-material',
        'writing-desk-structure-group-material',
        'writing-desk-hardware-group-material',
      ]);
      const expected = slotCounts(plan);
      const actual = Object.fromEntries(
        built.group.children.map((child) => [child.name, child.children.length]),
      );
      expect(actual).toEqual({
        'writing-desk-surface-group': expected.surface,
        'writing-desk-structure-group': expected.structure,
        'writing-desk-hardware-group': expected.hardware,
      });
      expect(actual).toEqual({
        'writing-desk-surface-group': 2,
        'writing-desk-structure-group': 8,
        'writing-desk-hardware-group': 7,
      });

      built.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(built.group);
      expect(box.min.x).toBeCloseTo(-70, 6);
      expect(box.max.x).toBeCloseTo(70, 6);
      expect(box.min.z).toBeCloseTo(-35, 6);
      expect(box.max.z).toBeCloseTo(35, 6);
      expect(box.max.y).toBeCloseTo(75, 6);
    } finally {
      built.dispose();
    }
    expect(built.group.children).toHaveLength(0);
  });

  it('publishes manufacturing metadata only for rectangular boxes', () => {
    const plan = createFurniturePlan('desk.writing', DEFAULT_WRITING_DESK_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));
    expect(byId.get('writing-desk-leg-nw')?.manufacturing).toEqual({
      boxCm: [5, 72, 5],
      cutFromSheet: false,
    });
    expect(byId.get('writing-desk-drawer-front')?.manufacturing).toEqual({
      boxCm: [45, 12, 2],
      cutFromSheet: true,
    });
    expect(byId.get('writing-desk-drawer-body')?.manufacturing).toBeUndefined();
    expect(byId.get('writing-desk-drawer-handle')?.manufacturing).toBeUndefined();
    expect(byId.get('writing-desk-tabletop')?.manufacturing).toBeUndefined();
    expect(
      plan.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(7);

    const drawerOff = createFurniturePlan(
      'desk.writing',
      createWritingDeskSpec({ drawerEnabled: false }),
    );
    expect(
      drawerOff.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(6);
  });

  it('exports readable GLB bytes', async () => {
    const plan = createFurniturePlan('desk.writing', DEFAULT_WRITING_DESK_SPEC);
    const built = buildPlan(plan);
    try {
      const glb = await exportGroupToGlb(built.group);
      expect(glb.byteLength).toBeGreaterThan(0);
      const summary = summarizeGlb(glb);
      expect(summary.ok).toBe(true);
      if (summary.ok) {
        expect(summary.summary.meshes).toBeGreaterThanOrEqual(17);
        expect(summary.summary.materials).toHaveLength(3);
      }
    } finally {
      built.dispose();
    }
  });

  it('keeps the previous three definitions intact', () => {
    const computer = createFurniturePlan('desk.computer', DEFAULT_DESK_SPEC);
    expect(computer.parts).toHaveLength(24);
    expect(computer.connections).toHaveLength(16);

    const gaming = createFurniturePlan('desk.gaming', DEFAULT_GAMING_DESK_SPEC);
    expect(gaming.parts).toHaveLength(21);
    expect(gaming.connections).toHaveLength(16);

    const dining = createFurniturePlan('table.dining', DEFAULT_DINING_TABLE_SPEC);
    expect(dining.parts).toHaveLength(14);
    expect(dining.connections).toHaveLength(10);
  });
});
