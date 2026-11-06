import { describe, expect, it } from 'vitest';
import { sceneReducer } from './sceneReducer';
import { validateSceneData, validateSceneObject } from './sceneValidation';
import {
  IMPORTED_BOUNDS_LIMIT_CM,
  IMPORTED_OBJECT_TYPE,
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createDefaultSceneState,
  createFurnitureSceneObject,
  createImportedSceneObject,
  isFurnitureSceneObject,
  isImportedSceneObject,
  type ImportedModelMeta,
} from './types';
import { createDefaultSettings } from './sceneSettings';

const HASH = 'a'.repeat(64);

function meta(overrides: Partial<ImportedModelMeta> = {}): ImportedModelMeta {
  return {
    format: 'glb',
    fileName: 'stul.glb',
    sourceBytes: 2048,
    meshes: 2,
    triangles: 120,
    materials: 1,
    textures: 1,
    sourceHash: HASH,
    boundsCm: { min: { x: -20, y: 0, z: -20 }, max: { x: 20, y: 90, z: 20 } },
    ...overrides,
  };
}

/** The stored JSON shape, as a project file or server payload would carry it. */
function storedImported(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'import-1',
    type: 'imported',
    kind: 'imported',
    name: 'Stul',
    position: { x: 10, y: 0, z: -5 },
    rotation: { x: 0, y: 45, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    params: {},
    material: { metalness: 0.1, roughness: 0.5 },
    imported: meta(),
    ...overrides,
  };
}

function sceneWith(objects: unknown[]): Record<string, unknown> {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects,
    settings: createDefaultSettings(),
  };
}

describe('imported scene object — validation', () => {
  it('accepts a well-formed imported record and keeps its metadata', () => {
    const object = validateSceneObject(storedImported());
    expect(object).not.toBeNull();
    expect(object?.type).toBe(IMPORTED_OBJECT_TYPE);
    expect(object?.kind).toBe('imported');
    expect(object?.name).toBe('Stul');
    expect(object?.position).toEqual({ x: 10, y: 0, z: -5 });
    expect(object?.rotation).toEqual({ x: 0, y: 45, z: 0 });
    expect(object?.imported).toEqual(meta());
  });

  it('derives the name from the file name when none is stored', () => {
    const object = validateSceneObject(storedImported({ name: '   ' }));
    expect(object?.name).toBe('stul.glb');
  });

  it('rejects metadata on an object that is not type "imported"', () => {
    expect(validateSceneObject(storedImported({ type: 'table' }))).toBeNull();
  });

  it('drops a stored "imported" object that has no metadata (no geometry to restore)', () => {
    const withoutMeta = storedImported();
    delete withoutMeta.imported;
    expect(validateSceneObject(withoutMeta)).toBeNull();
  });

  it('rejects an unsupported format', () => {
    expect(validateSceneObject(storedImported({ imported: meta({ format: 'obj' as 'glb' }) }))).toBeNull();
  });

  it('rejects a non-sha256 source hash', () => {
    expect(validateSceneObject(storedImported({ imported: meta({ sourceHash: 'abc' }) }))).toBeNull();
    expect(
      validateSceneObject(storedImported({ imported: meta({ sourceHash: HASH.toUpperCase() }) })),
    ).toBeNull();
  });

  it('rejects negative, fractional or non-finite counts instead of repairing them', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validateSceneObject(storedImported({ imported: meta({ triangles: bad }) }))).toBeNull();
    }
    expect(
      validateSceneObject(storedImported({ imported: meta({ sourceBytes: 0 }) })),
    ).toBeNull();
  });

  it('rejects an empty or control-character file name', () => {
    expect(validateSceneObject(storedImported({ imported: meta({ fileName: '' }) }))).toBeNull();
    expect(
      validateSceneObject(storedImported({ imported: meta({ fileName: 'a\u0000b.glb' }) })),
    ).toBeNull();
  });

  it('rejects bounds that are inverted, non-finite or beyond the accepted limit', () => {
    const inverted = meta({
      boundsCm: { min: { x: 10, y: 0, z: 0 }, max: { x: -10, y: 10, z: 10 } },
    });
    expect(validateSceneObject(storedImported({ imported: inverted }))).toBeNull();

    const nonFinite = meta({
      boundsCm: { min: { x: 0, y: 0, z: 0 }, max: { x: Number.NaN, y: 1, z: 1 } },
    });
    expect(validateSceneObject(storedImported({ imported: nonFinite }))).toBeNull();

    const tooLarge = meta({
      boundsCm: {
        min: { x: 0, y: 0, z: 0 },
        max: { x: IMPORTED_BOUNDS_LIMIT_CM + 1, y: 1, z: 1 },
      },
    });
    expect(validateSceneObject(storedImported({ imported: tooLarge }))).toBeNull();
  });

  it('does not accept manufacturing assignments on an imported object', () => {
    const object = validateSceneObject(
      storedImported({ sheetMaterials: [{ partId: 'p1', materialId: 'mdf', thicknessMm: 18 }] }),
    );
    expect(object?.sheetMaterials).toBeUndefined();
  });

  it('keeps every legacy parametric object byte-identical', () => {
    const legacy = createFurnitureSceneObject('table', 't-1');
    const validated = validateSceneObject(JSON.parse(JSON.stringify(legacy)));
    expect(validated).toEqual(legacy);
    expect(validated && 'kind' in validated).toBe(false);
    expect(validated && 'imported' in validated).toBe(false);
  });
});

describe('imported scene object — guards', () => {
  it('narrows imported and parametric objects to opposite sides', () => {
    const imported = createImportedSceneObject('i-1', meta());
    const table = createFurnitureSceneObject('table', 't-1');

    expect(isImportedSceneObject(imported)).toBe(true);
    expect(isFurnitureSceneObject(imported)).toBe(false);
    expect(isImportedSceneObject(table)).toBe(false);
    expect(isFurnitureSceneObject(table)).toBe(true);
  });

  it('creates an imported object with the file name and a neutral transform', () => {
    const object = createImportedSceneObject('i-1', meta({ fileName: 'javon.glb' }));
    expect(object.type).toBe(IMPORTED_OBJECT_TYPE);
    expect(object.kind).toBe('imported');
    expect(object.name).toBe('javon.glb');
    expect(object.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(object.visible).toBe(true);
  });
});

describe('imported scene object — reducer', () => {
  it('adds the object and selects it', () => {
    const next = sceneReducer(createDefaultSceneState(() => 'base'), {
      type: 'ADD_IMPORTED_OBJECT',
      id: 'import-1',
      imported: meta(),
    });

    expect(next.data.objects).toHaveLength(2);
    const added = next.data.objects[1];
    expect(added.type).toBe(IMPORTED_OBJECT_TYPE);
    expect(added.imported).toEqual(meta());
    expect(next.selectedId).toBe('import-1');
  });

  it('refuses metadata its own loader would drop, leaving the scene unchanged', () => {
    const state = createDefaultSceneState(() => 'base');
    const next = sceneReducer(state, {
      type: 'ADD_IMPORTED_OBJECT',
      id: 'import-1',
      imported: meta({ sourceHash: 'not-a-hash' }),
    });
    expect(next).toBe(state);
  });

  it('deletes an imported object like any other', () => {
    const added = sceneReducer(createDefaultSceneState(() => 'base'), {
      type: 'ADD_IMPORTED_OBJECT',
      id: 'import-1',
      imported: meta(),
    });
    const removed = sceneReducer(added, { type: 'DELETE_OBJECT', id: 'import-1' });
    expect(removed.data.objects.some((object) => object.id === 'import-1')).toBe(false);
  });

  it('ignores parameter writes: an imported model has no furniture parameters', () => {
    const added = sceneReducer(createDefaultSceneState(() => 'base'), {
      type: 'ADD_IMPORTED_OBJECT',
      id: 'import-1',
      imported: meta(),
    });
    const before = added.data.objects.find((object) => object.id === 'import-1');
    const next = sceneReducer(added, {
      type: 'UPDATE_PARAMS',
      id: 'import-1',
      params: { ...before!.params, widthCm: 999 },
    });
    expect(next.data.objects.find((object) => object.id === 'import-1')?.params).toEqual(
      before!.params,
    );
  });
});

describe('imported scene object — whole-scene validation', () => {
  it('keeps a valid imported object and drops a corrupt one', () => {
    const result = validateSceneData(
      sceneWith([
        storedImported(),
        storedImported({ id: 'broken', imported: meta({ sourceHash: 'nope' }) }),
      ]),
    );
    expect(result.scene?.objects).toHaveLength(1);
    expect(result.scene?.objects[0].id).toBe('import-1');
    expect(result.droppedObjects).toBe(1);
  });

  it('round-trips an imported object through JSON without changing it', () => {
    const validated = validateSceneObject(storedImported());
    expect(validated).not.toBeNull();
    const again = validateSceneObject(JSON.parse(JSON.stringify(validated)));
    expect(again).toEqual(validated);
  });

  it('accepts an imported object in a scene alongside furniture', () => {
    const result = validateSceneData(
      sceneWith([createFurnitureSceneObject('table', 't-1'), storedImported()]),
    );
    expect(result.scene?.objects.map((object) => object.type)).toEqual(['table', 'imported']);
    expect(result.droppedObjects).toBe(0);
  });
});
