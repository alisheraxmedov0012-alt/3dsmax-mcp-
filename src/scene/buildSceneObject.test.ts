import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyObjectTransform, buildSceneObject } from './buildSceneObject';
import { createTableSceneObject } from './types';

const DEG = Math.PI / 180;

describe('buildSceneObject', () => {
  it('tags the group with the scene object id', () => {
    const object = createTableSceneObject('abc');
    const { group, dispose } = buildSceneObject(object);

    expect(group.userData.sceneObjectId).toBe('abc');
    expect(group.name).toBe('object:abc');

    dispose();
  });

  it('applies position, rotation and scale', () => {
    const object = createTableSceneObject('abc', {
      position: { x: 100, y: 0, z: -50 },
      rotation: { x: 0, y: 90, z: 0 },
      scale: { x: 2, y: 2, z: 2 },
    });
    const { group, dispose } = buildSceneObject(object);

    expect(group.position.x).toBe(100);
    expect(group.position.z).toBe(-50);
    expect(group.rotation.y).toBeCloseTo(90 * DEG, 6);
    expect(group.scale.x).toBe(2);

    dispose();
  });

  it('reflects scale in the rendered bounding box', () => {
    const base = createTableSceneObject('a', {
      params: { widthCm: 100, heightCm: 75, depthCm: 60, color: '#a9744f' },
    });
    const scaled = createTableSceneObject('b', {
      params: { widthCm: 100, heightCm: 75, depthCm: 60, color: '#a9744f' },
      scale: { x: 2, y: 2, z: 2 },
    });

    const baseBuilt = buildSceneObject(base);
    const scaledBuilt = buildSceneObject(scaled);

    const size = (object: THREE.Object3D): number => {
      object.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3()).x;
    };

    expect(size(scaledBuilt.group)).toBeCloseTo(size(baseBuilt.group) * 2, 5);

    baseBuilt.dispose();
    scaledBuilt.dispose();
  });

  it('honours the visible flag', () => {
    const hidden = createTableSceneObject('h', { visible: false });
    const { group, dispose } = buildSceneObject(hidden);
    expect(group.visible).toBe(false);
    dispose();
  });

  it('throws for an unsupported object type', () => {
    expect(() =>
      buildSceneObject({ ...createTableSceneObject('x'), type: 'spaceship' as never }),
    ).toThrow();
  });
});

describe('applyObjectTransform', () => {
  it('updates an existing group without rebuilding geometry', () => {
    const group = new THREE.Group();
    const object = createTableSceneObject('a', {
      position: { x: 10, y: 0, z: 20 },
      rotation: { x: 0, y: 180, z: 0 },
      scale: { x: 3, y: 3, z: 3 },
      visible: false,
    });

    applyObjectTransform(group, object);

    expect(group.position.x).toBe(10);
    expect(group.position.z).toBe(20);
    expect(group.rotation.y).toBeCloseTo(180 * DEG, 6);
    expect(group.scale.z).toBe(3);
    expect(group.visible).toBe(false);
  });
});
