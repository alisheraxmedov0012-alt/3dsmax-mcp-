import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { OBJECT_LIMITS } from '../scene/types';
import { normalizeRotationDegrees } from '../scene/transformLimits';
import {
  TRANSFORM_LIMITS,
  constrainGizmoScale,
  transformPatchFromObject,
} from './transformCommit';

describe('9A.2.9 — gizmo transform commit', () => {
  it('normalizes negative and multi-turn angles into 0–360', () => {
    expect(normalizeRotationDegrees(-45)).toBe(315);
    expect(normalizeRotationDegrees(360)).toBe(0);
    expect(normalizeRotationDegrees(725)).toBe(5);
    expect(normalizeRotationDegrees(Number.NaN)).toBe(0);
  });

  it('reads a group transform in scene units', () => {
    const group = new THREE.Group();
    group.position.set(10, -20, 30.4567);
    group.rotation.set(-Math.PI / 4, (3 * Math.PI) / 2, 0);
    group.scale.set(2, 1.5, 0.5);

    const patch = transformPatchFromObject(group);
    expect(patch.position).toEqual({ x: 10, y: -20, z: 30.457 });
    expect(patch.rotation.x).toBeCloseTo(315, 3);
    expect(patch.rotation.y).toBeCloseTo(270, 3);
    expect(patch.rotation.z).toBe(0);
    expect(patch.scale).toEqual({ x: 2, y: 1.5, z: 0.5 });
  });

  it('clamps scale during a drag and reports whether it changed', () => {
    const group = new THREE.Group();
    group.scale.set(0, -2, 20);
    const changed = constrainGizmoScale(group);
    expect(changed).toBe(true);
    expect(group.scale.x).toBe(OBJECT_LIMITS.scale.min);
    expect(group.scale.y).toBe(OBJECT_LIMITS.scale.min);
    expect(group.scale.z).toBe(OBJECT_LIMITS.scale.max);
    expect(constrainGizmoScale(group)).toBe(false);
  });

  it('uses the same limits as scene objects', () => {
    expect(TRANSFORM_LIMITS).toBe(OBJECT_LIMITS);
  });

  it('rounds sub-millimetre noise out of the persisted patch', () => {
    const group = new THREE.Group();
    group.position.set(0.0000001, 0.0004, -0.0004);
    group.scale.set(1.0000001, 1, 1);
    const patch = transformPatchFromObject(group);
    expect(patch.position).toEqual({ x: 0, y: 0, z: -0 });
    expect(patch.scale.x).toBe(1);
  });
});
