/**
 * B1/B3 — validation behaviour on deterministic fixtures.
 *
 * The fixtures are deliberately small and hand-built so a failure points at the
 * algorithm, not at a furniture builder.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { analyzeMeshTopology } from './meshTopology';
import { validatePrintReadiness } from './printValidation';
import { analyzeObjectPrintReadiness, printFingerprint } from './printReadiness';
import { resolvePrinterProfile } from './printerProfile';
import { createFurnitureSceneObject, createTableSceneObject } from '../scene/types';

function mesh(geometry: THREE.BufferGeometry): THREE.Mesh {
  const object = new THREE.Mesh(geometry);
  object.name = 'fixture';
  object.updateMatrixWorld(true);
  return object;
}

function check(report: ReturnType<typeof validatePrintReadiness>, id: string) {
  const found = report.checks.find((entry) => entry.id === id);
  if (!found) throw new Error(`check ${id} missing`);
  return found;
}

/** A box whose bottom rests on y = 0, like a piece standing on the build plate. */
function groundedBox(x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(x, y, z).translate(0, y / 2, 0);
}

function openBoxGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(2, 3, 4);
  const index = geometry.getIndex();
  if (!index) throw new Error('expected an indexed box');
  geometry.setIndex(Array.from(index.array).slice(0, index.count - 6));
  return geometry;
}

function mergeBoxes(
  entries: Array<{ size: [number, number, number]; position: [number, number, number] }>,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const entry of entries) {
    const box = new THREE.BoxGeometry(...entry.size);
    box.translate(...entry.position);
    const position = box.getAttribute('position');
    const index = box.getIndex();
    const offset = positions.length / 3;
    for (let i = 0; i < position.count; i += 1) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
    }
    if (index) {
      for (let i = 0; i < index.count; i += 1) indices.push(index.getX(i) + offset);
    }
    box.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

describe('B1 — topology fixtures', () => {
  it('reports a closed cube as closed, manifold and positively oriented', () => {
    const topology = analyzeMeshTopology(mesh(new THREE.BoxGeometry(2, 3, 4)), 'cube');
    expect(topology).toMatchObject({
      triangles: 12,
      boundaryEdges: 0,
      nonManifoldEdges: 0,
      degenerateTriangles: 0,
      inconsistentWindingEdges: 0,
      components: 1,
      closed: true,
      manifold: true,
      finite: true,
      invalidIndices: 0,
      inverted: false,
    });
    expect(topology.volumeMm3).toBeCloseTo(24000, 4); // 24 cm³
  });

  it('detects a missing face as an open boundary', () => {
    const topology = analyzeMeshTopology(mesh(openBoxGeometry()), 'open');
    expect(topology.closed).toBe(false);
    expect(topology.boundaryEdges).toBe(4);
  });

  it('counts disconnected components without merging them', () => {
    const geometry = mergeBoxes([
      { size: [1, 1, 1], position: [0, 0, 0] },
      { size: [1, 1, 1], position: [5, 0, 0] },
    ]);
    const topology = analyzeMeshTopology(mesh(geometry), 'two');
    expect(topology.components).toBe(2);
    expect(topology.closed).toBe(true);
  });

  it('detects inconsistent winding on a shared edge', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0],
        3,
      ),
    );
    // Both triangles traverse the edge a->b in the same direction.
    geometry.setIndex([0, 1, 2, 0, 1, 3]);
    const topology = analyzeMeshTopology(mesh(geometry), 'winding');
    expect(topology.inconsistentWindingEdges).toBeGreaterThan(0);
    expect(topology.manifold).toBe(false);
  });

  it('detects a non-manifold edge used by three triangles', () => {
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
    const topology = analyzeMeshTopology(mesh(geometry), 'non-manifold');
    expect(topology.nonManifoldEdges).toBeGreaterThan(0);
    expect(topology.closed).toBe(false);
  });

  it('flags mirrored (negative-scale) transforms without rejecting them', () => {
    const object = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4));
    object.scale.x = -1;
    object.updateMatrixWorld(true);
    const report = validatePrintReadiness(object);
    expect(report.meshes[0].negativeScale).toBe(true);
    expect(check(report, 'mirrored_transform').status).toBe('WARNING');
    expect(report.status).toBe('WARNING');
  });
});

describe('B1 — reports and statuses', () => {
  it('separates implemented PASS checks from unsupported NOT_CHECKED checks', () => {
    const report = validatePrintReadiness(mesh(groundedBox(2, 3, 4)));
    expect(report.status).toBe('PASS');
    expect(check(report, 'closed_boundary').status).toBe('PASS');
    expect(check(report, 'manifold_edges').status).toBe('PASS');
    expect(check(report, 'self_intersection').status).toBe('NOT_CHECKED');
    expect(check(report, 'part_overlap').status).toBe('NOT_CHECKED');
    expect(check(report, 'overhang_supports').status).toBe('NOT_CHECKED');
    expect(check(report, 'slicer').status).toBe('NOT_CHECKED');
    expect(report.counts.NOT_CHECKED).toBeGreaterThan(0);
    expect(report.limitations.join(' ')).toMatch(/slicer/i);
  });

  it('treats an open mesh as a print ERROR but still exportable', () => {
    const report = validatePrintReadiness(mesh(openBoxGeometry()));
    expect(report.status).toBe('ERROR');
    expect(check(report, 'closed_boundary')).toMatchObject({
      status: 'ERROR',
      code: 'open_boundaries',
      blocking: false,
    });
    expect(report.exportable).toBe(true);
  });

  it('marks non-finite vertices as blocking', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, Number.NaN, 1, 0], 3),
    );
    const report = validatePrintReadiness(mesh(geometry));
    expect(check(report, 'finite_vertices')).toMatchObject({
      status: 'ERROR',
      code: 'non_finite_vertices',
      blocking: true,
    });
    expect(report.exportable).toBe(false);
    expect(report.sizeMm).toBeNull();
    expect(check(report, 'bounds').status).toBe('ERROR');
  });

  it('marks invalid indices as blocking', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    geometry.setIndex([0, 1, 9]);
    const report = validatePrintReadiness(mesh(geometry));
    expect(check(report, 'valid_indices').status).toBe('ERROR');
    expect(report.exportable).toBe(false);
  });

  it('marks an incomplete triangle as blocking', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 0]);
    const report = validatePrintReadiness(mesh(geometry));
    expect(check(report, 'triangle_structure').status).toBe('ERROR');
    expect(report.exportable).toBe(false);
  });

  it('reports empty geometry as an error, not as a pass', () => {
    const report = validatePrintReadiness(new THREE.Group());
    expect(report.status).toBe('ERROR');
    expect(check(report, 'geometry_present')).toMatchObject({
      status: 'ERROR',
      code: 'empty_geometry',
    });
    expect(report.exportable).toBe(false);
    expect(report.sizeMm).toBeNull();
  });

  it('warns about degenerate and duplicate triangles', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 2, 0, 0], 3),
    );
    const degenerate = validatePrintReadiness(mesh(geometry));
    expect(check(degenerate, 'degenerate_triangles').status).toBe('WARNING');

    const duplicated = new THREE.BufferGeometry();
    duplicated.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    duplicated.setIndex([0, 1, 2, 0, 1, 2]);
    expect(check(validatePrintReadiness(mesh(duplicated)), 'duplicate_triangles').status).toBe(
      'WARNING',
    );
  });

  it('warns instead of passing when normals are absent', () => {
    // BoxGeometry has normals; a raw triangle fixture does not.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const report = validatePrintReadiness(mesh(geometry));
    expect(check(report, 'normals')).toMatchObject({
      status: 'WARNING',
      code: 'missing_normals',
    });
  });
});

describe('B3 — wall thickness', () => {
  it('measures a 20 mm wall on a 20 x 30 x 40 mm box', () => {
    const report = validatePrintReadiness(mesh(new THREE.BoxGeometry(2, 3, 4)));
    expect(report.minWallThicknessMm).toBeCloseTo(20, 0);
    expect(check(report, 'wall_thickness').status).toBe('NOT_CHECKED');
  });

  it('fails a target above the measured wall', () => {
    const { profile } = resolvePrinterProfile({ minWallThicknessMm: 25 });
    const report = validatePrintReadiness(mesh(new THREE.BoxGeometry(2, 3, 4)), { profile });
    expect(check(report, 'wall_thickness')).toMatchObject({
      status: 'ERROR',
      code: 'wall_below_target',
      blocking: false,
    });
    expect(report.status).toBe('ERROR');
  });

  it('warns when the wall is close to the target', () => {
    const { profile } = resolvePrinterProfile({ minWallThicknessMm: 18 });
    const report = validatePrintReadiness(mesh(new THREE.BoxGeometry(2, 3, 4)), { profile });
    expect(check(report, 'wall_thickness').status).toBe('WARNING');
  });

  it('passes a target below the measured wall', () => {
    const { profile } = resolvePrinterProfile({ minWallThicknessMm: 10 });
    const report = validatePrintReadiness(mesh(new THREE.BoxGeometry(2, 3, 4)), { profile });
    expect(check(report, 'wall_thickness').status).toBe('PASS');
  });

  it('detects a genuinely thin wall', () => {
    const { profile } = resolvePrinterProfile({ minWallThicknessMm: 3 });
    const report = validatePrintReadiness(mesh(new THREE.BoxGeometry(0.2, 3, 4)), { profile });
    expect(report.minWallThicknessMm).toBeCloseTo(2, 0);
    expect(check(report, 'wall_thickness').status).toBe('ERROR');
  });

  it('returns NOT_CHECKED, not PASS, when the wall cannot be measured', () => {
    const { profile } = resolvePrinterProfile({ minWallThicknessMm: 1 });
    const report = validatePrintReadiness(mesh(new THREE.PlaneGeometry(5, 5)), { profile });
    expect(check(report, 'wall_thickness').status).toBe('NOT_CHECKED');
  });
});

describe('B3 — build volume and placement', () => {
  it('passes a small model inside the configured volume', () => {
    const { profile } = resolvePrinterProfile({
      buildVolumeXmm: 100,
      buildVolumeYmm: 100,
      buildVolumeZmm: 100,
    });
    const report = validatePrintReadiness(mesh(new THREE.BoxGeometry(2, 3, 4)), { profile });
    expect(check(report, 'build_volume').status).toBe('PASS');
  });

  it('names each exceeded axis', () => {
    const { profile } = resolvePrinterProfile({
      buildVolumeXmm: 19,
      buildVolumeYmm: 100,
      buildVolumeZmm: 100,
    });
    const report = validatePrintReadiness(mesh(new THREE.BoxGeometry(2, 3, 4)), { profile });
    const build = check(report, 'build_volume');
    expect(build.status).toBe('ERROR');
    expect(build.code).toBe('build_volume_exceeded');
    expect(build.message).toMatch(/X \(20 > 19\)/);
  });

  it('returns NOT_CHECKED when no build volume is configured', () => {
    const report = validatePrintReadiness(mesh(new THREE.BoxGeometry(2, 3, 4)));
    expect(check(report, 'build_volume')).toMatchObject({
      status: 'NOT_CHECKED',
      code: 'build_volume_not_configured',
    });
  });

  it('warns when the model sits below the build plate', () => {
    const object = mesh(new THREE.BoxGeometry(2, 3, 4));
    object.position.y = -1;
    object.updateMatrixWorld(true);
    const report = validatePrintReadiness(object);
    expect(check(report, 'build_plate')).toMatchObject({
      status: 'WARNING',
      code: 'below_build_plate',
    });
  });

  it('distinguishes every configured axis independently', () => {
    for (const [axis, volume] of [
      ['x', { buildVolumeXmm: 19, buildVolumeYmm: 100, buildVolumeZmm: 100 }],
      ['y', { buildVolumeXmm: 100, buildVolumeYmm: 29, buildVolumeZmm: 100 }],
      ['z', { buildVolumeXmm: 100, buildVolumeYmm: 100, buildVolumeZmm: 39 }],
    ] as const) {
      const { profile } = resolvePrinterProfile(volume);
      const report = validatePrintReadiness(mesh(new THREE.BoxGeometry(2, 3, 4)), { profile });
      const build = check(report, 'build_volume');
      expect(build.status, axis).toBe('ERROR');
      expect(build.message, axis).toContain(`${axis.toUpperCase()} (`);
    }
  });
});

describe('B3 — object readiness, units and staleness', () => {
  it('measures the table in millimetres from the effective geometry', () => {
    const report = analyzeObjectPrintReadiness(createTableSceneObject('t1'));
    expect(report.sizeMm).toEqual({ x: 1200, y: 750, z: 600 });
    expect(report.status).toBe('PASS');
    expect(report.meshes.every((entry) => entry.closed)).toBe(true);
  });

  it('applies the object scale exactly once', () => {
    const object = createTableSceneObject('t1', { scale: { x: 2, y: 2, z: 2 } });
    const report = analyzeObjectPrintReadiness(object);
    expect(report.sizeMm).toEqual({ x: 2400, y: 1500, z: 1200 });
  });

  it('changes the fingerprint when the geometry or profile changes', () => {
    const object = createTableSceneObject('t1');
    const before = printFingerprint(object, null);
    const changed = createTableSceneObject('t1', { params: { ...object.params, widthCm: 180 } });
    expect(printFingerprint(changed, null)).not.toBe(before);
    const { profile } = resolvePrinterProfile({ minWallThicknessMm: 2 });
    expect(printFingerprint(object, profile)).not.toBe(before);
  });

  it('does not reuse a pass after the geometry changes', () => {
    const object = createTableSceneObject('t1');
    const first = analyzeObjectPrintReadiness(object);
    const thin = createTableSceneObject('t1', {
      params: { ...object.params, topThicknessCm: 2 },
    });
    const { profile } = resolvePrinterProfile({ minWallThicknessMm: 25 });
    const second = analyzeObjectPrintReadiness(thin, profile);
    expect(first.status).toBe('PASS');
    expect(second.status).toBe('ERROR');
    expect(second.minWallThicknessMm).toBeLessThan(25);
  });

  it('keeps every furniture type analysable', () => {
    for (const type of ['table', 'chair', 'armchair', 'sofa', 'bed', 'wardrobe', 'shelf', 'dresser'] as const) {
      const report = analyzeObjectPrintReadiness(createFurnitureSceneObject(type, `${type}-1`));
      expect(report.totals.triangles, type).toBeGreaterThan(0);
      expect(report.exportable, type).toBe(true);
    }
  });
});
