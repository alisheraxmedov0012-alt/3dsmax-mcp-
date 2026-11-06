import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { summarizeGlb } from '../../export/glbSummary';
import { exportGroupToGlb } from '../../export/sceneExport';
import {
  DEFAULT_DESK_SPEC,
  buildDesk,
  createDeskSpec,
  solveDesk,
} from '../furniture/desk';
import {
  buildPlan,
  createFurniturePlan,
  furnitureDefinitions,
  type FurniturePlan,
} from './index';

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

/** FNV-1a over the bytes: a dependency-free digest for the parity report. */
function digest(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function firstByteDifference(left: ArrayBuffer, right: ArrayBuffer): number {
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) {
      return index;
    }
  }
  return a.length === b.length ? -1 : length;
}

function boundingBox(group: THREE.Object3D): {
  min: [number, number, number];
  max: [number, number, number];
} {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  };
}

function meshMaterials(group: THREE.Object3D): Record<string, string> {
  const entries: Record<string, string> = {};
  group.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    entries[mesh.name] = materials
      .map((material) => {
        const color =
          material instanceof THREE.MeshStandardMaterial
            ? `#${material.color.getHexString()}`
            : 'unknown';
        return `${material.name}:${color}`;
      })
      .join('|');
  });
  return entries;
}

function slotPartIds(plan: FurniturePlan): Record<string, string[]> {
  const bySlot: Record<string, string[]> = {};
  for (const part of plan.parts) {
    const ids = bySlot[part.materialSlot] ?? [];
    ids.push(part.id);
    bySlot[part.materialSlot] = ids;
  }
  return bySlot;
}

describe('desk.computer parity with Premium Desk Builder', () => {
  it('matches the DeskAssemblyPlan component for component', () => {
    const plan = createFurniturePlan('desk.computer', DEFAULT_DESK_SPEC);
    const legacy = solveDesk(DEFAULT_DESK_SPEC);

    expect(plan.parts).toHaveLength(24);
    expect(legacy.components).toHaveLength(24);
    expect(plan.connections).toHaveLength(16);
    expect(legacy.connections).toHaveLength(16);

    plan.parts.forEach((part, index) => {
      const component = legacy.components[index];
      expect(part.id).toBe(component.id);
      expect(part.type).toBe(component.type);
      expect(part.role).toBe(component.role);
      expect(part.dimensions).toEqual(component.dimensions);
      expect(part.geometry).toEqual(component.geometry);
      expect(part.position).toEqual(component.position);
      expect(part.rotation).toEqual(component.rotation);
    });

    expect(plan.connections).toEqual(legacy.connections);
    expect(new Set(plan.parts.map((part) => part.materialSlot))).toEqual(
      new Set(['tabletop', 'structure', 'drawer', 'hardware']),
    );
    expect(slotPartIds(plan)).toEqual({
      tabletop: ['desk-tabletop'],
      structure: [
        'desk-leg-nw',
        'desk-leg-ne',
        'desk-leg-sw',
        'desk-leg-se',
        'desk-leg-plate-nw',
        'desk-leg-plate-ne',
        'desk-leg-plate-sw',
        'desk-leg-plate-se',
        'desk-frame',
        'desk-support-front',
        'desk-support-back',
      ],
      hardware: [
        'desk-bolt-1',
        'desk-bolt-2',
        'desk-bolt-3',
        'desk-bolt-4',
        'desk-screw-1',
        'desk-screw-2',
        'desk-drawer-handle',
        'desk-drawer-runner-left',
        'desk-drawer-runner-right',
        'desk-grommet',
      ],
      drawer: ['desk-drawer', 'desk-drawer-front'],
    });
  });

  it('builds the same geometry, materials and world bounds', () => {
    const plan = createFurniturePlan('desk.computer', DEFAULT_DESK_SPEC);
    const universal = buildPlan(plan);
    const legacy = buildDesk(DEFAULT_DESK_SPEC);
    try {
      expect(universal.materialSlots).toEqual(legacy.materialSlots);
      expect(universal.materialNames).toEqual(legacy.materialNames);
      expect(meshMaterials(universal.group)).toEqual(meshMaterials(legacy.group));

      const universalBounds = boundingBox(universal.group);
      const legacyBounds = boundingBox(legacy.group);
      for (let axis = 0; axis < 3; axis += 1) {
        expect(universalBounds.min[axis]).toBeCloseTo(legacyBounds.min[axis], 6);
        expect(universalBounds.max[axis]).toBeCloseTo(legacyBounds.max[axis], 6);
      }
    } finally {
      universal.dispose();
      legacy.dispose();
    }
  });

  it('exports an identical GLB', async () => {
    const plan = createFurniturePlan('desk.computer', DEFAULT_DESK_SPEC);
    const universal = buildPlan(plan);
    const legacy = buildDesk(DEFAULT_DESK_SPEC);
    try {
      const universalGlb = await exportGroupToGlb(universal.group);
      const legacyGlb = await exportGroupToGlb(legacy.group);

      expect(universalGlb.byteLength).toBe(legacyGlb.byteLength);
      expect(firstByteDifference(universalGlb, legacyGlb)).toBe(-1);
      expect(digest(universalGlb)).toBe(digest(legacyGlb));

      const universalSummary = summarizeGlb(universalGlb);
      const legacySummary = summarizeGlb(legacyGlb);
      expect(universalSummary.ok).toBe(true);
      expect(legacySummary.ok).toBe(true);
      if (universalSummary.ok && legacySummary.ok) {
        expect(universalSummary.summary).toEqual(legacySummary.summary);
      }
    } finally {
      universal.dispose();
      legacy.dispose();
    }
  });

  it('publishes definition metadata that covers the DeskSpec exactly', () => {
    const definition = furnitureDefinitions.require('desk.computer');
    expect(definition.family).toBe('table');
    expect(definition.defaults).toEqual(DEFAULT_DESK_SPEC);
    expect(new Set(definition.fields.map((field) => field.key))).toEqual(
      new Set(Object.keys(DEFAULT_DESK_SPEC)),
    );
    expect(definition.slots.map((slot) => slot.id)).toEqual([
      'tabletop',
      'structure',
      'drawer',
      'hardware',
    ]);
  });

  it('does not claim rectangular cut metadata for beveled or extruded parts', () => {
    const plan = createFurniturePlan('desk.computer', DEFAULT_DESK_SPEC);
    const byId = new Map(plan.parts.map((part) => [part.id, part]));

    // The v2 geometry is beveled/extruded, so an exact axis-aligned boxCm would
    // be false. The plan states that gap instead of inventing cut dimensions.
    for (const id of [
      'desk-leg-nw',
      'desk-support-front',
      'desk-tabletop',
      'desk-frame',
      'desk-drawer',
      'desk-grommet',
    ]) {
      expect(byId.get(id)?.manufacturing, id).toBeUndefined();
      expect(byId.get(id)?.notes, id).toEqual([
        'manufacturing: boxCm mavjud emas (geometry to‘rtburchak box emas).',
      ]);
    }
    expect(plan.parts.every((part) => part.manufacturing === undefined)).toBe(true);
  });

  it('keeps the tabletop an extruded plate even with a zero corner radius', () => {
    const spec = createDeskSpec({ cornerRadius: 0 });
    const plan = createFurniturePlan('desk.computer', spec);
    const tabletop = plan.parts.find((part) => part.id === 'desk-tabletop');
    expect(tabletop?.geometry.kind).toBe('extrude');
    expect(tabletop?.manufacturing).toBeUndefined();
  });
});
