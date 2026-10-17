import { describe, expect, it } from 'vitest';
import { resolveEditTarget, validateSceneOps, type SceneOpsResult } from './sceneTargets';
import {
  MAX_OPS_PER_PROPOSAL,
  MAX_OBJECT_ID_LENGTH,
  type EditOpErrorCode,
} from './sceneDiff';
import { createDefaultSettings } from './sceneSettings';
import {
  ROOM_DEFAULTS,
  ROOM_OBJECT_ID,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  type SceneAssembly,
  type SceneData,
  type SceneObject,
} from './types';

function sceneWith(objects: SceneObject[], assemblies?: SceneAssembly[]): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects,
    settings: createDefaultSettings(),
    ...(assemblies ? { assemblies } : {}),
  };
}

function wardrobe(id = 'wardrobe-1'): SceneObject {
  return createFurnitureSceneObject('wardrobe', id);
}

function table(id = 'table-1'): SceneObject {
  return createFurnitureSceneObject('table', id);
}

function twoObjects(): SceneData {
  return sceneWith([wardrobe(), table()]);
}

function expectOpsRejected(result: SceneOpsResult, code: string, index?: number): void {
  if (result.ok) {
    throw new Error(`expected rejection «${code}», got an accepted set`);
  }
  expect(result.code).toBe(code);
  expect(result.message.length).toBeGreaterThan(0);
  if (index !== undefined) {
    expect(result.index).toBe(index);
  }
}

/** Freezing makes any write inside `validateSceneOps` throw in strict mode. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

describe('resolveEditTarget', () => {
  it('resolves an existing furniture object', () => {
    const scene = twoObjects();
    const result = resolveEditTarget(scene, 'table-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.object).toBe(scene.objects[1]);
      expect(result.object.type).toBe('table');
    }
  });

  it('reports an unknown id', () => {
    const result = resolveEditTarget(twoObjects(), 'missing-object');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('unknown_object');
    }
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['too long', 'a'.repeat(MAX_OBJECT_ID_LENGTH + 1)],
    ['space', 'table 1'],
    ['dot', 'table.1'],
    ['slash', '../table'],
    ['non-string', 7],
    ['null', null],
    ['undefined', undefined],
    ['object', { id: 'table-1' }],
  ])('rejects an invalid objectId: %s', (_label, objectId) => {
    const result = resolveEditTarget(twoObjects(), objectId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_object_id');
    }
  });

  it('rejects the room pseudo-id with its own code', () => {
    const result = resolveEditTarget(twoObjects(), ROOM_OBJECT_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('room_not_editable');
    }
  });

  it('rejects an assembly id instead of treating it as a furniture object', () => {
    const scene = sceneWith(
      [wardrobe()],
      [{ id: 'asm-1', kind: 'wall-cabinet', params: {} }],
    );
    const result = resolveEditTarget(scene, 'asm-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('assembly_not_editable');
    }
  });

  it('prefers a stored object when an assembly shares its id', () => {
    const scene = sceneWith(
      [wardrobe()],
      [{ id: 'wardrobe-1', kind: 'wall-cabinet', params: {} }],
    );
    const result = resolveEditTarget(scene, 'wardrobe-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.object.type).toBe('wardrobe');
    }
  });

  it('treats a scene without assemblies as having none', () => {
    const scene = sceneWith([wardrobe()]);
    expect(scene.assemblies).toBeUndefined();
    const result = resolveEditTarget(scene, 'asm-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('unknown_object');
    }
  });
});

describe('validateSceneOps — acceptance', () => {
  it('accepts a valid single operator and returns the resolved object', () => {
    const scene = twoObjects();
    const result = validateSceneOps(scene, [
      { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } },
    ]);

    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.object).toBe(scene.objects[0]);
    expect(result.ops).toEqual([
      { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } },
    ]);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ kind: 'param', field: 'widthCm', after: 200 });
  });

  it('accepts several operators on the same object in a deterministic order', () => {
    const result = validateSceneOps(twoObjects(), [
      { op: 'rename', objectId: 'wardrobe-1', name: 'Yangi shkaf' },
      { op: 'set_params', objectId: 'wardrobe-1', params: { heightCm: 210, widthCm: 200 } },
      { op: 'set_visibility', objectId: 'wardrobe-1', visible: false },
    ]);

    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.changes.map((change) => `${change.kind}:${change.field}`)).toEqual([
      'param:heightCm',
      'param:widthCm',
      'name:name',
      'visibility:visible',
    ]);
  });
});

describe('validateSceneOps — target resolution', () => {
  it('rejects an unknown object id at its index', () => {
    expectOpsRejected(
      validateSceneOps(twoObjects(), [
        { op: 'rename', objectId: 'wardrobe-1', name: 'Shkaf' },
        { op: 'rename', objectId: 'ghost', name: 'Shkaf' },
      ]),
      'unknown_object',
      1,
    );
  });

  it('rejects an invalid id at the first position', () => {
    expectOpsRejected(
      validateSceneOps(twoObjects(), [{ op: 'rename', objectId: '', name: 'Shkaf' }]),
      'invalid_object_id',
      0,
    );
  });

  it('rejects an operator that targets a second object', () => {
    expectOpsRejected(
      validateSceneOps(twoObjects(), [
        { op: 'rename', objectId: 'wardrobe-1', name: 'Shkaf' },
        { op: 'rename', objectId: 'table-1', name: 'Stol' },
      ]),
      'multiple_objects',
      1,
    );
  });

  it('rejects an assembly id targeted as furniture', () => {
    const scene = sceneWith(
      [wardrobe()],
      [{ id: 'asm-1', kind: 'kitchen-base-run', params: {} }],
    );
    expectOpsRejected(
      validateSceneOps(scene, [{ op: 'set_visibility', objectId: 'asm-1', visible: false }]),
      'assembly_not_editable',
      0,
    );
  });

  it('rejects the room as an edit target', () => {
    expectOpsRejected(
      validateSceneOps(twoObjects(), [{ op: 'rename', objectId: ROOM_OBJECT_ID, name: 'X' }]),
      'room_not_editable',
      0,
    );
  });

  it('rejects a reducer action with its index, not a lookup error', () => {
    expectOpsRejected(
      validateSceneOps(twoObjects(), [
        { op: 'rename', objectId: 'wardrobe-1', name: 'Shkaf' },
        { type: 'DELETE_OBJECT', id: 'wardrobe-1' },
      ]),
      'denied_action',
      1,
    );
  });

  it('rejects a mapped reducer action sent as-is', () => {
    expectOpsRejected(
      validateSceneOps(twoObjects(), [
        { type: 'SET_VISIBILITY', id: 'wardrobe-1', visible: false },
      ]),
      'invalid_op',
      0,
    );
  });

  it('rejects an object whose type is not a furniture type', () => {
    const stray = { ...wardrobe('stray'), type: 'lamp' } as unknown as SceneObject;
    const scene = sceneWith([stray]);
    expectOpsRejected(
      validateSceneOps(scene, [{ op: 'rename', objectId: 'stray', name: 'Chiroq' }]),
      'out_of_scope',
      0,
    );
  });
});

describe('validateSceneOps — operator validation', () => {
  it('rejects a parameter that does not belong to the object type', () => {
    expectOpsRejected(
      validateSceneOps(twoObjects(), [
        { op: 'set_params', objectId: 'wardrobe-1', params: { legCount: 4 } },
      ]),
      'unknown_field',
      0,
    );
  });

  it('rejects an out-of-range parameter instead of dropping it', () => {
    expectOpsRejected(
      validateSceneOps(twoObjects(), [
        { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 5000 } },
      ]),
      'out_of_range',
      0,
    );
  });

  it('rejects the whole set when one operator is invalid', () => {
    const result = validateSceneOps(twoObjects(), [
      { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } },
      { op: 'set_params', objectId: 'wardrobe-1', params: { heightCm: 5000 } },
      { op: 'rename', objectId: 'wardrobe-1', name: 'Shkaf' },
    ]);

    expectOpsRejected(result, 'out_of_range', 1);
    expect('ops' in result).toBe(false);
  });

  it('rejects two operators writing the same field', () => {
    expectOpsRejected(
      validateSceneOps(twoObjects(), [
        { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 190 } },
        { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } },
      ]),
      'duplicate_op',
      1,
    );
  });

  it.each([
    ['not an array', {}],
    ['empty', []],
    ['too many', Array.from({ length: MAX_OPS_PER_PROPOSAL + 1 }, () => null)],
  ])('rejects a malformed list: %s', (_label, raw) => {
    expectOpsRejected(validateSceneOps(twoObjects(), raw), 'invalid_op', -1);
  });

  it('rejects a non-object entry at its index', () => {
    expectOpsRejected(
      validateSceneOps(twoObjects(), [{ op: 'rename', objectId: 'wardrobe-1', name: 'X' }, 'nope']),
      'invalid_op',
      1,
    );
  });

  it('reports the same error code as the W15.1 validator', () => {
    const op = { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 5000 } };
    const sceneResult = validateSceneOps(twoObjects(), [op]);
    if (sceneResult.ok) {
      throw new Error('expected rejection');
    }
    // Scene-level results are a strict superset of W15.1 codes; an operator
    // error keeps the same code it would get from `validateOps`.
    const code: EditOpErrorCode | 'multiple_objects' | 'assembly_not_editable' | 'room_not_editable' =
      sceneResult.code;
    expect(code).toBe('out_of_range');
  });
});

describe('validateSceneOps — purity and determinism', () => {
  it('does not mutate the scene', () => {
    const scene = deepFreeze(twoObjects());
    const snapshot = JSON.parse(JSON.stringify(scene));

    validateSceneOps(scene, [
      { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } },
      { op: 'set_visibility', objectId: 'wardrobe-1', visible: false },
    ]);
    validateSceneOps(scene, [{ op: 'rename', objectId: 'ghost', name: 'X' }]);

    expect(scene).toEqual(snapshot);
  });

  it('does not mutate the object it resolves', () => {
    const scene = twoObjects();
    const before = scene.objects[0];
    resolveEditTarget(scene, 'wardrobe-1');
    validateSceneOps(scene, [{ op: 'rename', objectId: 'wardrobe-1', name: 'Yangi' }]);
    expect(scene.objects[0]).toBe(before);
    expect(before.name).not.toBe('Yangi');
  });

  it('returns the same result for the same input', () => {
    const scene = twoObjects();
    const ops = [
      { op: 'set_params', objectId: 'wardrobe-1', params: { heightCm: 210, widthCm: 200 } },
      { op: 'set_visibility', objectId: 'wardrobe-1', visible: false },
    ];
    expect(validateSceneOps(scene, ops)).toEqual(validateSceneOps(scene, ops));
    expect(validateSceneOps(scene, ops)).not.toBe(validateSceneOps(scene, ops));
  });

  it('reports the earliest offending index deterministically', () => {
    const ops = [
      { op: 'set_params', objectId: 'ghost', params: { widthCm: 200 } },
      { op: 'rename', objectId: 'wardrobe-1', name: 'X' },
    ];
    expectOpsRejected(validateSceneOps(twoObjects(), ops), 'unknown_object', 0);
  });
});
