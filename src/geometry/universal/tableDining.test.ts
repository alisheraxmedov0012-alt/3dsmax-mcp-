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
  DEFAULT_DINING_TABLE_SPEC,
  createDiningTableSpec,
  diningTableDefinition,
} from './definitions/tableDining';
import { DEFAULT_GAMING_DESK_SPEC } from './definitions/deskGaming';

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

describe('table.dining definition', () => {
  it('is registered with the expected metadata', () => {
    const definition = furnitureDefinitions.require('table.dining');
    expect(definition.family).toBe('table');
    expect(definition.label).toBe('Ovqat stoli');
    expect(new Set(definition.fields.map((field) => field.key))).toEqual(
      new Set(Object.keys(DEFAULT_DINING_TABLE_SPEC)),
    );
  });

  it('parses the default spec', () => {
    const plan = createFurniturePlan('table.dining', DEFAULT_DINING_TABLE_SPEC);
    expect(plan.parts).toHaveLength(14);
    expect(plan.connections).toHaveLength(10);
    expect(slotCounts(plan)).toEqual({ surface: 1, structure: 7, hardware: 6 });
    expect(new Set(plan.parts.map((part) => part.materialSlot))).toEqual(
      new Set(['surface', 'structure', 'hardware']),
    );
  });

  it('rejects invalid dimensions and relationships', () => {
    const invalidSpecs = [
      { width: 0 },
      { depth: 0 },
      { height: 10 },
      { legInset: 80 },
      { frameThickness: 40 },
      { frameInset: 90 },
      { cornerRadius: 1.5 },
      { supportEnabled: 'yes' },
    ];
    for (const overrides of invalidSpecs) {
      const result = tryCreateFurniturePlan('table.dining', {
        ...DEFAULT_DINING_TABLE_SPEC,
        ...overrides,
      });
      expect(result.ok).toBe(false);
    }
  });

  it('rejects unknown channels', () => {
    const result = tryCreateFurniturePlan('table.dining', {
      ...DEFAULT_DINING_TABLE_SPEC,
      drawerEnabled: true,
    });
    expect(result.ok).toBe(false);
  });

  it('removes supports and their connections when disabled', () => {
    const plan = createFurniturePlan(
      'table.dining',
      createDiningTableSpec({ supportEnabled: false }),
    );
    expect(plan.parts).toHaveLength(10);
    expect(plan.connections).toHaveLength(8);
    expect(plan.parts.some((part) => part.id.includes('support'))).toBe(false);
    expect(plan.parts.some((part) => part.id.includes('screw'))).toBe(false);
    expect(plan.connections.some((connection) => connection.id.includes('support'))).toBe(false);
    expect(slotCounts(plan)).toEqual({ surface: 1, structure: 5, hardware: 4 });
  });

  it('keeps part ids unique and connection references valid', () => {
    for (const supportEnabled of [true, false]) {
      const plan = createFurniturePlan(
        'table.dining',
        createDiningTableSpec({ supportEnabled }),
      );
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
      ...diningTableDefinition,
      limits: {
        ...diningTableDefinition.limits,
        maxPartVertices: 1,
        maxTotalVertices: 1,
      },
    });
    const result = tryCreatePlanFromDefinition(strict, DEFAULT_DINING_TABLE_SPEC);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain('geometry_budget_exceeded');
    }
  });

  it('is deterministic', () => {
    const first = createFurniturePlan('table.dining', DEFAULT_DINING_TABLE_SPEC);
    const second = createFurniturePlan('table.dining', { ...DEFAULT_DINING_TABLE_SPEC });
    expect(second.parts).toEqual(first.parts);
    expect(second.connections).toEqual(first.connections);
  });

  it('builds mesh groups and material slots', () => {
    const plan = createFurniturePlan('table.dining', DEFAULT_DINING_TABLE_SPEC);
    const built = buildPlan(plan);
    try {
      expect(built.group.name).toBe('dining-table-assembly');
      expect(built.materialSlots).toEqual(['surface', 'structure', 'hardware']);
      expect(built.materialNames).toEqual([
        'dining-table-surface-group-material',
        'dining-table-structure-group-material',
        'dining-table-hardware-group-material',
      ]);
      const expected = slotCounts(plan);
      const actual = Object.fromEntries(
        built.group.children.map((child) => [child.name, child.children.length]),
      );
      expect(actual).toEqual({
        'dining-table-surface-group': expected.surface,
        'dining-table-structure-group': expected.structure,
        'dining-table-hardware-group': expected.hardware,
      });
      expect(actual).toEqual({
        'dining-table-surface-group': 1,
        'dining-table-structure-group': 7,
        'dining-table-hardware-group': 6,
      });

      built.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(built.group);
      expect(box.min.x).toBeCloseTo(-80, 6);
      expect(box.max.x).toBeCloseTo(80, 6);
      expect(box.min.z).toBeCloseTo(-45, 6);
      expect(box.max.z).toBeCloseTo(45, 6);
      expect(box.max.y).toBeCloseTo(75, 6);
    } finally {
      built.dispose();
    }
    expect(built.group.children).toHaveLength(0);
  });

  it('publishes manufacturing metadata only for rectangular boxes', () => {
    const plan = createFurniturePlan('table.dining', DEFAULT_DINING_TABLE_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));
    expect(byId.get('dining-table-leg-nw')?.manufacturing).toEqual({
      boxCm: [7, 72, 7],
      cutFromSheet: false,
    });
    expect(byId.get('dining-table-support-front')?.manufacturing).toEqual({
      boxCm: [130, 2, 3],
      cutFromSheet: false,
    });
    expect(byId.get('dining-table-tabletop')?.manufacturing).toBeUndefined();
    expect(byId.get('dining-table-frame')?.manufacturing).toBeUndefined();
    expect(
      plan.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(6);

    const withoutSupports = createFurniturePlan(
      'table.dining',
      createDiningTableSpec({ supportEnabled: false }),
    );
    expect(
      withoutSupports.parts.filter((part) => part.manufacturing !== undefined),
    ).toHaveLength(4);
  });

  it('exports readable GLB bytes', async () => {
    const plan = createFurniturePlan('table.dining', DEFAULT_DINING_TABLE_SPEC);
    const built = buildPlan(plan);
    try {
      const glb = await exportGroupToGlb(built.group);
      expect(glb.byteLength).toBeGreaterThan(0);
      const summary = summarizeGlb(glb);
      expect(summary.ok).toBe(true);
      if (summary.ok) {
        expect(summary.summary.meshes).toBeGreaterThanOrEqual(14);
        expect(summary.summary.materials).toHaveLength(3);
      }
    } finally {
      built.dispose();
    }
  });

  it('keeps desk.computer and desk.gaming regression intact', () => {
    const computer = createFurniturePlan('desk.computer', DEFAULT_DESK_SPEC);
    expect(computer.parts).toHaveLength(16);
    expect(computer.connections).toHaveLength(12);

    const gaming = createFurniturePlan('desk.gaming', DEFAULT_GAMING_DESK_SPEC);
    expect(gaming.parts).toHaveLength(21);
    expect(gaming.connections).toHaveLength(16);
  });
});
