import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildPlan,
  createFurniturePlan,
  furnitureDefinitions,
  validatePlanDraft,
} from './index';

const EXPECTED_DEFINITIONS = [
  'bed.standard',
  'cabinet.standard',
  'chair.armchair',
  'chair.dining',
  'chair.ergonomic',
  'chair.office',
  'desk.computer',
  'desk.gaming',
  'desk.writing',
  'kitchen.baseCabinet',
  'sofa.standard',
  'stand.tv',
  'table.dining',
].sort();

const SUPPORTED_RECIPES = new Set([
  'box',
  'roundedBox',
  'cylinder',
  'sphere',
  'capsule',
  'extrude',
  'lathe',
  'tube',
  'custom',
]);

const EXPECTED_MANUFACTURING: Record<string, { total: number; cutFromSheet: number }> = {
  'bed.standard': { total: 26, cutFromSheet: 19 },
  'cabinet.standard': { total: 14, cutFromSheet: 10 },
  'chair.armchair': { total: 8, cutFromSheet: 0 },
  'chair.dining': { total: 8, cutFromSheet: 0 },
  'chair.ergonomic': { total: 15, cutFromSheet: 0 },
  'chair.office': { total: 12, cutFromSheet: 0 },
  'desk.computer': { total: 0, cutFromSheet: 0 },
  'desk.gaming': { total: 10, cutFromSheet: 1 },
  'desk.writing': { total: 7, cutFromSheet: 1 },
  'kitchen.baseCabinet': { total: 10, cutFromSheet: 10 },
  'sofa.standard': { total: 13, cutFromSheet: 0 },
  'stand.tv': { total: 14, cutFromSheet: 10 },
  'table.dining': { total: 6, cutFromSheet: 0 },
};

describe('phase 2 definition registry', () => {
  it('contains exactly the thirteen phase 2 definitions', () => {
    expect(
      furnitureDefinitions
        .list()
        .map((definition) => definition.id)
        .sort(),
    ).toEqual(EXPECTED_DEFINITIONS);
  });

  it('keeps manufacturing metadata scoped to real box parts', () => {
    for (const [definitionId, expected] of Object.entries(EXPECTED_MANUFACTURING)) {
      const plan = createFurniturePlan(definitionId, furnitureDefinitions.require(definitionId).defaults);
      const withMetadata = plan.parts.filter((part) => part.manufacturing !== undefined);
      const cutFromSheet = withMetadata.filter((part) => part.manufacturing?.cutFromSheet);
      expect(withMetadata).toHaveLength(expected.total);
      expect(cutFromSheet).toHaveLength(expected.cutFromSheet);
      for (const part of withMetadata) {
        expect(part.geometry.kind).toBe('box');
        const box = part.manufacturing?.boxCm;
        expect(box).toBeDefined();
        if (box) {
          expect(box.every((value) => Number.isFinite(value) && value > 0)).toBe(true);
        }
      }
    }
  });
});

describe.each(EXPECTED_DEFINITIONS)('%s integration', (definitionId) => {
  it('parses, validates, builds deterministically and exposes safe metadata', () => {
    const definition = furnitureDefinitions.require(definitionId);

    const parsed = definition.parseSpec(definition.defaults);
    expect(parsed.ok).toBe(true);

    const plan = createFurniturePlan(definitionId, definition.defaults);
    expect(plan.definitionId).toBe(definitionId);

    const validation = validatePlanDraft(
      { parts: plan.parts, connections: plan.connections, warnings: plan.warnings },
      definition,
    );
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);

    const partIds = plan.parts.map((part) => part.id);
    expect(new Set(partIds).size).toBe(partIds.length);

    for (const connection of plan.connections) {
      expect(partIds).toContain(connection.componentIds[0]);
      expect(partIds).toContain(connection.componentIds[1]);
      if (connection.hardwareId !== undefined) {
        expect(partIds).toContain(connection.hardwareId);
      }
    }

    const slotIds = new Set(definition.slots.map((slot) => slot.id));
    for (const part of plan.parts) {
      expect(slotIds.has(part.materialSlot)).toBe(true);
      expect(SUPPORTED_RECIPES.has(part.geometry.kind)).toBe(true);
      for (const value of [...part.position, ...part.rotation]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      if (part.manufacturing) {
        expect(part.geometry.kind).toBe('box');
        const box = part.manufacturing.boxCm;
        if (box && part.geometry.kind === 'box') {
          expect(box[0]).toBeCloseTo(part.geometry.width, 9);
          expect(box[1]).toBeCloseTo(part.geometry.height, 9);
          expect(box[2]).toBeCloseTo(part.geometry.depth, 9);
        }
      }
    }

    const rebuilt = createFurniturePlan(definitionId, definition.defaults);
    expect(rebuilt.parts).toEqual(plan.parts);
    expect(rebuilt.connections).toEqual(plan.connections);

    const built = buildPlan(plan);
    try {
      let meshes = 0;
      built.group.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) {
          meshes += 1;
        }
      });
      expect(meshes).toBeGreaterThan(0);
      expect(meshes).toBe(plan.parts.length);

      built.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(built.group);
      expect(box.isEmpty()).toBe(false);
      for (const value of [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(box.min.y).toBeCloseTo(0, 6);
    } finally {
      built.dispose();
    }
  });
});
