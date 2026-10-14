import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildFurniture } from './buildFurniture';
import { createFurnitureParams, FURNITURE_TYPES, type FurnitureType } from './types';

function measure(group: THREE.Group): THREE.Vector3 {
  group.updateMatrixWorld(true);
  const size = new THREE.Vector3();
  new THREE.Box3().setFromObject(group).getSize(size);
  return size;
}

function partNames(group: THREE.Group): string[] {
  const names: string[] = [];
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      names.push(mesh.name);
    }
  });
  return names;
}

describe('buildFurniture', () => {
  it('builds every type with real parts and finite geometry', () => {
    for (const type of FURNITURE_TYPES) {
      const built = buildFurniture(type, createFurnitureParams(type));
      const names = partNames(built.group);
      expect(names.length).toBeGreaterThan(1);

      const size = measure(built.group);
      for (const value of [size.x, size.y, size.z]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }

      // No NaN/Infinity may leak into part transforms.
      built.group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          expect(Number.isFinite(mesh.position.x)).toBe(true);
          expect(Number.isFinite(mesh.position.y)).toBe(true);
          expect(Number.isFinite(mesh.position.z)).toBe(true);
          expect(mesh.userData.partId).toBeTruthy();
        }
      });

      built.dispose();
    }
  });

  it('keeps the table footprint equal to its parameters', () => {
    const params = { ...createFurnitureParams('table'), widthCm: 160, heightCm: 75, depthCm: 70 };
    const built = buildFurniture('table', params);
    const size = measure(built.group);
    expect(size.x).toBeCloseTo(160, 3);
    expect(size.y).toBeCloseTo(75, 3);
    expect(size.z).toBeCloseTo(70, 3);
    built.dispose();
  });

  it('changes geometry when a parameter changes', () => {
    const small = buildFurniture('sofa', { ...createFurnitureParams('sofa'), widthCm: 140 });
    const large = buildFurniture('sofa', { ...createFurnitureParams('sofa'), widthCm: 260 });
    expect(measure(large.group).x).toBeGreaterThan(measure(small.group).x);
    small.dispose();
    large.dispose();
  });

  it('produces wider geometry for a wider wardrobe and respects height', () => {
    const params = { ...createFurnitureParams('wardrobe'), widthCm: 220, heightCm: 240, depthCm: 65 };
    const built = buildFurniture('wardrobe', params);
    const size = measure(built.group);
    expect(size.x).toBeCloseTo(220, 3);
    expect(size.y).toBeCloseTo(240, 3);
    built.dispose();
  });

  it('names type-specific parts (seat/back, shelves, drawers, headboard)', () => {
    const cases: Array<[FurnitureType, string[]]> = [
      ['chair', ['chair-seat', 'chair-back']],
      ['armchair', ['armchair-seat', 'armchair-back', 'armchair-arm-1']],
      ['sofa', ['sofa-seat', 'sofa-back', 'sofa-arm-1']],
      ['bed', ['bed-frame', 'bed-mattress', 'bed-headboard']],
      ['wardrobe', ['wardrobe-side-1', 'wardrobe-door-1']],
      ['shelf', ['shelf-side-1', 'shelf-board-1']],
      ['dresser', ['dresser-body', 'dresser-drawer-1']],
    ];
    for (const [type, expected] of cases) {
      const built = buildFurniture(type, createFurnitureParams(type));
      const names = partNames(built.group);
      for (const name of expected) {
        expect(names).toContain(name);
      }
      built.dispose();
    }
  });

  it('adds two extra legs when the table leg count is six', () => {
    const four = buildFurniture('table', { ...createFurnitureParams('table'), legCount: 4 });
    const six = buildFurniture('table', { ...createFurnitureParams('table'), legCount: 6 });
    const legs = (group: THREE.Group) => partNames(group).filter((name) => name.startsWith('table-leg-'));
    expect(legs(four.group)).toHaveLength(4);
    expect(legs(six.group)).toHaveLength(6);
    four.dispose();
    six.dispose();
  });

  it('disposes without throwing for every type', () => {
    for (const type of FURNITURE_TYPES) {
      const built = buildFurniture(type, createFurnitureParams(type));
      expect(() => built.dispose()).not.toThrow();
    }
  });
});
