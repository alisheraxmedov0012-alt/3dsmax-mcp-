import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { analyzePrintGeometry } from './meshValidation';
import { buildFurniture } from '../geometry/furniture/buildFurniture';
import { createFurnitureParams } from '../geometry/furniture/types';

function meshOf(geometry: THREE.BufferGeometry): THREE.Mesh {
  return new THREE.Mesh(geometry);
}

describe('B1 — print mesh validation', () => {
  it('recognizes a closed box as watertight and reports millimetres', () => {
    const report = analyzePrintGeometry(meshOf(new THREE.BoxGeometry(2, 3, 4)));
    expect(report.meshes).toBe(1);
    expect(report.triangles).toBe(12);
    expect(report.closedMeshes).toBe(1);
    expect(report.boundaryEdges).toBe(0);
    expect(report.nonManifoldEdges).toBe(0);
    expect(report.degenerateTriangles).toBe(0);
    expect(report.watertight).toBe(true);
    expect(report.sizeMm).toEqual({ x: 20, y: 30, z: 40 });
  });

  it('detects an open boundary', () => {
    const report = analyzePrintGeometry(meshOf(new THREE.PlaneGeometry(2, 2)));
    expect(report.watertight).toBe(false);
    expect(report.boundaryEdges).toBeGreaterThan(0);
    expect(report.openMeshes).toBe(1);
  });

  it('detects a degenerate triangle', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 2, 0, 0], 3),
    );
    const report = analyzePrintGeometry(meshOf(geometry));
    expect(report.degenerateTriangles).toBe(1);
    expect(report.watertight).toBe(false);
  });

  it('detects a non-manifold edge shared by three triangles', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          0, 0, 0, 1, 0, 0, 0, 1, 0,
          1, 0, 0, 0, 0, 0, 0, -1, 0,
          0, 0, 1, 1, 0, 0, 0, 0, 0,
        ],
        3,
      ),
    );
    const report = analyzePrintGeometry(meshOf(geometry));
    expect(report.nonManifoldEdges).toBeGreaterThan(0);
    expect(report.watertight).toBe(false);
  });

  it('reports the real table parts as closed and keeps the print limitations visible', () => {
    const built = buildFurniture('table', createFurnitureParams('table'));
    try {
      const report = analyzePrintGeometry(built.group);
      expect(report.meshes).toBeGreaterThan(0);
      expect(report.watertight).toBe(true);
      expect(report.sizeMm).toEqual({ x: 1200, y: 750, z: 600 });
      expect(report.limitations.join(' ')).toMatch(/devor qalinligi/i);
      expect(report.limitations.join(' ')).toMatch(/slicer/i);
    } finally {
      built.dispose();
    }
  });
});
