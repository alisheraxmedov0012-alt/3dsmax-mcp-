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
  DEFAULT_GAMING_DESK_SPEC,
  createGamingDeskSpec,
  gamingDeskDefinition,
} from './definitions/deskGaming';

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

describe('desk.gaming definition', () => {
  it('is registered with the expected metadata', () => {
    const definition = furnitureDefinitions.require('desk.gaming');
    expect(definition.family).toBe('table');
    expect(definition.label).toBe('Gaming stoli');
    expect(new Set(definition.fields.map((field) => field.key))).toEqual(
      new Set(Object.keys(DEFAULT_GAMING_DESK_SPEC)),
    );
  });

  it('parses the default spec', () => {
    const plan = createFurniturePlan('desk.gaming', DEFAULT_GAMING_DESK_SPEC);
    expect(plan.parts).toHaveLength(21);
    expect(plan.connections).toHaveLength(16);
    expect(new Set(plan.parts.map((part) => part.materialSlot))).toEqual(
      new Set(['surface', 'structure', 'accent', 'hardware']),
    );
  });

  it('keeps part ids unique and connection references valid', () => {
    const plan = createFurniturePlan('desk.gaming', DEFAULT_GAMING_DESK_SPEC);
    const ids = new Set(plan.parts.map((part) => part.id));
    expect(ids.size).toBe(plan.parts.length);
    for (const connection of plan.connections) {
      expect(ids.has(connection.componentIds[0])).toBe(true);
      expect(ids.has(connection.componentIds[1])).toBe(true);
      if (connection.hardwareId !== undefined) {
        expect(ids.has(connection.hardwareId)).toBe(true);
      }
    }
  });

  it('supports disabling the monitor shelf', () => {
    const plan = createFurniturePlan(
      'desk.gaming',
      createGamingDeskSpec({ monitorShelfEnabled: false }),
    );
    expect(plan.parts).toHaveLength(16);
    expect(plan.connections).toHaveLength(12);
    expect(plan.parts.some((part) => part.id.includes('monitor'))).toBe(false);
    expect(slotCounts(plan)).toEqual({ surface: 1, structure: 7, accent: 1, hardware: 7 });
  });

  it('supports disabling the grommet', () => {
    const plan = createFurniturePlan(
      'desk.gaming',
      createGamingDeskSpec({ grommetEnabled: false }),
    );
    expect(plan.parts).toHaveLength(20);
    expect(plan.connections).toHaveLength(15);
    expect(plan.parts.some((part) => part.id === 'gaming-desk-grommet')).toBe(false);
    expect(slotCounts(plan).hardware).toBe(8);
  });

  it('supports disabling both optional groups', () => {
    const plan = createFurniturePlan(
      'desk.gaming',
      createGamingDeskSpec({ monitorShelfEnabled: false, grommetEnabled: false }),
    );
    expect(plan.parts).toHaveLength(15);
    expect(plan.connections).toHaveLength(11);
  });

  it('rejects invalid dimensions and relationships', () => {
    const invalidSpecs = [
      { width: 0 },
      { height: 9 },
      { monitorShelfWidth: 151 },
      { monitorShelfDepth: 5 },
      { monitorShelfHeight: 80 },
      { grommetDiameter: 70 },
      { monitorShelfEnabled: true, monitorShelfThickness: 0 },
    ];
    for (const overrides of invalidSpecs) {
      const result = tryCreateFurniturePlan('desk.gaming', {
        ...DEFAULT_GAMING_DESK_SPEC,
        ...overrides,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues[0]?.code).toBe('invalid_spec');
      }
    }
  });

  it('rejects unknown channels', () => {
    const result = tryCreateFurniturePlan('desk.gaming', {
      ...DEFAULT_GAMING_DESK_SPEC,
      rgbEnabled: true,
    });
    expect(result.ok).toBe(false);
  });

  it('is deterministic', () => {
    const first = createFurniturePlan('desk.gaming', DEFAULT_GAMING_DESK_SPEC);
    const second = createFurniturePlan('desk.gaming', { ...DEFAULT_GAMING_DESK_SPEC });
    expect(second.parts).toEqual(first.parts);
    expect(second.connections).toEqual(first.connections);
  });

  it('enforces the geometry budget', () => {
    const strict = defineFurniture({
      ...gamingDeskDefinition,
      limits: {
        ...gamingDeskDefinition.limits,
        maxPartVertices: 1,
        maxTotalVertices: 1,
      },
    });
    const result = tryCreatePlanFromDefinition(strict, DEFAULT_GAMING_DESK_SPEC);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain('geometry_budget_exceeded');
    }
  });

  it('builds mesh groups and material slots', () => {
    const plan = createFurniturePlan('desk.gaming', DEFAULT_GAMING_DESK_SPEC);
    const built = buildPlan(plan);
    try {
      expect(built.group.name).toBe('gaming-desk-assembly');
      expect(built.materialSlots).toEqual(['surface', 'structure', 'accent', 'hardware']);
      expect(built.materialNames).toEqual([
        'gaming-desk-surface-group-material',
        'gaming-desk-structure-group-material',
        'gaming-desk-accent-group-material',
        'gaming-desk-hardware-group-material',
      ]);
      const expected = slotCounts(plan);
      const actual = Object.fromEntries(
        built.group.children.map((child) => [child.name, child.children.length]),
      );
      expect(actual).toEqual({
        'gaming-desk-surface-group': expected.surface,
        'gaming-desk-structure-group': expected.structure,
        'gaming-desk-accent-group': expected.accent,
        'gaming-desk-hardware-group': expected.hardware,
      });
      expect(actual).toEqual({
        'gaming-desk-surface-group': 2,
        'gaming-desk-structure-group': 9,
        'gaming-desk-accent-group': 1,
        'gaming-desk-hardware-group': 9,
      });

      built.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(built.group);
      expect(box.min.x).toBeCloseTo(-80, 6);
      expect(box.max.x).toBeCloseTo(80, 6);
      expect(box.min.z).toBeCloseTo(-37.5, 6);
      expect(box.max.z).toBeCloseTo(37.5, 6);
      expect(box.max.y).toBeCloseTo(96, 6);
    } finally {
      built.dispose();
    }
    expect(built.group.children).toHaveLength(0);
  });

  it('exports readable GLB bytes', async () => {
    const plan = createFurniturePlan('desk.gaming', DEFAULT_GAMING_DESK_SPEC);
    const built = buildPlan(plan);
    try {
      const glb = await exportGroupToGlb(built.group);
      expect(glb.byteLength).toBeGreaterThan(0);
      const summary = summarizeGlb(glb);
      expect(summary.ok).toBe(true);
      if (summary.ok) {
        expect(summary.summary.meshes).toBeGreaterThanOrEqual(21);
        expect(summary.summary.materials).toHaveLength(4);
      }
    } finally {
      built.dispose();
    }
  });

  it('publishes manufacturing metadata only for rectangular boxes', () => {
    const plan = createFurniturePlan('desk.gaming', DEFAULT_GAMING_DESK_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));
    expect(byId.get('gaming-desk-accent-rail')?.manufacturing).toEqual({
      boxCm: [152, 2.5, 1.5],
      cutFromSheet: false,
    });
    expect(byId.get('gaming-desk-monitor-shelf')?.manufacturing).toEqual({
      boxCm: [100, 3, 22],
      cutFromSheet: true,
    });
    expect(byId.get('gaming-desk-monitor-upright-left')?.manufacturing).toEqual({
      boxCm: [4, 18, 6],
      cutFromSheet: false,
    });
    expect(byId.get('gaming-desk-tabletop')?.manufacturing).toBeUndefined();
    expect(byId.get('gaming-desk-tabletop')?.notes?.length).toBeGreaterThan(0);
    expect(byId.get('gaming-desk-grommet')?.manufacturing).toBeUndefined();

    const withManufacturing = plan.parts.filter((part) => part.manufacturing !== undefined);
    expect(withManufacturing).toHaveLength(10);
  });

  it('does not change desk.computer parity', () => {
    const plan = createFurniturePlan('desk.computer', DEFAULT_DESK_SPEC);
    expect(plan.parts).toHaveLength(16);
    expect(plan.connections).toHaveLength(12);
    expect(new Set(plan.parts.map((part) => part.materialSlot))).toEqual(
      new Set(['tabletop', 'structure', 'drawer', 'hardware']),
    );
  });
});
