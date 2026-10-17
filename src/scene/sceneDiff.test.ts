import { describe, expect, it } from 'vitest';
import {
  DENIED_REDUCER_ACTIONS,
  EDIT_OPS,
  MAX_OPS_PER_PROPOSAL,
  MAX_OBJECT_ID_LENGTH,
  normalizeAngle,
  validateOp,
  validateOps,
  type EditOpErrorCode,
} from './sceneDiff';
import { createFurnitureSceneObject, type SceneObject } from './types';
import { FURNITURE_TYPES, type FurnitureType } from '../geometry/furniture';

function objectOf(type: FurnitureType = 'wardrobe'): SceneObject {
  return createFurnitureSceneObject(type, `id-${type}`);
}

function expectRejected(result: ReturnType<typeof validateOp>, code: EditOpErrorCode): void {
  if (result.ok) {
    throw new Error(`expected rejection «${code}», got an accepted op`);
  }
  expect(result.code).toBe(code);
  expect(result.message.length).toBeGreaterThan(0);
}

/** One valid dimension change per type, differing from the type's default. */
const VALID_DIMENSION: Record<FurnitureType, number> = {
  table: 100,
  chair: 50,
  armchair: 80,
  sofa: 220,
  bed: 180,
  wardrobe: 200,
  shelf: 100,
  dresser: 130,
};

/** widthCm below every type's minimum. */
const INVALID_DIMENSION = 10;

/** A key that exists in the vocabulary but not for that type. */
const FOREIGN_KEY: Record<FurnitureType, string> = {
  table: 'shelfCount',
  chair: 'legCount',
  armchair: 'drawerCount',
  sofa: 'doorCount',
  bed: 'legCount',
  wardrobe: 'legCount',
  shelf: 'doorCount',
  dresser: 'shelfCount',
};

describe('sceneDiff — allowlist surface', () => {
  it('exposes exactly the seven allowlisted operators', () => {
    expect([...EDIT_OPS]).toEqual([
      'set_params',
      'set_transform',
      'rename',
      'set_material',
      'apply_material_preset',
      'reset_material',
      'set_visibility',
    ]);
  });

  it('denies every reducer action that is not an allowlisted edit', () => {
    // 31 reducer actions = 7 mapped actions + 24 denied ones (W15.2 added
    // SET_VISIBILITY, which the DSL's `set_visibility` maps onto).
    expect(DENIED_REDUCER_ACTIONS).toHaveLength(24);
    expect(new Set(DENIED_REDUCER_ACTIONS).size).toBe(24);
    expect(DENIED_REDUCER_ACTIONS).toContain('TOGGLE_VISIBILITY');
    expect(DENIED_REDUCER_ACTIONS).not.toContain('UPDATE_PARAMS');
    expect(DENIED_REDUCER_ACTIONS).not.toContain('SET_VISIBILITY');
    expect(EDIT_OPS).toHaveLength(7);
    expect(24 + 7).toBe(31);
  });

  it('rejects a reducer action even when the DSL maps onto it', () => {
    // The AI must speak the DSL; handing it a reducer action directly is a
    // contract error, not a shortcut.
    expectRejected(
      validateOp({ type: 'SET_VISIBILITY', id: 'id-wardrobe', visible: false }, objectOf()),
      'invalid_op',
    );
  });

  it.each(['SET_LAYOUT', 'LOAD_SCENE', 'NEW_SCENE', 'DELETE_OBJECT', 'ADD_ASSEMBLY', 'SELECT'])(
    'rejects the reducer action %s even when it is shaped like an op',
    (type) => {
      expectRejected(validateOp({ type }, objectOf()), 'denied_action');
    },
  );

  it('rejects a denied reducer action passed through the `op` field', () => {
    expectRejected(validateOp({ op: 'DELETE_OBJECT', objectId: 'id-wardrobe' }, objectOf()), 'denied_action');
  });

  it('rejects the non-idempotent toggle', () => {
    expectRejected(
      validateOp({ op: 'TOGGLE_VISIBILITY', objectId: 'id-wardrobe' }, objectOf()),
      'denied_action',
    );
  });

  it.each([
    ['unknown op name', { op: 'set_everything', objectId: 'id-wardrobe' }],
    ['missing op', { objectId: 'id-wardrobe' }],
    ['arbitrary path', { op: 'set_params', objectId: 'id-wardrobe', path: 'data.objects[0]' }],
    ['extra action field', { op: 'set_params', objectId: 'id-wardrobe', action: 'SET_LAYOUT' }],
  ])('rejects a structurally invalid operator: %s', (_label, raw) => {
    const result = validateOp(raw, objectOf());
    expect(result.ok).toBe(false);
  });

  it.each([[null], [undefined], [[]], ['op'], [42], [true]])(
    'rejects a non-object operator payload (%s)',
    (raw) => {
      expectRejected(validateOp(raw, objectOf()), 'invalid_op');
    },
  );
});

describe('sceneDiff — object id', () => {
  it('accepts the target object id', () => {
    const object = objectOf();
    const result = validateOp(
      { op: 'set_params', objectId: object.id, params: { widthCm: 200 } },
      object,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects an id that belongs to another object', () => {
    expectRejected(
      validateOp({ op: 'rename', objectId: 'someone-else', name: 'Shkaf' }, objectOf()),
      'unknown_object',
    );
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['too long', 'a'.repeat(MAX_OBJECT_ID_LENGTH + 1)],
    ['space', 'id wardrobe'],
    ['dot', 'id.wardrobe'],
    ['slash', '../id'],
    ['non-string', 7],
  ])('rejects an invalid objectId: %s', (_label, objectId) => {
    expectRejected(validateOp({ op: 'rename', objectId, name: 'Shkaf' }, objectOf()), 'invalid_object_id');
  });

  it('rejects an assembly member (M6)', () => {
    const object = { ...objectOf(), assemblyId: 'asm-1' } as SceneObject;
    expectRejected(validateOp({ op: 'rename', objectId: object.id, name: 'X' }, object), 'out_of_scope');
  });

  it('does not mutate the object it validates against', () => {
    const object = objectOf();
    const snapshot = JSON.parse(JSON.stringify(object));
    validateOp({ op: 'set_params', objectId: object.id, params: { widthCm: 200 } }, object);
    validateOp({ op: 'set_transform', objectId: object.id, rotation: { y: 370 } }, object);
    expect(object).toEqual(snapshot);
  });
});

describe('sceneDiff — set_params', () => {
  it.each([...FURNITURE_TYPES])('accepts a valid dimension for %s', (type) => {
    const object = objectOf(type);
    const width = VALID_DIMENSION[type];
    const result = validateOp(
      { op: 'set_params', objectId: object.id, params: { widthCm: width } },
      object,
    );

    if (!result.ok) {
      throw new Error(`expected acceptance, got ${result.code}`);
    }
    expect(result.op).toEqual({ op: 'set_params', objectId: object.id, params: { widthCm: width } });
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      kind: 'param',
      field: 'widthCm',
      unit: 'sm',
      before: object.params.widthCm,
      after: width,
    });
  });

  it.each([...FURNITURE_TYPES])('rejects an out-of-range dimension for %s', (type) => {
    const object = objectOf(type);
    expectRejected(
      validateOp(
        { op: 'set_params', objectId: object.id, params: { widthCm: INVALID_DIMENSION } },
        object,
      ),
      'out_of_range',
    );
  });

  it.each([...FURNITURE_TYPES])('rejects a parameter of another type for %s', (type) => {
    const object = objectOf(type);
    const key = FOREIGN_KEY[type];
    expectRejected(
      validateOp({ op: 'set_params', objectId: object.id, params: { [key]: 2 } }, object),
      'unknown_field',
    );
  });

  it('rejects an absurdly large but finite value as out of range', () => {
    const object = objectOf();
    expectRejected(
      validateOp({ op: 'set_params', objectId: object.id, params: { widthCm: 1e12 } }, object),
      'out_of_range',
    );
  });

  it.each([
    ['boolean', true],
    ['numeric string', '200'],
    ['null', null],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['object', { value: 200 }],
  ])('rejects a %s value for a numeric channel', (_label, value) => {
    const object = objectOf();
    expectRejected(
      validateOp({ op: 'set_params', objectId: object.id, params: { widthCm: value } }, object),
      'invalid_value',
    );
  });

  it('rejects a fractional value for an integer channel', () => {
    const object = objectOf('table');
    expectRejected(
      validateOp({ op: 'set_params', objectId: object.id, params: { legCount: 4.5 } }, object),
      'invalid_value',
    );
  });

  it('accepts an integer channel at the top of its range and reports the default as no change', () => {
    const object = objectOf('table');
    expect(
      validateOp({ op: 'set_params', objectId: object.id, params: { legCount: 6 } }, object).ok,
    ).toBe(true);
    expectRejected(
      validateOp({ op: 'set_params', objectId: object.id, params: { legCount: 4 } }, object),
      'no_change',
    );
  });

  it('rejects a cross-field violation after merging with the current params', () => {
    const object = objectOf('chair');
    expectRejected(
      validateOp(
        { op: 'set_params', objectId: object.id, params: { heightCm: 40, seatHeightCm: 45 } },
        object,
      ),
      'relation_violation',
    );
  });

  it('rejects an invalid colour', () => {
    const object = objectOf();
    expectRejected(
      validateOp({ op: 'set_params', objectId: object.id, params: { color: 'red' } }, object),
      'invalid_value',
    );
  });

  it('normalizes the colour to lower case', () => {
    const object = objectOf();
    const result = validateOp(
      { op: 'set_params', objectId: object.id, params: { color: '#AABBCC' } },
      object,
    );
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.op).toMatchObject({ params: { color: '#aabbcc' } });
    expect(result.changes[0]).toMatchObject({ field: 'color', after: '#aabbcc' });
  });

  it('rejects empty params', () => {
    const object = objectOf();
    expectRejected(validateOp({ op: 'set_params', objectId: object.id, params: {} }, object), 'invalid_op');
  });

  it('rejects params that are not an object', () => {
    const object = objectOf();
    expectRejected(
      validateOp({ op: 'set_params', objectId: object.id, params: [200] }, object),
      'invalid_op',
    );
  });

  it('reports no change when every proposed value already holds', () => {
    const object = objectOf();
    expectRejected(
      validateOp(
        { op: 'set_params', objectId: object.id, params: { widthCm: object.params.widthCm } },
        object,
      ),
      'no_change',
    );
  });

  it('drops identical channels but keeps the differing one', () => {
    const object = objectOf();
    const result = validateOp(
      {
        op: 'set_params',
        objectId: object.id,
        params: { widthCm: object.params.widthCm, heightCm: 210 },
      },
      object,
    );
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].field).toBe('heightCm');
  });
});

describe('sceneDiff — set_transform', () => {
  it('accepts a position change', () => {
    const object = objectOf();
    const result = validateOp(
      { op: 'set_transform', objectId: object.id, position: { x: 50, z: -30 } },
      object,
    );
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.op).toMatchObject({ position: { x: 50, z: -30 } });
    expect(result.changes.map((change) => change.field)).toEqual(['position.x', 'position.z']);
  });

  it('accepts a scale change within the limits', () => {
    const object = objectOf();
    const result = validateOp({ op: 'set_transform', objectId: object.id, scale: { y: 1.5 } }, object);
    expect(result.ok).toBe(true);
  });

  it.each([
    [370, 10],
    [360, 0],
    [725, 5],
    [-10, 350],
    [-370, 350],
    [0, 0],
  ])('normalizes rotation %s to %s', (input, expected) => {
    expect(normalizeAngle(input)).toBe(expected);
  });

  it.each([
    [370, 10],
    [-10, 350],
    [725, 5],
  ])('applies the normalized rotation %s as %s', (input, expected) => {
    const object = objectOf();
    const result = validateOp(
      { op: 'set_transform', objectId: object.id, rotation: { y: input } },
      object,
    );
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.op).toMatchObject({ rotation: { y: expected } });
    expect(result.changes[0]).toMatchObject({ unit: 'gradus', after: expected });
  });

  it('treats a full turn as no change', () => {
    const object = { ...objectOf(), rotation: { x: 0, y: 10, z: 0 } };
    expectRejected(
      validateOp({ op: 'set_transform', objectId: object.id, rotation: { y: 370 } }, object),
      'no_change',
    );
  });

  it('rejects a position outside the limits instead of clamping it', () => {
    const object = objectOf();
    expectRejected(
      validateOp({ op: 'set_transform', objectId: object.id, position: { x: 5000 } }, object),
      'out_of_range',
    );
  });

  it('rejects a scale outside the limits instead of clamping it', () => {
    const object = objectOf();
    expectRejected(
      validateOp({ op: 'set_transform', objectId: object.id, scale: { y: 0.05 } }, object),
      'out_of_range',
    );
  });

  it('rejects a negative floor height', () => {
    const object = objectOf();
    expectRejected(
      validateOp({ op: 'set_transform', objectId: object.id, position: { y: -5 } }, object),
      'out_of_range',
    );
  });

  it('rejects an unknown axis', () => {
    const object = objectOf();
    expectRejected(
      validateOp({ op: 'set_transform', objectId: object.id, rotation: { w: 10 } }, object),
      'unknown_field',
    );
  });

  it.each([[Number.NaN], [Number.POSITIVE_INFINITY], ['10'], [true]])(
    'rejects a non-finite transform value (%s)',
    (value) => {
      const object = objectOf();
      expectRejected(
        validateOp({ op: 'set_transform', objectId: object.id, position: { x: value } }, object),
        'invalid_value',
      );
    },
  );

  it('rejects an empty transform group', () => {
    const object = objectOf();
    expectRejected(
      validateOp({ op: 'set_transform', objectId: object.id, position: {} }, object),
      'invalid_op',
    );
  });

  it('rejects a transform with no groups', () => {
    const object = objectOf();
    expectRejected(validateOp({ op: 'set_transform', objectId: object.id }, object), 'invalid_op');
  });
});

describe('sceneDiff — rename', () => {
  it('accepts and trims a name', () => {
    const object = objectOf();
    const result = validateOp({ op: 'rename', objectId: object.id, name: '  Yangi shkaf  ' }, object);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.op).toMatchObject({ name: 'Yangi shkaf' });
    expect(result.changes[0]).toMatchObject({ kind: 'name', after: 'Yangi shkaf' });
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['too long', 'a'.repeat(61)],
    ['control char', 'Shkaf\u0007'],
    ['newline', 'Shkaf\n2'],
  ])('rejects an invalid name: %s', (_label, name) => {
    const object = objectOf();
    expectRejected(validateOp({ op: 'rename', objectId: object.id, name }, object), 'invalid_value');
  });

  it('rejects a non-string name', () => {
    const object = objectOf();
    expectRejected(validateOp({ op: 'rename', objectId: object.id, name: 7 }, object), 'invalid_value');
  });

  it('accepts a 60-character name', () => {
    const object = objectOf();
    const result = validateOp({ op: 'rename', objectId: object.id, name: 'a'.repeat(60) }, object);
    expect(result.ok).toBe(true);
  });

  it('reports no change for the same name', () => {
    const object = objectOf();
    expectRejected(
      validateOp({ op: 'rename', objectId: object.id, name: object.name }, object),
      'no_change',
    );
  });
});

describe('sceneDiff — set_material', () => {
  it('accepts material channels within range', () => {
    const object = objectOf();
    const result = validateOp(
      { op: 'set_material', objectId: object.id, metalness: 0.5, roughness: 0.25 },
      object,
    );
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.op).toMatchObject({ metalness: 0.5, roughness: 0.25 });
    expect(result.changes).toHaveLength(2);
  });

  it.each([
    ['metalness above 1', { metalness: 1.5 }],
    ['roughness below 0', { roughness: -0.1 }],
    ['opacity below the model minimum', { opacity: 0.05 }],
    ['opacity above 1', { opacity: 2 }],
  ])('rejects an out-of-range value: %s', (_label, patch) => {
    const object = objectOf();
    expectRejected(validateOp({ op: 'set_material', objectId: object.id, ...patch }, object), 'out_of_range');
  });

  it.each(['textureScale', 'normalStrength', 'materialId'])(
    'rejects %s, which is out of the v1 scope (D-W15-7)',
    (key) => {
      const object = objectOf();
      expectRejected(
        validateOp({ op: 'set_material', objectId: object.id, [key]: 1 }, object),
        'out_of_scope',
      );
    },
  );

  it('rejects a boolean channel value', () => {
    const object = objectOf();
    expectRejected(
      validateOp({ op: 'set_material', objectId: object.id, metalness: true }, object),
      'invalid_value',
    );
  });

  it('rejects an empty material op', () => {
    const object = objectOf();
    expectRejected(validateOp({ op: 'set_material', objectId: object.id }, object), 'invalid_op');
  });

  it('reports no change when the channel already holds the value', () => {
    const object = objectOf();
    expectRejected(
      validateOp(
        { op: 'set_material', objectId: object.id, metalness: object.material.metalness },
        object,
      ),
      'no_change',
    );
  });
});

describe('sceneDiff — material preset', () => {
  it('accepts a known preset and lists the preset change first in kind order', () => {
    const object = objectOf();
    const result = validateOp(
      { op: 'apply_material_preset', objectId: object.id, presetId: 'wood-oak' },
      object,
    );
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.changes.map((change) => `${change.kind}:${change.field}`)).toEqual([
      'material:metalness',
      'material:roughness',
      'preset:materialId',
    ]);
  });

  it.each(['nope', '', 'WOOD-OAK'])('rejects an unknown preset: %s', (presetId) => {
    const object = objectOf();
    expectRejected(
      validateOp({ op: 'apply_material_preset', objectId: object.id, presetId }, object),
      'invalid_preset',
    );
  });

  it('reports no change for the already applied default preset', () => {
    const object = objectOf();
    expectRejected(
      validateOp({ op: 'apply_material_preset', objectId: object.id, presetId: 'default' }, object),
      'no_change',
    );
  });

  it('resets a changed material back to the model defaults', () => {
    const object: SceneObject = {
      ...objectOf(),
      material: { metalness: 0, roughness: 0.65, materialId: 'wood-oak', opacity: 0.5 },
    };
    const result = validateOp({ op: 'reset_material', objectId: object.id }, object);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.changes.map((change) => change.field)).toEqual([
      'metalness',
      'opacity',
      'roughness',
      'materialId',
    ]);
  });

  it('reports no change when the material is already default', () => {
    const object = objectOf();
    expectRejected(
      validateOp({ op: 'reset_material', objectId: object.id }, object),
      'no_change',
    );
  });
});

describe('sceneDiff — set_visibility', () => {
  it('accepts an explicit false', () => {
    const object = objectOf();
    const result = validateOp({ op: 'set_visibility', objectId: object.id, visible: false }, object);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.op).toEqual({ op: 'set_visibility', objectId: object.id, visible: false });
    expect(result.changes[0]).toMatchObject({ kind: 'visibility', before: true, after: false });
  });

  it('is idempotent: repeating the same target reports no change', () => {
    const object: SceneObject = { ...objectOf(), visible: false };
    expectRejected(
      validateOp({ op: 'set_visibility', objectId: object.id, visible: false }, object),
      'no_change',
    );
  });

  it.each([['true'], [1], [0], [null], [undefined]])(
    'rejects a non-boolean visibility (%s)',
    (visible) => {
      const object = objectOf();
      expectRejected(
        validateOp({ op: 'set_visibility', objectId: object.id, visible }, object),
        'invalid_value',
      );
    },
  );
});

describe('sceneDiff — validateOps (atomic)', () => {
  it('accepts a valid list and sorts the changes deterministically', () => {
    const object = objectOf();
    const result = validateOps(
      [
        { op: 'rename', objectId: object.id, name: 'Yangi shkaf' },
        { op: 'set_params', objectId: object.id, params: { heightCm: 210, widthCm: 200 } },
        { op: 'set_visibility', objectId: object.id, visible: false },
      ],
      object,
    );
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.ops).toHaveLength(3);
    expect(result.changes.map((change) => `${change.kind}:${change.field}`)).toEqual([
      'param:heightCm',
      'param:widthCm',
      'name:name',
      'visibility:visible',
    ]);
  });

  it('rejects the whole list when one operator is invalid', () => {
    const object = objectOf();
    const result = validateOps(
      [
        { op: 'set_params', objectId: object.id, params: { widthCm: 200 } },
        { op: 'set_params', objectId: object.id, params: { heightCm: 5000 } },
        { op: 'rename', objectId: object.id, name: 'Yangi' },
      ],
      object,
    );
    if (result.ok) {
      throw new Error('expected rejection');
    }
    expect(result.index).toBe(1);
    expect(result.code).toBe('out_of_range');
    expect('ops' in result).toBe(false);
  });

  it('rejects a list with a denied action anywhere in it', () => {
    const object = objectOf();
    const result = validateOps(
      [
        { op: 'rename', objectId: object.id, name: 'X' },
        { type: 'DELETE_OBJECT', id: object.id },
      ],
      object,
    );
    if (result.ok) {
      throw new Error('expected rejection');
    }
    expect(result.index).toBe(1);
    expect(result.code).toBe('denied_action');
  });

  it.each([
    ['not an array', {}],
    ['empty', []],
    ['too many', Array.from({ length: MAX_OPS_PER_PROPOSAL + 1 }, () => null)],
  ])('rejects an invalid list: %s', (_label, raw) => {
    const result = validateOps(raw, objectOf());
    expect(result.ok).toBe(false);
  });

  it('rejects two operators writing the same field', () => {
    const object = objectOf();
    const result = validateOps(
      [
        { op: 'set_params', objectId: object.id, params: { widthCm: 190 } },
        { op: 'set_params', objectId: object.id, params: { widthCm: 200 } },
      ],
      object,
    );
    if (result.ok) {
      throw new Error('expected rejection');
    }
    expect(result.code).toBe('duplicate_op');
    expect(result.index).toBe(1);
  });

  it('rejects an exact duplicate operator', () => {
    const object = objectOf();
    const op = { op: 'rename', objectId: object.id, name: 'X' };
    const result = validateOps([op, { ...op }], object);
    if (result.ok) {
      throw new Error('expected rejection');
    }
    expect(result.code).toBe('duplicate_op');
  });

  it('accepts two different params of the same object', () => {
    const object = objectOf();
    const result = validateOps(
      [
        { op: 'set_params', objectId: object.id, params: { widthCm: 190 } },
        { op: 'set_params', objectId: object.id, params: { heightCm: 210 } },
      ],
      object,
    );
    expect(result.ok).toBe(true);
  });

  it('accepts exactly MAX_OPS_PER_PROPOSAL distinct operators', () => {
    const object = objectOf();
    const result = validateOps(
      [
        { op: 'set_params', objectId: object.id, params: { widthCm: 190 } },
        { op: 'set_params', objectId: object.id, params: { heightCm: 210 } },
        { op: 'set_params', objectId: object.id, params: { depthCm: 70 } },
        { op: 'set_params', objectId: object.id, params: { shelfCount: 5 } },
        { op: 'rename', objectId: object.id, name: 'Shkaf 2' },
        { op: 'set_material', objectId: object.id, metalness: 0.2 },
        { op: 'set_transform', objectId: object.id, position: { x: 10 } },
        { op: 'set_visibility', objectId: object.id, visible: false },
      ],
      object,
    );
    expect(result.ok).toBe(true);
  });
});

describe('sceneDiff — determinism', () => {
  it('returns the same result for the same input', () => {
    const object = objectOf();
    const raw = [
      { op: 'set_params', objectId: object.id, params: { heightCm: 210, widthCm: 200 } },
      { op: 'set_transform', objectId: object.id, rotation: { y: 370 } },
    ];
    expect(validateOps(raw, object)).toEqual(validateOps(raw, object));
  });

  it('does not depend on the key order of the input params', () => {
    const object = objectOf();
    const first = validateOp(
      { op: 'set_params', objectId: object.id, params: { widthCm: 200, heightCm: 210 } },
      object,
    );
    const second = validateOp(
      { op: 'set_params', objectId: object.id, params: { heightCm: 210, widthCm: 200 } },
      object,
    );
    if (!first.ok || !second.ok) {
      throw new Error('expected both to be accepted');
    }
    expect(first.changes).toEqual(second.changes);
  });
});
