import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  ImportedModelStore,
  disposeImportedModel,
  importedModelStore,
} from './importedModelStore';
import {
  SceneObjectBuildError,
  buildSceneObject,
  sceneObjectGeometryKey,
} from '../scene/buildSceneObject';
import {
  createFurnitureSceneObject,
  createImportedSceneObject,
  type ImportedModelMeta,
} from '../scene/types';

function meta(overrides: Partial<ImportedModelMeta> = {}): ImportedModelMeta {
  return {
    format: 'glb',
    fileName: 'stul.glb',
    sourceBytes: 1024,
    meshes: 1,
    triangles: 12,
    materials: 1,
    textures: 0,
    sourceHash: 'b'.repeat(64),
    boundsCm: { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 2, z: 1 } },
    ...overrides,
  };
}

/** A two-node model: a parent group with a named box mesh inside it. */
function makeModel() {
  const geometry = new THREE.BoxGeometry(2, 4, 2);
  const material = new THREE.MeshStandardMaterial({ color: '#884422' });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Seat';
  const root = new THREE.Group();
  root.name = 'ImportedRoot';
  root.add(mesh);
  return { root, geometry, material, mesh };
}

describe('disposeImportedModel', () => {
  it('disposes every geometry and material exactly once, even when shared', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial();
    const root = new THREE.Group();
    // Two meshes sharing one geometry and one material: a normal glTF shape.
    root.add(new THREE.Mesh(geometry, material));
    root.add(new THREE.Mesh(geometry, material));

    const geometrySpy = vi.spyOn(geometry, 'dispose');
    const materialSpy = vi.spyOn(material, 'dispose');

    disposeImportedModel(root);

    expect(geometrySpy).toHaveBeenCalledTimes(1);
    expect(materialSpy).toHaveBeenCalledTimes(1);
  });

  it('disposes textures referenced by a material', () => {
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));

    const textureSpy = vi.spyOn(texture, 'dispose');
    disposeImportedModel(root);

    expect(textureSpy).toHaveBeenCalledTimes(1);
  });
});

describe('ImportedModelStore', () => {
  it('registers a model and reports its presence', () => {
    const store = new ImportedModelStore();
    const { root } = makeModel();
    store.register('object-1', { root, dispose: () => disposeImportedModel(root) });

    expect(store.has('object-1')).toBe(true);
    expect(store.size).toBe(1);
    store.clear();
  });

  it('hands out independent hierarchies that share GPU resources', () => {
    const store = new ImportedModelStore();
    const { root, geometry } = makeModel();
    store.register('object-1', { root, dispose: () => disposeImportedModel(root) });

    const first = store.acquire('object-1');
    const second = store.acquire('object-1');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);
    expect(first).not.toBe(root);

    const firstMesh = first?.getObjectByName('Seat') as THREE.Mesh;
    const secondMesh = second?.getObjectByName('Seat') as THREE.Mesh;
    // Cloning copies the hierarchy but not the buffers: one upload serves all.
    expect(firstMesh).not.toBe(secondMesh);
    expect(firstMesh.geometry).toBe(geometry);
    expect(secondMesh.geometry).toBe(geometry);

    store.clear();
  });

  it('returns null for an unknown id', () => {
    expect(new ImportedModelStore().acquire('missing')).toBeNull();
  });

  it('disposes through the entry, not through the acquired clone', () => {
    const store = new ImportedModelStore();
    const { root, geometry } = makeModel();
    const dispose = vi.fn(() => disposeImportedModel(root));
    store.register('object-1', { root, dispose });

    const clone = store.acquire('object-1');
    const geometrySpy = vi.spyOn(geometry, 'dispose');

    // Dropping the clone must not touch the registered resources.
    clone?.clear();
    expect(geometrySpy).not.toHaveBeenCalled();

    expect(store.release('object-1')).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(geometrySpy).toHaveBeenCalledTimes(1);
    expect(store.has('object-1')).toBe(false);
  });

  it('releases each id once and reports a missing release', () => {
    const store = new ImportedModelStore();
    const { root } = makeModel();
    const dispose = vi.fn(() => disposeImportedModel(root));
    store.register('object-1', { root, dispose });

    expect(store.release('object-1')).toBe(true);
    expect(store.release('object-1')).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes the previous entry when an id is registered twice', () => {
    const store = new ImportedModelStore();
    const first = makeModel();
    const second = makeModel();
    const firstDispose = vi.fn(() => disposeImportedModel(first.root));

    store.register('object-1', { root: first.root, dispose: firstDispose });
    store.register('object-1', {
      root: second.root,
      dispose: () => disposeImportedModel(second.root),
    });

    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(1);
    store.clear();
  });
});

describe('buildSceneObject — imported objects', () => {
  it('wraps the model with the scene identity and transform', () => {
    const store = new ImportedModelStore();
    const { root } = makeModel();
    store.register('import-1', { root, dispose: () => disposeImportedModel(root) });

    const object = createImportedSceneObject('import-1', meta(), {
      position: { x: 10, y: 0, z: -5 },
      rotation: { x: 0, y: 90, z: 0 },
      scale: { x: 2, y: 2, z: 2 },
    });

    const built = buildSceneObject(object, { imported: store });

    expect(built.group.name).toBe('object:import-1');
    expect(built.group.userData.sceneObjectId).toBe('import-1');
    expect(built.group.position.toArray()).toEqual([10, 0, -5]);
    expect(built.group.scale.toArray()).toEqual([2, 2, 2]);
    expect(built.group.rotation.y).toBeCloseTo(Math.PI / 2);
    // Hierarchy and node names survive the wrap.
    expect(built.group.getObjectByName('ImportedRoot')).toBeTruthy();
    expect(built.group.getObjectByName('Seat')).toBeTruthy();

    built.dispose();
    store.clear();
  });

  it('reports a missing registration instead of rendering nothing', () => {
    const object = createImportedSceneObject('import-1', meta());
    expect(() => buildSceneObject(object, { imported: new ImportedModelStore() })).toThrow(
      SceneObjectBuildError,
    );
    expect(() => buildSceneObject(object)).toThrow(SceneObjectBuildError);
  });

  it('does not dispose the shared model when the wrapper is disposed', () => {
    const store = new ImportedModelStore();
    const { root, geometry } = makeModel();
    store.register('import-1', { root, dispose: () => disposeImportedModel(root) });

    const built = buildSceneObject(createImportedSceneObject('import-1', meta()), {
      imported: store,
    });
    const geometrySpy = vi.spyOn(geometry, 'dispose');

    built.dispose();
    expect(geometrySpy).not.toHaveBeenCalled();

    store.release('import-1');
    expect(geometrySpy).toHaveBeenCalledTimes(1);
  });

  it('leaves parametric objects untouched', () => {
    const table = createFurnitureSceneObject('table', 'table-1');
    const built = buildSceneObject(table, { imported: new ImportedModelStore() });
    expect(built.group.name).toBe('object:table-1');
    expect(built.group.children.length).toBeGreaterThan(0);
    built.dispose();
  });

  it('keys imported geometry by the source hash', () => {
    const a = createImportedSceneObject('import-1', meta({ sourceHash: 'a'.repeat(64) }));
    const b = createImportedSceneObject('import-1', meta({ sourceHash: 'c'.repeat(64) }));
    expect(sceneObjectGeometryKey(a)).not.toBe(sceneObjectGeometryKey(b));
    expect(sceneObjectGeometryKey(a)).toBe(sceneObjectGeometryKey(a));
  });
});

describe('app-wide store', () => {
  it('starts empty and stays usable across calls', () => {
    importedModelStore.clear();
    expect(importedModelStore.size).toBe(0);
    expect(importedModelStore.acquire('anything')).toBeNull();
  });
});
