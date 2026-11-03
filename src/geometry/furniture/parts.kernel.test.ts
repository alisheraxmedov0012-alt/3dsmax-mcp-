import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { GeometryKernelError } from '../kernel';
import { buildFurniture } from './buildFurniture';
import { PartBuilder } from './parts';
import { FURNITURE_TYPES, createFurnitureParams } from './types';

describe('PartBuilder geometry kernel integration', () => {
  it('keeps the legacy box path unchanged', () => {
    const builder = new PartBuilder('legacy', '#a9744f');
    const mesh = builder.box('legacy-box', [10, 20, 30], [1, 2, 3]);
    expect(mesh.name).toBe('legacy-box');
    expect(mesh.userData.partId).toBe('legacy-box');
    expect((mesh.geometry as THREE.BufferGeometry).getAttribute('position').count).toBe(24);
    expect((mesh.geometry as THREE.BufferGeometry).index?.count).toBe(36);
    builder.dispose();
  });

  it('adds a box recipe with physical UVs by default', () => {
    const builder = new PartBuilder('kernel', '#a9744f');
    const mesh = builder.addGeometry(
      'panel',
      { kind: 'box', width: 100, height: 2, depth: 50 },
      [0, 10, 0],
    );
    const geometry = mesh.geometry as THREE.BufferGeometry;
    expect(mesh.name).toBe('panel');
    expect(mesh.userData.partId).toBe('panel');
    expect(geometry.getAttribute('position').count).toBe(24);
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    let maxUv = 0;
    for (let i = 0; i < uv.count; i += 1) {
      maxUv = Math.max(maxUv, uv.getX(i), uv.getY(i));
    }
    expect(maxUv).toBeGreaterThan(1);
    expect(geometry.userData.kernel).toMatchObject({ kind: 'box' });
    builder.dispose();
  });

  it('adds a non-box recipe and preserves its part identity', () => {
    const builder = new PartBuilder('kernel', '#a9744f');
    const mesh = builder.addGeometry(
      'leg',
      { kind: 'cylinder', radiusTop: 2, radiusBottom: 2, height: 20, radialSegments: 12 },
      [0, 0, 0],
      [0, 0, 0],
    );
    const geometry = mesh.geometry as THREE.BufferGeometry;
    expect(mesh.userData.partId).toBe('leg');
    expect(geometry.userData.kernel).toMatchObject({ kind: 'cylinder' });
    expect(geometry.getAttribute('uv')).toBeDefined();
    builder.dispose();
  });

  it('rejects physical-box UVs for non-box recipes', () => {
    const builder = new PartBuilder('kernel', '#a9744f');
    expect(() =>
      builder.addGeometry(
        'leg',
        { kind: 'cylinder', radiusTop: 2, radiusBottom: 2, height: 20 },
        [0, 0, 0],
        undefined,
        { uv: 'physical-box' },
      ),
    ).toThrowError(/physical-box/);
    builder.dispose();
  });

  it('disposes kernel geometries with the builder', () => {
    const builder = new PartBuilder('kernel', '#a9744f');
    const mesh = builder.addGeometry('part', { kind: 'sphere', radius: 1 }, [0, 0, 0]);
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const spy = vi.spyOn(geometry, 'dispose');
    builder.dispose();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('uses geometry UVs by default for a segmented box', () => {
    const builder = new PartBuilder('kernel', '#a9744f');
    const mesh = builder.addGeometry(
      'segmented',
      { kind: 'box', width: 100, height: 2, depth: 50, widthSegments: 2 },
      [0, 0, 0],
    );
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    let maxUv = 0;
    for (let i = 0; i < uv.count; i += 1) {
      maxUv = Math.max(maxUv, uv.getX(i), uv.getY(i));
    }
    expect(maxUv).toBeLessThanOrEqual(1.000001);
    builder.dispose();
  });

  it('rejects explicit physical-box UVs on a segmented box with a typed error', () => {
    const builder = new PartBuilder('kernel', '#a9744f');
    try {
      builder.addGeometry(
        'segmented',
        { kind: 'box', width: 100, height: 2, depth: 50, widthSegments: 2 },
        [0, 0, 0],
        undefined,
        { uv: 'physical-box' },
      );
      throw new Error('expected a typed error');
    } catch (error) {
      expect(error).toBeInstanceOf(GeometryKernelError);
      expect((error as GeometryKernelError).code).toBe('unsupported_recipe');
      expect((error as Error).message).toContain('segmented');
    }
    builder.dispose();
  });

  it('keeps all eight existing builders working', () => {
    for (const type of FURNITURE_TYPES) {
      const built = buildFurniture(type, createFurnitureParams(type));
      expect(built.group.children.length, type).toBeGreaterThan(0);
      built.dispose();
    }
  });
});
