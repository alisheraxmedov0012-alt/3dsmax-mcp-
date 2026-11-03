import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateGeometry } from '../../kernel';
import { exportGroupToGlb } from '../../../export/sceneExport';
import { summarizeGlb } from '../../../export/glbSummary';
import {
  DeskSpecError,
  buildDesk,
  createDefaultDesk,
  createDeskSpec,
  type BuiltDesk,
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

function findMesh(desk: BuiltDesk, name: string): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  desk.group.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh && mesh.name === name) {
      found = mesh;
    }
  });
  if (!found) {
    throw new Error(`Missing mesh ${name}`);
  }
  return found;
}

function box(desk: BuiltDesk, name: string): THREE.Box3 {
  return new THREE.Box3().setFromObject(findMesh(desk, name));
}

function size(value: THREE.Box3): [number, number, number] {
  const result = value.getSize(new THREE.Vector3());
  return [result.x, result.y, result.z];
}

function expectSize(value: THREE.Box3, expected: readonly [number, number, number], label = ''): void {
  const actual = size(value);
  actual.forEach((item, index) => expect(item, `${label}[${index}]`).toBeCloseTo(expected[index], 6));
}

function expectPoint(value: THREE.Vector3, expected: readonly [number, number, number], label = ''): void {
  expect(value.x, `${label}.x`).toBeCloseTo(expected[0], 6);
  expect(value.y, `${label}.y`).toBeCloseTo(expected[1], 6);
  expect(value.z, `${label}.z`).toBeCloseTo(expected[2], 6);
}

function expectNoOverlap(left: THREE.Box3, right: THREE.Box3): void {
  expect(overlapVolume(left, right)).toBeLessThan(1e-6);
}

function overlapVolume(left: THREE.Box3, right: THREE.Box3): number {
  const x = Math.max(0, Math.min(left.max.x, right.max.x) - Math.max(left.min.x, right.min.x));
  const y = Math.max(0, Math.min(left.max.y, right.max.y) - Math.max(left.min.y, right.min.y));
  const z = Math.max(0, Math.min(left.max.z, right.max.z) - Math.max(left.min.z, right.min.z));
  return x * y * z;
}

function meshNames(desk: BuiltDesk): string[] {
  const names: string[] = [];
  desk.group.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) {
      names.push(node.name);
    }
  });
  return names.sort();
}

describe('DeskBuilder — default geometry', () => {
  it('creates sixteen meshes in four material-slot groups', () => {
    const desk = createDefaultDesk();
    expect(meshNames(desk)).toHaveLength(16);
    expect(desk.group.children.map((child) => child.name)).toEqual([
      'desk-tabletop-group',
      'desk-structure-group',
      'desk-drawer-group',
      'desk-hardware-group',
    ]);
    expect(desk.materialSlots).toEqual(['tabletop', 'structure', 'drawer', 'hardware']);
    expect(new Set(desk.materialNames).size).toBe(4);
    desk.dispose();
  });

  it('places the tabletop, legs and overall envelope correctly', () => {
    const desk = createDefaultDesk();
    const tabletop = box(desk, 'desk-tabletop');
    expectSize(tabletop, [160, 3, 80]);
    expectPoint(tabletop.min, [-80, 72, -40]);
    expectPoint(tabletop.max, [80, 75, 40]);

    const all = new THREE.Box3().setFromObject(desk.group);
    expectPoint(all.min, [-80, 0, -40]);
    expectPoint(all.max, [80, 75, 40]);

    for (const name of ['desk-leg-nw', 'desk-leg-ne', 'desk-leg-sw', 'desk-leg-se']) {
      const leg = box(desk, name);
      expectSize(leg, [5, 72, 5], name);
      expect(leg.min.y, name).toBeCloseTo(0, 6);
      expect(leg.max.y, name).toBeCloseTo(72, 6);
    }
    desk.dispose();
  });

  it('proves the rotated frame sits exactly below the tabletop', () => {
    const desk = createDefaultDesk();
    const frame = box(desk, 'desk-frame');
    expectSize(frame, [150, 6, 70]);
    expectPoint(frame.min, [-75, 66, -35]);
    expectPoint(frame.max, [75, 72, 35]);
    expect(findMesh(desk, 'desk-frame').rotation.toArray().slice(0, 3)).toEqual([
      Math.PI / 2,
      0,
      0,
    ]);
    desk.dispose();
  });

  it('places supports, drawer and grommet in their intended zones', () => {
    const desk = createDefaultDesk();
    for (const name of ['desk-support-front', 'desk-support-back']) {
      const support = box(desk, name);
      expectSize(support, [134, 2, 3], name);
      expect(support.max.y, name).toBeCloseTo(72, 6);
    }
    const drawer = box(desk, 'desk-drawer');
    expectSize(drawer, [45, 20, 50]);
    expectPoint(drawer.min, [27, 52, -25]);
    expectPoint(drawer.max, [72, 72, 25]);

    const grommet = box(desk, 'desk-grommet');
    expectSize(grommet, [8, 3, 8]);
    expect(grommet.min.y).toBeCloseTo(72, 6);
    expect(grommet.max.y).toBeCloseTo(75, 6);
    expect(grommet.min.z).toBeGreaterThanOrEqual(-40);
    expect(grommet.max.z).toBeLessThanOrEqual(40);
    desk.dispose();
  });

  it('separates intentional joints from unexpected collisions', () => {
    const desk = createDefaultDesk();
    expectNoOverlap(box(desk, 'desk-tabletop'), box(desk, 'desk-leg-nw'));
    expectNoOverlap(box(desk, 'desk-tabletop'), box(desk, 'desk-frame'));
    const frontSupport = box(desk, 'desk-support-front');
    const backSupport = box(desk, 'desk-support-back');
    expect(frontSupport.min.z).toBeCloseTo(-32, 6);
    expect(backSupport.max.z).toBeCloseTo(32, 6);
    const drawerBox = box(desk, 'desk-drawer');
    expect(drawerBox.max.x).toBeCloseTo(72, 6);
    expect(drawerBox.max.y).toBeCloseTo(72, 6);
    expect(drawerBox.min.z).toBeGreaterThanOrEqual(-32);
    expect(drawerBox.max.z).toBeLessThanOrEqual(32);
    expectNoOverlap(box(desk, 'desk-tabletop'), drawerBox);
    expectNoOverlap(box(desk, 'desk-support-front'), box(desk, 'desk-leg-nw'));

    // Leg/frame corner and grommet/tabletop overlaps are deliberate.
    expect(overlapVolume(box(desk, 'desk-frame'), box(desk, 'desk-leg-nw'))).toBeGreaterThan(0);
    expect(overlapVolume(box(desk, 'desk-grommet'), box(desk, 'desk-tabletop'))).toBeGreaterThan(0);
    desk.dispose();
  });

  it('binds each mesh to a real material slot', () => {
    const desk = createDefaultDesk();
    const expected: Record<string, string> = {
      'desk-tabletop': 'desk-tabletop-group-material',
      'desk-leg-nw': 'desk-structure-group-material',
      'desk-frame': 'desk-structure-group-material',
      'desk-support-front': 'desk-structure-group-material',
      'desk-drawer': 'desk-drawer-group-material',
      'desk-grommet': 'desk-hardware-group-material',
      'desk-bolt-1': 'desk-hardware-group-material',
      'desk-screw-1': 'desk-hardware-group-material',
    };
    for (const [name, material] of Object.entries(expected)) {
      const mesh = findMesh(desk, name);
      expect((mesh.material as THREE.Material).name, name).toBe(material);
    }
    desk.dispose();
  });

  it('has finite transforms and valid geometry on every mesh', () => {
    const desk = createDefaultDesk();
    desk.group.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      expect(mesh.position.toArray().every(Number.isFinite), mesh.name).toBe(true);
      expect(mesh.rotation.toArray().slice(0, 3).every(Number.isFinite), mesh.name).toBe(true);
      const validation = validateGeometry(mesh.geometry as THREE.BufferGeometry);
      expect(validation.errors, `${mesh.name}: ${validation.errors.join(' ')}`).toEqual([]);
    });
    desk.dispose();
  });
});

describe('DeskBuilder — parametric changes', () => {
  it('extends tabletop, frame and legs when width grows', () => {
    const desk = buildDesk(createDeskSpec({ width: 200 }));
    expectSize(box(desk, 'desk-tabletop'), [200, 3, 80]);
    expectSize(box(desk, 'desk-frame'), [190, 6, 70]);
    expect(box(desk, 'desk-leg-nw').min.x).toBeCloseTo(-95, 6);
    desk.dispose();
  });

  it('deepens tabletop, frame and leg positions when depth grows', () => {
    const desk = buildDesk(createDeskSpec({ depth: 100 }));
    expectSize(box(desk, 'desk-tabletop'), [160, 3, 100]);
    expectSize(box(desk, 'desk-frame'), [150, 6, 90]);
    expect(box(desk, 'desk-leg-nw').min.z).toBeCloseTo(-45, 6);
    desk.dispose();
  });

  it('recomputes leg height and vertical positions when height grows', () => {
    const desk = buildDesk(createDeskSpec({ height: 90 }));
    expectSize(box(desk, 'desk-leg-nw'), [5, 87, 5]);
    expect(box(desk, 'desk-tabletop').min.y).toBeCloseTo(87, 6);
    expect(box(desk, 'desk-tabletop').max.y).toBeCloseTo(90, 6);
    expect(box(desk, 'desk-frame').max.y).toBeCloseTo(87, 6);
    expect(box(desk, 'desk-frame').min.y).toBeCloseTo(81, 6);
    desk.dispose();
  });

  it('omits drawer geometry and slot when disabled', () => {
    const desk = buildDesk(createDeskSpec({ drawerEnabled: false }));
    expect(meshNames(desk)).toHaveLength(15);
    expect(meshNames(desk)).not.toContain('desk-drawer');
    expect(desk.materialSlots).not.toContain('drawer');
    desk.dispose();
  });

  it('omits grommet geometry when disabled', () => {
    const desk = buildDesk(createDeskSpec({ grommetEnabled: false }));
    expect(meshNames(desk)).toHaveLength(15);
    expect(meshNames(desk)).not.toContain('desk-grommet');
    desk.dispose();
  });

  it('creates four bolts and two screws', () => {
    const desk = createDefaultDesk();
    const names = meshNames(desk);
    expect(names.filter((name) => name.startsWith('desk-bolt-'))).toHaveLength(4);
    expect(names.filter((name) => name.startsWith('desk-screw-'))).toHaveLength(2);
    desk.dispose();
  });

  it('is structurally deterministic and does not mutate its input', () => {
    const spec = createDeskSpec({ width: 180 });
    const before = JSON.stringify(spec);
    const first = buildDesk(spec);
    const second = buildDesk(spec);
    expect(JSON.stringify(spec)).toBe(before);
    expect(meshNames(first)).toEqual(meshNames(second));
    expect(first.materialNames).toEqual(second.materialNames);
    for (const name of meshNames(first)) {
      expect(box(first, name).min.toArray()).toEqual(box(second, name).min.toArray());
      expect(box(first, name).max.toArray()).toEqual(box(second, name).max.toArray());
    }
    first.dispose();
    second.dispose();
  });

  it('rejects an invalid DeskSpec before creating geometry', () => {
    expect(() => buildDesk(createDeskSpec({ width: 0 }))).toThrowError(DeskSpecError);
  });
});

describe('DeskBuilder — GLB export', () => {
  it('exports the assembled desk through the existing GLB path', async () => {
    const desk = createDefaultDesk();
    const glb = await exportGroupToGlb(desk.group);
    const summary = summarizeGlb(glb);
    expect(summary.ok, summary.ok ? '' : summary.reason).toBe(true);
    if (!summary.ok) {
      throw new Error(summary.reason);
    }
    expect(summary.summary.meshes).toBe(16);
    expect(summary.summary.primitives).toBe(16);
    expect(summary.summary.materials).toHaveLength(4);
    expect(summary.summary.bytes).toBeGreaterThan(0);
    expect(new Set(summary.summary.materials).size).toBe(4);
    expect(summary.summary.triangles).toBeGreaterThan(0);
    expect(desk.group.parent).toBeNull();
    expect(desk.group.scale.toArray()).toEqual([1, 1, 1]);
    desk.dispose();
  });
});
