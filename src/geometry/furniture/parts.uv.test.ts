import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GeometryKernelError } from '../kernel';
import { getUvDiagnostics } from '../../materials/uv';
import { PartBuilder } from './parts';

function uvOf(mesh: THREE.Mesh): number[] {
  const uv = (mesh.geometry as THREE.BufferGeometry).getAttribute('uv') as THREE.BufferAttribute;
  return Array.from(uv.array as ArrayLike<number>);
}

describe('PartBuilder universal UV integration', () => {
  it('auto-maps a cylinder as a physical cylindrical layout', () => {
    const builder = new PartBuilder('legs', '#888888');
    const mesh = builder.addGeometry(
      'leg',
      { kind: 'cylinder', radiusTop: 3, radiusBottom: 3, height: 40, radialSegments: 16 },
      [0, 0, 0],
      undefined,
      { uv: 'auto', uvOrientation: 'vertical' },
    );
    const geometry = mesh.geometry as THREE.BufferGeometry;
    expect(geometry.userData.uvLayout).toMatchObject({
      layout: 'cylindrical',
      orientation: 'vertical',
      tileCm: 50,
    });
    expect(getUvDiagnostics(geometry)).toMatchObject({ valid: true });
    builder.dispose();
  });

  it('auto-maps a rounded box through the box core', () => {
    const builder = new PartBuilder('cushions', '#995533');
    const mesh = builder.addGeometry(
      'cushion',
      { kind: 'roundedBox', width: 60, height: 12, depth: 50, radius: 3 },
      [0, 0, 0],
      undefined,
      { uv: 'auto' },
    );
    const geometry = mesh.geometry as THREE.BufferGeometry;
    expect(geometry.userData.uvLayout).toMatchObject({ layout: 'box', tileCm: 50 });
    expect(getUvDiagnostics(geometry)).toMatchObject({ valid: true });
    builder.dispose();
  });

  it('preserves explicit custom UVs and generates physical UVs when absent', () => {
    const builder = new PartBuilder('custom', '#223344');
    const provided = builder.addGeometry(
      'custom-provided',
      {
        kind: 'custom',
        positions: [0, 0, 0, 100, 0, 0, 0, 50, 0],
        uvs: [0, 0, 1, 0, 0, 1],
      },
      [0, 0, 0],
      undefined,
      { uv: 'auto' },
    );
    expect(uvOf(provided)).toEqual([0, 0, 1, 0, 0, 1]);
    expect((provided.geometry as THREE.BufferGeometry).userData.uvLayout).toBeUndefined();

    const generated = builder.addGeometry(
      'custom-generated',
      {
        kind: 'custom',
        positions: [0, 0, 0, 100, 0, 0, 0, 50, 0],
      },
      [0, 0, 0],
      undefined,
      { uv: 'auto' },
    );
    const geometry = generated.geometry as THREE.BufferGeometry;
    expect(geometry.userData.uvLayout).toMatchObject({ layout: 'planar', tileCm: 50 });
    expect(geometry.userData.uvSource).toBe('planar-physical');
    expect(getUvDiagnostics(geometry)).toMatchObject({ valid: true });
    builder.dispose();
  });

  it('rejects an incompatible explicit mapping with a typed error', () => {
    const builder = new PartBuilder('mixed', '#445566');
    expect(() =>
      builder.addGeometry(
        'box',
        { kind: 'box', width: 10, height: 10, depth: 10 },
        [0, 0, 0],
        undefined,
        { uv: 'cylindrical' },
      ),
    ).toThrow(GeometryKernelError);
    expect(() =>
      builder.addGeometry(
        'cylinder',
        { kind: 'cylinder', radiusTop: 1, radiusBottom: 1, height: 10 },
        [0, 0, 0],
        undefined,
        { uv: 'box' },
      ),
    ).toThrow(GeometryKernelError);
    builder.dispose();
  });

  it('keeps the explicit physical-box path backwards compatible', () => {
    const builder = new PartBuilder('legacy', '#a9744f');
    const mesh = builder.addGeometry(
      'panel',
      { kind: 'box', width: 100, height: 2, depth: 50 },
      [0, 0, 0],
      undefined,
      { uv: 'physical-box' },
    );
    const uv = (mesh.geometry as THREE.BufferGeometry).getAttribute('uv') as THREE.BufferAttribute;
    let maxUv = 0;
    for (let i = 0; i < uv.count; i += 1) {
      maxUv = Math.max(maxUv, uv.getX(i), uv.getY(i));
    }
    expect(maxUv).toBeGreaterThan(1);
    builder.dispose();
  });
});
