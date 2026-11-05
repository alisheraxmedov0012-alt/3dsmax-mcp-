import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyUvMapping,
  uvModeForRecipe,
  uvOrientationForPart,
  validateUvGeometry,
  UV_TILE_CM,
} from './uv';

function triangle(positions: number[], uvs: number[] = [0, 0, 0, 0, 0, 0]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

function uvArray(geometry: THREE.BufferGeometry): number[] {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  return Array.from(uv.array as ArrayLike<number>);
}

function span(geometry: THREE.BufferGeometry, filter?: (index: number) => boolean): { u: number; v: number } {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < uv.count; i += 1) {
    if (filter && !filter(i)) continue;
    const u = uv.getX(i);
    const v = uv.getY(i);
    minU = Math.min(minU, u);
    minV = Math.min(minV, v);
    maxU = Math.max(maxU, u);
    maxV = Math.max(maxV, v);
  }
  return { u: maxU - minU, v: maxV - minV };
}

describe('uvModeForRecipe', () => {
  it('selects physical mappings per geometry family', () => {
    expect(uvModeForRecipe({ kind: 'box' })).toBe('box');
    expect(uvModeForRecipe({ kind: 'roundedBox' })).toBe('box');
    expect(uvModeForRecipe({ kind: 'cylinder' })).toBe('cylindrical');
    expect(uvModeForRecipe({ kind: 'capsule' })).toBe('cylindrical');
    expect(uvModeForRecipe({ kind: 'lathe' })).toBe('cylindrical');
    expect(uvModeForRecipe({ kind: 'tube' })).toBe('cylindrical');
    expect(uvModeForRecipe({ kind: 'extrude' })).toBe('planar');
    expect(uvModeForRecipe({ kind: 'custom' })).toBe('planar');
    expect(uvModeForRecipe({ kind: 'custom', uvs: [0, 0, 1, 0, 0, 1] })).toBe('preserve');
    expect(uvModeForRecipe({ kind: 'sphere' })).toBe('preserve');
  });

  it('chooses vertical grain for structural and door parts', () => {
    expect(uvOrientationForPart('leg')).toBe('vertical');
    expect(uvOrientationForPart('support')).toBe('vertical');
    expect(uvOrientationForPart('frame')).toBe('vertical');
    expect(uvOrientationForPart('door')).toBe('vertical');
    expect(uvOrientationForPart('panel')).toBe('auto');
    expect(uvOrientationForPart(undefined)).toBe('auto');
  });
});

describe('box mapping', () => {
  it('maps a segmented box by physical size with uniform density', () => {
    const geometry = new THREE.BoxGeometry(100, 50, 25, 2, 1, 1);
    const result = applyUvMapping(
      geometry,
      { kind: 'box', width: 100, height: 50, depth: 25 },
      { mode: 'auto' },
    );
    expect(result.applied).toBe(true);
    expect(result.mode).toBe('box');
    expect(result.diagnostics.valid).toBe(true);
    expect(geometry.userData.uvLayout).toMatchObject({
      layout: 'box',
      tileCm: UV_TILE_CM,
      orientation: 'auto',
    });
    const spans = span(geometry);
    expect(spans.u).toBeCloseTo(2, 6);
    expect(spans.v).toBeCloseTo(1, 6);
    expect((geometry.getAttribute('uv') as THREE.BufferAttribute).count).toBe(
      geometry.getAttribute('position').count,
    );
  });

  it('keeps density identical for 50 cm and 100 cm panels', () => {
    const small = new THREE.BoxGeometry(50, 20, 10);
    const large = new THREE.BoxGeometry(100, 20, 10);
    applyUvMapping(small, { kind: 'box', width: 50, height: 20, depth: 10 }, { mode: 'box' });
    applyUvMapping(large, { kind: 'box', width: 100, height: 20, depth: 10 }, { mode: 'box' });
    const smallSpan = span(small);
    const largeSpan = span(large);
    expect(smallSpan.u / 50).toBeCloseTo(largeSpan.u / 100, 6);
    expect(smallSpan.u).toBeCloseTo(1, 6);
    expect(largeSpan.u).toBeCloseTo(2, 6);
    expect(smallSpan.v).toBeCloseTo(0.4, 6);
    expect(largeSpan.v).toBeCloseTo(0.4, 6);
  });

  it('swaps the texture axes for horizontal orientation', () => {
    const geometry = new THREE.BoxGeometry(100, 50, 25);
    applyUvMapping(
      geometry,
      { kind: 'box', width: 100, height: 50, depth: 25 },
      { mode: 'box', orientation: 'horizontal' },
    );
    const spans = span(geometry);
    expect(spans.u).toBeCloseTo(1, 6);
    expect(spans.v).toBeCloseTo(2, 6);
    expect(geometry.userData.uvLayout.orientation).toBe('horizontal');
  });

  it('is deterministic and idempotent', () => {
    const recipe = { kind: 'box', width: 80, height: 40, depth: 20 } as const;
    const first = new THREE.BoxGeometry(80, 40, 20, 2, 2, 1);
    const second = new THREE.BoxGeometry(80, 40, 20, 2, 2, 1);
    applyUvMapping(first, recipe, { mode: 'box' });
    applyUvMapping(second, recipe, { mode: 'box' });
    expect(uvArray(second)).toEqual(uvArray(first));

    const before = uvArray(first);
    const again = applyUvMapping(first, recipe, { mode: 'box' });
    expect(again.applied).toBe(false);
    expect(uvArray(first)).toEqual(before);
  });

  it('maps rounded boxes through the same physical box core', () => {
    const geometry = new THREE.BoxGeometry(60, 30, 15);
    const result = applyUvMapping(
      geometry,
      { kind: 'roundedBox', width: 60, height: 30, depth: 15 },
      { mode: 'auto' },
    );
    expect(result.applied).toBe(true);
    expect(result.mode).toBe('box');
    expect(result.diagnostics.valid).toBe(true);
  });
});

describe('planar mapping', () => {
  it('projects a triangle on the requested plane at physical scale', () => {
    const geometry = triangle([0, 0, 0, 100, 0, 0, 0, 50, 0]);
    const result = applyUvMapping(geometry, { kind: 'custom' }, { mode: 'planar', plane: 'xy' });
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    expect(result.applied).toBe(true);
    expect(uv.getX(0)).toBeCloseTo(0, 6);
    expect(uv.getX(1)).toBeCloseTo(2, 6);
    expect(uv.getY(2)).toBeCloseTo(1, 6);
    expect(result.diagnostics.valid).toBe(true);
  });

  it('supports U/V flips and horizontal orientation', () => {
    const geometry = triangle([0, 0, 0, 100, 0, 0, 0, 50, 0]);
    applyUvMapping(geometry, { kind: 'custom' }, { mode: 'planar', plane: 'xy', flipU: true });
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    expect(uv.getX(1)).toBeCloseTo(0, 6);
    expect(uv.getX(2)).toBeCloseTo(2, 6);

    const swapped = triangle([0, 0, 0, 100, 0, 0, 0, 50, 0]);
    applyUvMapping(swapped, { kind: 'custom' }, { mode: 'planar', plane: 'xy', orientation: 'horizontal' });
    const swappedUv = swapped.getAttribute('uv') as THREE.BufferAttribute;
    expect(swappedUv.getX(1)).toBeCloseTo(0, 6);
    expect(swappedUv.getY(1)).toBeCloseTo(2, 6);
  });

  it('picks the flattest plane for custom geometry', () => {
    const geometry = triangle([0, 0, 0, 100, 0, 0, 0, 0, 50]);
    const result = applyUvMapping(geometry, { kind: 'custom' }, { mode: 'auto' });
    expect(result.applied).toBe(true);
    expect(result.mode).toBe('planar');
    expect(geometry.userData.uvLayout.plane).toBe('xz');
  });
});

describe('cylindrical mapping', () => {
  function cylinder(): THREE.CylinderGeometry {
    return new THREE.CylinderGeometry(10, 10, 40, 16, 1, false);
  }

  it('maps the side by circumference and height, and the caps planarly', () => {
    const geometry = cylinder();
    const result = applyUvMapping(
      geometry,
      { kind: 'cylinder', radiusTop: 10, radiusBottom: 10, height: 40 },
      { mode: 'auto' },
    );
    expect(result.applied).toBe(true);
    expect(result.mode).toBe('cylindrical');
    expect(result.diagnostics.valid).toBe(true);
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const side = span(geometry, (i) => Math.abs(normal.getY(i)) <= 0.9);
    expect(side.u).toBeCloseTo((2 * Math.PI * 10) / UV_TILE_CM, 4);
    expect(side.v).toBeCloseTo(40 / UV_TILE_CM, 4);
    expect(geometry.userData.uvLayout).toMatchObject({
      layout: 'cylindrical',
      tileCm: UV_TILE_CM,
    });
  });

  it('shifts the texture seam without touching the geometry', () => {
    const base = cylinder();
    const shifted = cylinder();
    const before = base.getAttribute('position').array.slice();
    applyUvMapping(base, { kind: 'cylinder', radiusTop: 10, radiusBottom: 10, height: 40 }, { mode: 'cylindrical' });
    applyUvMapping(
      shifted,
      { kind: 'cylinder', radiusTop: 10, radiusBottom: 10, height: 40 },
      { mode: 'cylindrical', seamOffset: 0.5 },
    );
    const normal = base.getAttribute('normal') as THREE.BufferAttribute;
    const baseMax = Math.max(
      ...Array.from({ length: base.getAttribute('uv').count })
        .map((_, i) => i)
        .filter((i) => Math.abs(normal.getY(i)) <= 0.9)
        .map((i) => (base.getAttribute('uv') as THREE.BufferAttribute).getX(i)),
    );
    const shiftedMax = Math.max(
      ...Array.from({ length: shifted.getAttribute('uv').count })
        .map((_, i) => i)
        .filter((i) => Math.abs(normal.getY(i)) <= 0.9)
        .map((i) => (shifted.getAttribute('uv') as THREE.BufferAttribute).getX(i)),
    );
    expect(shiftedMax - baseMax).toBeCloseTo(0.5, 6);
    expect(Array.from(shifted.getAttribute('position').array as Float32Array)).toEqual(
      Array.from(before as Float32Array),
    );
  });

  it('maps a tube along its path and around its radius', () => {
    const curve = new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(100, 0, 0));
    const geometry = new THREE.TubeGeometry(curve, 10, 2, 8, false);
    const result = applyUvMapping(
      geometry,
      { kind: 'tube', radius: 2 },
      { mode: 'cylindrical' },
    );
    const spans = span(geometry);
    expect(result.applied).toBe(true);
    expect(result.diagnostics.valid).toBe(true);
    expect(spans.u).toBeCloseTo(2, 4);
    expect(spans.v).toBeCloseTo((2 * Math.PI * 2) / UV_TILE_CM, 4);
  });

  it('uses U for circumference and V for height on the default orientation', () => {
    const geometry = cylinder();
    applyUvMapping(
      geometry,
      { kind: 'cylinder', radiusTop: 10, radiusBottom: 10, height: 40 },
      { mode: 'cylindrical' },
    );
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const side = span(geometry, (i) => Math.abs(normal.getY(i)) <= 0.9);
    expect(side.u).toBeGreaterThan(side.v);
  });
});

describe('UV validation', () => {
  it('detects a missing UV attribute', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    const result = validateUvGeometry(geometry);
    expect(result.valid).toBe(false);
    expect(result.hasUv).toBe(false);
  });

  it('detects count mismatch and non-finite values', () => {
    const geometry = triangle([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 0, 0]);
    expect(validateUvGeometry(geometry).valid).toBe(false);

    const nan = triangle(
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
      [0, 0, Number.NaN, 0, 0, 1],
    );
    const result = validateUvGeometry(nan);
    expect(result.valid).toBe(false);
    expect(result.nonFiniteCount).toBe(1);
  });

  it('flags a degenerate zero-span mapping as a warning', () => {
    const geometry = triangle([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 0, 0, 0, 0, 0]);
    const result = validateUvGeometry(geometry);
    expect(result.valid).toBe(true);
    expect(result.warnings.join(' ')).toContain('degenerate');
  });

  it('flags excessive UV values without rejecting them', () => {
    const geometry = triangle([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 0, 20_000, 0, 0, 1]);
    const result = validateUvGeometry(geometry);
    expect(result.warnings.join(' ')).toContain('10000');
  });
});
