/**
 * A2 — physical UV mapping.
 *
 * The point of these tests is the property, not the numbers: every face of a box
 * must cover the same number of centimetres per UV unit, whatever its size. A
 * texture that stretches on a table top and compresses on a leg is the defect.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PartBuilder } from '../geometry/furniture/parts';
import {
  UV_TILE_CM,
  applyPhysicalBoxUvs,
  boxFaceUvScale,
  describeUvLayout,
} from './uv';

const FACE_SPANS: ReadonlyArray<readonly [number, number]> = [
  [60, 75], // +X: depth × height
  [60, 75], // -X
  [200, 60], // +Y: width × depth
  [200, 60], // -Y
  [200, 75], // +Z: width × height
  [200, 75], // -Z
];

function faceSpans(geometry: THREE.BufferGeometry): Array<[number, number]> {
  const uv = geometry.getAttribute('uv');
  return Array.from({ length: 6 }, (_, face) => {
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let vertex = 0; vertex < 4; vertex += 1) {
      const index = face * 4 + vertex;
      minU = Math.min(minU, uv.getX(index));
      maxU = Math.max(maxU, uv.getX(index));
      minV = Math.min(minV, uv.getY(index));
      maxV = Math.max(maxV, uv.getY(index));
    }
    return [maxU - minU, maxV - minV];
  });
}

describe('boxFaceUvScale', () => {
  it('scales each face by its own physical width and height', () => {
    const scale = boxFaceUvScale([200, 75, 60]);
    expect(scale.tileCm).toBe(UV_TILE_CM);
    expect(scale.faces).toEqual([
      [1.2, 1.5],
      [1.2, 1.5],
      [4, 1.2],
      [4, 1.2],
      [4, 1.5],
      [4, 1.5],
    ]);
  });

  it('rejects a non-positive or non-finite tile instead of dividing by zero', () => {
    expect(boxFaceUvScale([100, 50, 25], 0).tileCm).toBe(1);
    expect(boxFaceUvScale([100, 50, 25], Number.NaN).tileCm).toBe(UV_TILE_CM);
    expect(boxFaceUvScale([100, 50, 25], Number.POSITIVE_INFINITY).tileCm).toBe(UV_TILE_CM);
  });

  it('treats a non-finite dimension as a tiny box rather than producing NaN', () => {
    const scale = boxFaceUvScale([Number.NaN, -5, Number.POSITIVE_INFINITY]);
    for (const [u, v] of scale.faces) {
      expect(Number.isFinite(u)).toBe(true);
      expect(Number.isFinite(v)).toBe(true);
      expect(u).toBeGreaterThan(0);
      expect(v).toBeGreaterThan(0);
    }
  });
});

describe('applyPhysicalBoxUvs', () => {
  it('makes texel density constant across every face of a large flat box', () => {
    const size: [number, number, number] = [200, 4, 60];
    const geometry = new THREE.BoxGeometry(...size);
    expect(applyPhysicalBoxUvs(geometry, size)).toBe(true);

    const spans = faceSpans(geometry);
    const faces: Array<[number, number]> = [
      [60, 4],
      [60, 4],
      [200, 60],
      [200, 60],
      [200, 4],
      [200, 4],
    ];
    spans.forEach(([uSpan, vSpan], face) => {
      const [faceWidth, faceHeight] = faces[face];
      expect(uSpan / faceWidth).toBeCloseTo(1 / UV_TILE_CM, 6);
      expect(vSpan / faceHeight).toBeCloseTo(1 / UV_TILE_CM, 6);
    });
  });

  it('covers the physical spans on a mixed-size box', () => {
    const geometry = new THREE.BoxGeometry(200, 75, 60);
    applyPhysicalBoxUvs(geometry, [200, 75, 60]);
    const spans = faceSpans(geometry);
    spans.forEach(([uSpan, vSpan], face) => {
      const [faceWidth, faceHeight] = FACE_SPANS[face];
      expect(uSpan).toBeCloseTo(faceWidth / UV_TILE_CM, 6);
      expect(vSpan).toBeCloseTo(faceHeight / UV_TILE_CM, 6);
    });
  });

  it('is idempotent, so a rebuilt mesh is not scaled twice', () => {
    const geometry = new THREE.BoxGeometry(200, 75, 60);
    applyPhysicalBoxUvs(geometry, [200, 75, 60]);
    const first = faceSpans(geometry);
    expect(applyPhysicalBoxUvs(geometry, [200, 75, 60])).toBe(false);
    expect(faceSpans(geometry)).toEqual(first);
    expect(geometry.userData.uvLayout).toEqual({ layout: 'physical-box', tileCm: UV_TILE_CM });
  });

  it('honours a custom tile size', () => {
    const geometry = new THREE.BoxGeometry(100, 100, 100);
    applyPhysicalBoxUvs(geometry, [100, 100, 100], 25);
    const [uSpan] = faceSpans(geometry)[4];
    expect(uSpan).toBeCloseTo(4, 6);
  });

  it('leaves non-box geometry untouched', () => {
    const geometry = new THREE.PlaneGeometry(30, 30);
    const before = Array.from(geometry.getAttribute('uv').array);
    expect(applyPhysicalBoxUvs(geometry, [30, 30, 1])).toBe(false);
    expect(Array.from(geometry.getAttribute('uv').array)).toEqual(before);
    expect(geometry.userData.uvLayout).toBeUndefined();
  });

  it('is applied by PartBuilder, so every furniture part is mapped', () => {
    const builder = new PartBuilder('test-object', '#a9744f', { materialId: 'wood-oak' });
    try {
      const mesh = builder.box('table-top', [200, 4, 60], [0, 0, 0]);
      const [uSpan, vSpan] = faceSpans(mesh.geometry)[4];
      expect(uSpan).toBeCloseTo(4, 6);
      expect(vSpan).toBeCloseTo(0.08, 6);
    } finally {
      builder.dispose();
    }
  });
});

describe('describeUvLayout', () => {
  it('reports the tile that exports actually use', () => {
    expect(describeUvLayout()).toEqual({
      layout: 'physical-box',
      tileCm: UV_TILE_CM,
      textureScaleApplies: true,
    });
    expect(describeUvLayout(0).tileCm).toBe(1);
  });
});
