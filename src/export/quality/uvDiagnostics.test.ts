import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { analyzeUvQuality } from './uvDiagnostics';

function quad(uvs: readonly number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([...uvs], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

describe('UV quality diagnostics', () => {
  it('reports exact range and approximate overlap/texel density', () => {
    const diagnostic = analyzeUvQuality(quad([0, 0, 1, 0, 1, 1, 0, 1]), {
      meshNames: ['quad'],
      texturePixels: 100 * 100,
      worldArea: 1,
    });
    expect(diagnostic.uvTriangles).toBe(2);
    expect(diagnostic.degenerateTriangles).toBe(0);
    expect(diagnostic.minU).toBe(0);
    expect(diagnostic.maxU).toBe(1);
    expect(diagnostic.overlapStatus).toBe('approximate');
    expect(diagnostic.overlapCandidates).toBe(0);
    expect(diagnostic.texelDensity?.average).toBeCloseTo(100, 5);
    expect(diagnostic.texelDensity?.certainty).toBe('approximate');
  });

  it('does not treat mirrored UV orientation as degenerate', () => {
    const diagnostic = analyzeUvQuality(quad([1, 0, 0, 0, 0, 1, 1, 1]), {
      meshNames: ['mirrored'],
    });
    expect(diagnostic.degenerateTriangles).toBe(0);
    expect(diagnostic.minU).toBe(0);
    expect(diagnostic.maxU).toBe(1);
  });

  it('counts degenerate UV triangles exactly', () => {
    const diagnostic = analyzeUvQuality(quad([0, 0, 0, 0, 0, 0, 0, 0]));
    expect(diagnostic.degenerateTriangles).toBe(2);
    expect(diagnostic.overlapStatus).toBe('not_verified');
  });

  it('detects overlapping UV triangles without treating shared seams as overlap', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1],
        3,
      ),
    );
    geometry.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 2),
    );
    geometry.setIndex([0, 1, 2, 3, 4, 5]);

    const diagnostic = analyzeUvQuality(geometry, { meshNames: ['overlap'] });
    expect(diagnostic.overlapCandidates).toBeGreaterThan(0);
    expect(diagnostic.overlapStatus).toBe('approximate');
  });

  it('reports NOT VERIFIED when texture dimensions or world area are unavailable', () => {
    const diagnostic = analyzeUvQuality(quad([0, 0, 1, 0, 1, 1, 0, 1]));
    expect(diagnostic.texelDensity).toBeNull();
    expect(diagnostic.notes.join(' ')).toContain('NOT VERIFIED');
  });
});
