import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildPlan } from './build';
import './definitions';
import { createFurniturePlan } from './plan';
import { furnitureDefinitions } from './registry';
import { validateUvGeometry, MAX_UV_ABS } from '../../materials/uv';
import { buildSceneObject } from '../../scene/buildSceneObject';
import { createUniversalSceneObject } from '../../scene/types';
import { applyBaseColorTextureToGroup } from '../../materials/applyBaseColorTexture';

function meshUvs(root: THREE.Object3D): Map<string, number[]> {
  const result = new Map<string, number[]>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const uv = (mesh.geometry as THREE.BufferGeometry).getAttribute('uv') as
      | THREE.BufferAttribute
      | undefined;
    if (uv) {
      result.set(mesh.name, Array.from(uv.array as ArrayLike<number>));
    }
  });
  return result;
}

describe('universal definitions — physical UV integration', () => {
  it('gives every built part a finite, matching UV attribute', () => {
    for (const definition of furnitureDefinitions.list()) {
      const plan = createFurniturePlan(definition.id, definition.defaults);
      const built = buildPlan(plan);
      try {
        let meshCount = 0;
        built.group.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (!mesh.isMesh) return;
          meshCount += 1;
          const geometry = mesh.geometry as THREE.BufferGeometry;
          const diagnostics = validateUvGeometry(geometry);
          const label = `${definition.id}:${mesh.name}`;
          expect(diagnostics.errors, label).toEqual([]);
          expect(diagnostics.valid, label).toBe(true);
          expect(diagnostics.uvCount, label).toBe(diagnostics.positionCount);
          expect(diagnostics.spanU, label).toBeLessThanOrEqual(MAX_UV_ABS);
          expect(diagnostics.spanV, label).toBeLessThanOrEqual(MAX_UV_ABS);
        });
        expect(meshCount, definition.id).toBeGreaterThan(0);
      } finally {
        built.dispose();
      }
    }
  });

  it('recomputes UVs when a furniture dimension changes', () => {
    const definition = furnitureDefinitions.require('bed.standard');
    const baseSpec = definition.defaults as Record<string, unknown>;
    const largeSpec = { ...baseSpec, width: Number(baseSpec.width) + 40 };

    const small = buildPlan(createFurniturePlan('bed.standard', baseSpec));
    const large = buildPlan(createFurniturePlan('bed.standard', largeSpec));
    try {
      const smallUvs = meshUvs(small.group);
      const largeUvs = meshUvs(large.group);
      let changed = 0;
      for (const [name, uv] of smallUvs) {
        const other = largeUvs.get(name);
        if (other && other.length === uv.length && other.some((value, index) => value !== uv[index])) {
          changed += 1;
        }
      }
      expect(changed).toBeGreaterThan(0);
    } finally {
      small.dispose();
      large.dispose();
    }
  });

  it('keeps UVs identical when only the material preset changes', () => {
    const object = createUniversalSceneObject('bed.standard', 'bed-1');
    const defaultBuild = buildSceneObject({
      ...object,
      material: { metalness: 0.05, roughness: 0.6 },
    });
    const woodBuild = buildSceneObject({
      ...object,
      material: { metalness: 0, roughness: 0.65, materialId: 'wood-oak' },
    });
    try {
      expect(meshUvs(woodBuild.group)).toEqual(meshUvs(defaultBuild.group));
    } finally {
      defaultBuild.dispose();
      woodBuild.dispose();
    }
  });

  it('does not alter UVs when a baseColor bitmap is applied', () => {
    const object = createUniversalSceneObject('bed.standard', 'bed-1');
    const built = buildSceneObject(object);
    const before = meshUvs(built.group);
    try {
      applyBaseColorTextureToGroup(built.group, new THREE.Texture());
      expect(meshUvs(built.group)).toEqual(before);
    } finally {
      built.dispose();
    }
  });
});
