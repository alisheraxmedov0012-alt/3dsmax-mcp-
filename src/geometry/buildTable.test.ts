import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildTable, TABLE_TOP_THICKNESS_CM } from './buildTable';
import type { TableParams } from './tableParams';

const params: TableParams = {
  widthCm: 140,
  heightCm: 80,
  depthCm: 70,
  color: '#a9744f',
};

function measure(group: THREE.Group): THREE.Vector3 {
  group.updateMatrixWorld(true);
  const size = new THREE.Vector3();
  new THREE.Box3().setFromObject(group).getSize(size);
  return size;
}

describe('buildTable', () => {
  it('builds exactly one top and four legs', () => {
    const { group, dispose } = buildTable(params);

    const names = group.children.map((child) => child.name);
    expect(names).toContain('table-top');
    expect(names.filter((name) => name.startsWith('table-leg-'))).toHaveLength(4);

    dispose();
  });

  it('matches the requested bounding box', () => {
    const { group, dispose } = buildTable(params);

    const size = measure(group);
    expect(size.x).toBeCloseTo(params.widthCm, 5);
    expect(size.z).toBeCloseTo(params.depthCm, 5);
    expect(size.y).toBeCloseTo(params.heightCm, 5);

    dispose();
  });

  it('rests on the floor (min y is zero)', () => {
    const { group, dispose } = buildTable(params);
    group.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(group);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y).toBeCloseTo(params.heightCm, 5);

    dispose();
  });

  it('rescales when the parameters change', () => {
    const small = buildTable({ ...params, widthCm: 60, heightCm: 40, depthCm: 40 });
    const large = buildTable({ ...params, widthCm: 200, heightCm: 100, depthCm: 90 });

    const smallSize = measure(small.group);
    const largeSize = measure(large.group);

    expect(largeSize.x).toBeGreaterThan(smallSize.x);
    expect(largeSize.y).toBeGreaterThan(smallSize.y);
    expect(largeSize.z).toBeGreaterThan(smallSize.z);

    small.dispose();
    large.dispose();
  });

  it('keeps the legs under the top surface', () => {
    const { group, dispose } = buildTable(params);
    group.updateMatrixWorld(true);

    const leg = group.children.find((child) => child.name === 'table-leg-1');
    expect(leg).toBeDefined();
    // Leg height = total height minus the top slab thickness.
    const legBox = new THREE.Box3().setFromObject(leg as THREE.Object3D);
    expect(legBox.max.y).toBeCloseTo(params.heightCm - TABLE_TOP_THICKNESS_CM, 5);

    dispose();
  });
});
