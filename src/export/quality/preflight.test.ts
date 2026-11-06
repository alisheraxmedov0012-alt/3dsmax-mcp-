import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { evaluateQualityPreflight, preflightExportScene } from './preflight';
import { QUALITY_PROFILES, createCustomProfile, resolveQualityProfile } from './profiles';
import { collectQualityMetrics } from './metrics';
import type { QualityPreflightResult, QualityProfile } from './types';
import {
  createTableSceneObject,
  SCENE_SCHEMA_VERSION,
  type SceneData,
} from '../../scene/types';
import { createDefaultSettings } from '../../scene/sceneSettings';

function textured(width: number, height: number, mimeType?: string): THREE.Texture {
  const texture = new THREE.Texture();
  texture.image = { width, height, getContext: () => null } as unknown as HTMLImageElement;
  if (mimeType) texture.userData.mimeType = mimeType;
  return texture;
}

function boxMesh(): {
  root: THREE.Group;
  mesh: THREE.Mesh;
  geometry: THREE.BoxGeometry;
  material: THREE.MeshStandardMaterial;
} {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  const root = new THREE.Group();
  root.add(mesh);
  return { root, mesh, geometry, material };
}

function check(result: QualityPreflightResult, id: string) {
  const found = result.checks.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing check ${id}`);
  return found;
}

function metricsFor(root: THREE.Object3D) {
  return collectQualityMetrics(root);
}

function sceneForPreflight(): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
    objects: [createTableSceneObject('t1')],
    settings: createDefaultSettings(),
  };
}

describe('quality profiles', () => {
  it('provides distinct draft, standard and high limits', () => {
    expect(QUALITY_PROFILES.draft.limits.geometry.maxTriangles).toBeGreaterThan(
      QUALITY_PROFILES.standard.limits.geometry.maxTriangles,
    );
    expect(QUALITY_PROFILES.standard.limits.geometry.maxTriangles).toBeGreaterThan(
      QUALITY_PROFILES.high.limits.geometry.maxTriangles,
    );
    expect(QUALITY_PROFILES.draft.budgetSeverity).toBe('WARNING');
    expect(QUALITY_PROFILES.standard.budgetSeverity).toBe('WARNING');
    expect(QUALITY_PROFILES.high.budgetSeverity).toBe('BLOCK');
  });

  it('creates a custom profile without mutating the base profile', () => {
    const custom = createCustomProfile(
      { geometry: { maxTriangles: 42 }, textures: { maxWidth: 2048 } },
      'BLOCK',
    );
    expect(custom.id).toBe('custom');
    expect(custom.budgetSeverity).toBe('BLOCK');
    expect(custom.limits.geometry.maxTriangles).toBe(42);
    expect(custom.limits.textures.maxWidth).toBe(2048);
    expect(custom.limits.geometry.maxVertices).toBe(
      QUALITY_PROFILES.standard.limits.geometry.maxVertices,
    );
    expect(QUALITY_PROFILES.standard.limits.geometry.maxTriangles).not.toBe(42);
    expect(resolveQualityProfile('custom', custom).limits.geometry.maxTriangles).toBe(42);
  });

  it('passes a small scene under every predefined profile', () => {
    const { root } = boxMesh();
    const metrics = metricsFor(root);
    for (const id of ['draft', 'standard', 'high'] as const) {
      const result = evaluateQualityPreflight(metrics, QUALITY_PROFILES[id], { format: 'glb' });
      expect(result.status, id).toBe('PASS');
    }
  });
});

describe('instance-aware geometry metrics', () => {
  it('counts one geometry once but every mesh node for the scene totals', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial();
    const root = new THREE.Group();
    for (let index = 0; index < 4; index += 1) {
      root.add(new THREE.Mesh(geometry, material));
    }

    const metrics = metricsFor(root);

    expect(metrics.uniqueGeometries).toBe(1);
    expect(metrics.uniqueGeometryTriangles).toBe(12);
    expect(metrics.uniqueGeometryVertices).toBe(24);
    expect(metrics.meshNodes).toBe(4);
    expect(metrics.sceneTriangles).toBe(48);
    expect(metrics.sceneVertices).toBe(96);
    expect(metrics.objectGroups).toBe(4);
    expect(metrics.sceneNodes).toBe(4);
    expect(metrics.instancedMeshNodes).toBe(0);
    expect(metrics.instancedInstances).toBe(0);
  });

  it('accounts for InstancedMesh count in scene totals', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial();
    const mesh = new THREE.InstancedMesh(geometry, material, 5);
    const root = new THREE.Group();
    root.add(mesh);

    const metrics = metricsFor(root);

    expect(metrics.uniqueGeometries).toBe(1);
    expect(metrics.meshNodes).toBe(1);
    expect(metrics.sceneTriangles).toBe(60);
    expect(metrics.sceneVertices).toBe(120);
    expect(metrics.instancedMeshNodes).toBe(1);
    expect(metrics.instancedInstances).toBe(5);
  });

  it('uses scene totals for triangle and vertex budgets', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial();
    const root = new THREE.Group();
    for (let index = 0; index < 4; index += 1) {
      root.add(new THREE.Mesh(geometry, material));
    }
    const profile = createCustomProfile(
      { geometry: { maxTriangles: 12, maxVertices: 24 } },
      'WARNING',
    );
    const result = evaluateQualityPreflight(metricsFor(root), profile, { format: 'glb' });
    expect(check(result, 'geometry.triangles').actual).toBe(48);
    expect(check(result, 'geometry.vertices').actual).toBe(96);
    expect(check(result, 'geometry.triangles').status).toBe('WARNING');
    expect(check(result, 'geometry.unique_triangles').actual).toBe(12);
  });
});

describe('geometry budgets', () => {
  it('warns when the triangle budget is exceeded', () => {
    const { root } = boxMesh();
    const profile = createCustomProfile({ geometry: { maxTriangles: 1 } }, 'WARNING');
    const result = evaluateQualityPreflight(metricsFor(root), profile, { format: 'glb' });
    expect(check(result, 'geometry.triangles').status).toBe('WARNING');
    expect(result.status).toBe('WARNING');
  });

  it('blocks when the triangle budget is configured as blocking', () => {
    const { root } = boxMesh();
    const profile = createCustomProfile({ geometry: { maxTriangles: 1 } }, 'BLOCK');
    const result = evaluateQualityPreflight(metricsFor(root), profile, { format: 'glb' });
    expect(check(result, 'geometry.triangles').status).toBe('BLOCK');
    expect(result.status).toBe('BLOCK');
  });

  it('passes and fails the vertex budget', () => {
    const { root } = boxMesh();
    const metrics = metricsFor(root);
    const pass = evaluateQualityPreflight(
      metrics,
      createCustomProfile({ geometry: { maxVertices: metrics.sceneVertices } }),
      { format: 'glb' },
    );
    const fail = evaluateQualityPreflight(
      metrics,
      createCustomProfile({ geometry: { maxVertices: metrics.sceneVertices - 1 } }, 'WARNING'),
      { format: 'glb' },
    );
    expect(check(pass, 'geometry.vertices').status).toBe('PASS');
    expect(check(fail, 'geometry.vertices').status).toBe('WARNING');
  });

  it('blocks degenerate and non-finite geometry', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 2, 0, 0], 3),
    );
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
    );
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1], 2));
    geometry.setIndex([0, 1, 2]);
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));

    const result = evaluateQualityPreflight(metricsFor(root), QUALITY_PROFILES.standard, {
      format: 'glb',
    });
    expect(check(result, 'geometry.degenerate').status).toBe('BLOCK');
    expect(check(result, 'geometry.non_finite').status).toBe('PASS');

    geometry.getAttribute('position').setY(1, Number.NaN);
    const nonFinite = evaluateQualityPreflight(metricsFor(root), QUALITY_PROFILES.standard, {
      format: 'glb',
    });
    expect(check(nonFinite, 'geometry.non_finite').status).toBe('BLOCK');
  });
});

describe('file and texture budgets', () => {
  it('reports an actual file-size overrun', () => {
    const { root } = boxMesh();
    const profile = createCustomProfile({ fileSize: { maxGlbBytes: 100 } }, 'WARNING');
    const result = evaluateQualityPreflight(metricsFor(root), profile, {
      format: 'glb',
      actualFileBytes: 1000,
    });
    expect(check(result, 'file.size').status).toBe('WARNING');
    expect(result.estimated).toBe(true);
  });

  it('blocks an actual file-size overrun under High Quality', () => {
    const { root } = boxMesh();
    const profile = createCustomProfile({ fileSize: { maxGlbBytes: 100 } }, 'BLOCK');
    const result = evaluateQualityPreflight(metricsFor(root), profile, {
      format: 'glb',
      actualFileBytes: 1000,
    });
    expect(check(result, 'file.size').status).toBe('BLOCK');
  });

  it('does not block on an estimated file size before the file exists', () => {
    const { root } = boxMesh();
    const profile = createCustomProfile({ fileSize: { maxGlbBytes: 100 } }, 'BLOCK');
    const result = evaluateQualityPreflight(metricsFor(root), profile, { format: 'glb' });
    expect(check(result, 'file.size').status).toBe('WARNING');
    expect(result.status).toBe('WARNING');
  });

  it('uses the glTF package limit for a textual glTF document', () => {
    const { root } = boxMesh();
    const profile = createCustomProfile(
      { fileSize: { maxGltfPackageBytes: 100 } },
      'WARNING',
    );
    const result = evaluateQualityPreflight(metricsFor(root), profile, {
      format: 'gltf',
      actualFileBytes: 1000,
    });
    expect(check(result, 'file.size').status).toBe('WARNING');
  });

  it('checks the actual embedded texture payload', () => {
    const { root } = boxMesh();
    const profile = createCustomProfile(
      { fileSize: { maxTexturePayloadBytes: 100 } },
      'BLOCK',
    );
    const result = evaluateQualityPreflight(metricsFor(root), profile, {
      format: 'glb',
      actualTexturePayloadBytes: 1000,
    });
    expect(check(result, 'file.texture_payload').status).toBe('BLOCK');
  });

  it('checks texture resolution, total pixels and individual size', () => {
    const { root, material } = boxMesh();
    material.map = textured(512, 512);
    material.normalMap = textured(512, 512);

    const resolution = evaluateQualityPreflight(
      metricsFor(root),
      createCustomProfile({ textures: { maxWidth: 256, maxHeight: 256 } }, 'WARNING'),
      { format: 'glb' },
    );
    expect(check(resolution, 'textures.width').status).toBe('WARNING');
    expect(check(resolution, 'textures.height').status).toBe('WARNING');

    const pixels = evaluateQualityPreflight(
      metricsFor(root),
      createCustomProfile({ textures: { maxTotalPixels: 1000 } }, 'WARNING'),
      { format: 'glb' },
    );
    expect(check(pixels, 'textures.total_pixels').status).toBe('WARNING');

    const individual = evaluateQualityPreflight(
      metricsFor(root),
      createCustomProfile({ textures: { maxIndividualBytes: 1000 } }, 'WARNING'),
      { format: 'glb' },
    );
    expect(check(individual, 'textures.individual_bytes').status).toBe('WARNING');
  });

  it('blocks missing images and unsupported texture formats', () => {
    const { root, material } = boxMesh();
    material.map = new THREE.Texture();
    const missing = evaluateQualityPreflight(metricsFor(root), QUALITY_PROFILES.standard, {
      format: 'glb',
    });
    expect(check(missing, 'textures.missing_images').status).toBe('BLOCK');

    material.map = textured(1, 1, 'image/gif');
    const unsupported = evaluateQualityPreflight(metricsFor(root), QUALITY_PROFILES.standard, {
      format: 'glb',
    });
    expect(check(unsupported, 'textures.formats').status).toBe('BLOCK');
  });
});

describe('UV, normal, tangent and material checks', () => {
  it('blocks missing and non-finite UV coordinates', () => {
    const { root, geometry, material } = boxMesh();
    material.map = textured(1, 1);
    geometry.deleteAttribute('uv');
    const missing = evaluateQualityPreflight(metricsFor(root), QUALITY_PROFILES.standard, {
      format: 'glb',
    });
    expect(check(missing, 'uv.missing').status).toBe('BLOCK');

    const { root: root2, geometry: geometry2, material: material2 } = boxMesh();
    material2.map = textured(1, 1);
    geometry2.getAttribute('uv').setX(0, Number.NaN);
    const nonFinite = evaluateQualityPreflight(metricsFor(root2), QUALITY_PROFILES.standard, {
      format: 'glb',
    });
    expect(check(nonFinite, 'uv.non_finite').status).toBe('BLOCK');
  });

  it('warns for out-of-range UVs and blocks invalid counts', () => {
    const { root, geometry } = boxMesh();
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let index = 0; index < uv.count; index += 1) uv.setXY(index, 2000, 2000);
    const range = evaluateQualityPreflight(metricsFor(root), QUALITY_PROFILES.standard, {
      format: 'glb',
    });
    expect(check(range, 'uv.range').status).toBe('WARNING');

    const { root: root2, geometry: geometry2 } = boxMesh();
    geometry2.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0], 2));
    const count = evaluateQualityPreflight(metricsFor(root2), QUALITY_PROFILES.standard, {
      format: 'glb',
    });
    expect(check(count, 'uv.count').status).toBe('BLOCK');
  });

  it('blocks missing and non-finite normals, and warns on invalid lengths', () => {
    const { root, geometry } = boxMesh();
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
    normal.setXYZ(0, 2, 0, 0);
    const lengths = evaluateQualityPreflight(metricsFor(root), QUALITY_PROFILES.standard, {
      format: 'glb',
    });
    expect(check(lengths, 'normals.length').status).toBe('WARNING');

    normal.setXYZ(1, Number.NaN, 0, 0);
    const nonFinite = evaluateQualityPreflight(metricsFor(root), QUALITY_PROFILES.standard, {
      format: 'glb',
    });
    expect(check(nonFinite, 'normals.non_finite').status).toBe('BLOCK');

    geometry.deleteAttribute('normal');
    const missing = evaluateQualityPreflight(metricsFor(root), QUALITY_PROFILES.standard, {
      format: 'glb',
    });
    expect(check(missing, 'normals.missing').status).toBe('BLOCK');
  });

  it('passes generated tangents and blocks invalid authored tangents', () => {
    const { root, geometry, material } = boxMesh();
    material.normalMap = textured(1, 1);
    const planned = evaluateQualityPreflight(metricsFor(root), QUALITY_PROFILES.standard, {
      format: 'glb',
    });
    expect(check(planned, 'tangents.missing').status).toBe('PASS');

    const values = new Float32Array(24).fill(0);
    for (let index = 0; index < 24; index += 4) values[index + 3] = 1;
    geometry.setAttribute('tangent', new THREE.BufferAttribute(values, 4));
    const invalid = evaluateQualityPreflight(metricsFor(root), QUALITY_PROFILES.standard, {
      format: 'glb',
    });
    expect(metricsFor(root).invalidTangents).toBe(1);
    expect(check(invalid, 'tangents.invalid').status).toBe('BLOCK');
  });

  it('blocks normal-mapped geometry that cannot receive tangents', () => {
    const { root, mesh, material } = boxMesh();
    material.normalMap = textured(1, 1);
    mesh.geometry = mesh.geometry.toNonIndexed();
    const result = evaluateQualityPreflight(metricsFor(root), QUALITY_PROFILES.standard, {
      format: 'glb',
    });
    expect(check(result, 'tangents.missing').status).toBe('BLOCK');
  });

  it('checks base colour, PBR ranges and alpha configuration', () => {
    const { root, material } = boxMesh();
    material.color.setRGB(2, 0, 0);
    material.metalness = 2;
    material.roughness = -1;
    material.opacity = 2;

    const metrics = metricsFor(root);
    expect(metrics.invalidBaseColors).toBe(1);
    expect(metrics.invalidPbrMaterials).toBe(1);
    expect(metrics.invalidAlphaMaterials).toBe(1);

    const result = evaluateQualityPreflight(metrics, QUALITY_PROFILES.standard, {
      format: 'glb',
    });
    expect(check(result, 'materials.base_color').status).toBe('BLOCK');
    expect(check(result, 'materials.pbr_ranges').status).toBe('BLOCK');
    expect(check(result, 'materials.alpha').status).toBe('BLOCK');
  });

  it('blocks a normal map without UV coordinates', () => {
    const { root, geometry, material } = boxMesh();
    material.normalMap = textured(1, 1);
    geometry.deleteAttribute('uv');
    const metrics = metricsFor(root);
    expect(metrics.normalMappedWithoutUv).toBe(1);
    const result = evaluateQualityPreflight(metrics, QUALITY_PROFILES.standard, {
      format: 'glb',
    });
    expect(check(result, 'materials.normal_map_uv').status).toBe('BLOCK');
  });

  it('marks estimated texture payloads instead of claiming exact measurements', () => {
    const { root, material } = boxMesh();
    material.map = textured(512, 512);
    const estimated = metricsFor(root);
    expect(estimated.texturePayloadCertainty).toBe('approximate');
    expect(estimated.textures[0].payloadSource).toBe('estimated');

    const exactTexture = new THREE.Texture();
    exactTexture.image = {
      width: 512,
      height: 512,
      byteLength: 1234,
      getContext: () => null,
    } as unknown as HTMLImageElement;
    material.map = exactTexture;
    const exact = metricsFor(root);
    expect(exact.textures.find((texture) => texture.id === exactTexture.uuid)?.payloadSource).toBe(
      'exact',
    );
    expect(exact.texturePayloadCertainty).toBe('exact');
  });

  it('blocks a missing material reference and an unsupported material', () => {
    const { root, mesh } = boxMesh();
    mesh.material = undefined as unknown as THREE.Material;
    const missing = evaluateQualityPreflight(metricsFor(root), QUALITY_PROFILES.standard, {
      format: 'glb',
    });
    expect(check(missing, 'materials.missing').status).toBe('BLOCK');

    const { root: root2, mesh: mesh2 } = boxMesh();
    mesh2.material = new THREE.ShaderMaterial();
    const unsupported = evaluateQualityPreflight(metricsFor(root2), QUALITY_PROFILES.standard, {
      format: 'glb',
    });
    expect(check(unsupported, 'materials.unsupported').status).toBe('BLOCK');
  });
});

describe('preflight side effects', () => {
  it('does not mutate geometry or materials while measuring', () => {
    const { root, mesh, geometry, material } = boxMesh();
    material.map = textured(1, 1);
    const beforePosition = Array.from(geometry.getAttribute('position').array);
    const beforeNormal = Array.from(geometry.getAttribute('normal').array);
    const beforeUv = Array.from(geometry.getAttribute('uv').array);
    const beforeMaterial = mesh.material;

    const metrics = metricsFor(root);
    evaluateQualityPreflight(metrics, QUALITY_PROFILES.standard, { format: 'glb' });

    expect(Array.from(geometry.getAttribute('position').array)).toEqual(beforePosition);
    expect(Array.from(geometry.getAttribute('normal').array)).toEqual(beforeNormal);
    expect(Array.from(geometry.getAttribute('uv').array)).toEqual(beforeUv);
    expect(mesh.material).toBe(beforeMaterial);
    expect(geometry.getAttribute('tangent')).toBeUndefined();
  });

  it('does not mutate SceneData when building a preview preflight', () => {
    const data = sceneForPreflight();
    const before = JSON.stringify(data);
    const profile: QualityProfile = resolveQualityProfile('standard');
    const result = preflightExportScene(data, { profile, format: 'glb' });
    expect(result.status).toBe('PASS');
    expect(JSON.stringify(data)).toBe(before);
  });
});
