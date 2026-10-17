import { describe, expect, it } from 'vitest';
import {
  MAX_DIFF_WARNINGS,
  MAX_WARNING_LENGTH,
  buildDiff,
  type BuildDiffResult,
} from './buildDiff';
import { EDIT_SCHEMA_VERSION, MAX_OPS_PER_PROPOSAL } from './sceneDiff';
import { sceneReducer } from './sceneReducer';
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

function scene(): SceneData {
  return sceneWith([wardrobe(), table()]);
}

const VALID_OPS = [{ op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } }];

function expectRejected(result: BuildDiffResult, code: string, index?: number): void {
  if (result.ok) {
    throw new Error(`expected rejection «${code}», got a diff`);
  }
  expect(result.code).toBe(code);
  expect(result.message.length).toBeGreaterThan(0);
  if (index !== undefined) {
    expect(result.index).toBe(index);
  }
  expect('diff' in result).toBe(false);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

describe('buildDiff — success shape', () => {
  it('builds a diff from a valid operator set', () => {
    const result = buildDiff(scene(), VALID_OPS, { baseVersion: 7 });

    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.diff).toEqual({
      schemaVersion: EDIT_SCHEMA_VERSION,
      objectId: 'wardrobe-1',
      objectType: 'wardrobe',
      baseVersion: 7,
      changes: [
        {
          kind: 'param',
          field: 'widthCm',
          label: 'Kenglik (sm)',
          unit: 'sm',
          before: 180,
          after: 200,
        },
      ],
      warnings: [],
    });
  });

  it('attaches the resolved objectId and objectType, not the raw input', () => {
    const result = buildDiff(scene(), [{ op: 'rename', objectId: '  table-1  ', name: 'Yangi' }], {
      baseVersion: 1,
    });

    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.diff.objectId).toBe('table-1');
    expect(result.diff.objectType).toBe('table');
  });

  it('stamps the schema version', () => {
    const result = buildDiff(scene(), VALID_OPS, { baseVersion: 3 });
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.diff.schemaVersion).toBe(EDIT_SCHEMA_VERSION);
    expect(EDIT_SCHEMA_VERSION).toBe(1);
  });

  it('keeps several distinct field edits on one object', () => {
    const result = buildDiff(
      scene(),
      [
        { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200, heightCm: 210 } },
        { op: 'set_transform', objectId: 'wardrobe-1', position: { x: 30 } },
        { op: 'rename', objectId: 'wardrobe-1', name: 'Katta shkaf' },
        { op: 'set_material', objectId: 'wardrobe-1', metalness: 0.2 },
        { op: 'set_visibility', objectId: 'wardrobe-1', visible: false },
      ],
      { baseVersion: 7 },
    );

    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.diff.changes.map((change) => `${change.kind}:${change.field}`)).toEqual([
      'param:heightCm',
      'param:widthCm',
      'transform:position.x',
      'name:name',
      'material:metalness',
      'visibility:visible',
    ]);
  });

  it('carries normalized provider warnings', () => {
    const result = buildDiff(scene(), VALID_OPS, {
      baseVersion: 1,
      warnings: ['  Ehtiyot bo\u2019ling  ', '', 'Ikkinchi ogohlantirish', 'Ehtiyot bo\u2019ling'],
    });

    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.diff.warnings).toEqual(['Ehtiyot bo\u2019ling', 'Ikkinchi ogohlantirish']);
  });

  it('does not mutate the ops array it receives', () => {
    const ops = [{ op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200, heightCm: 210 } }];
    const snapshot = JSON.parse(JSON.stringify(ops));
    buildDiff(scene(), ops, { baseVersion: 1 });
    expect(ops).toEqual(snapshot);
  });
});

describe('buildDiff — rejection', () => {
  it('rejects an empty operator list', () => {
    expectRejected(buildDiff(scene(), [], { baseVersion: 1 }), 'invalid_op', -1);
  });

  it.each([
    ['not an array', {}],
    ['null', null],
    ['too many', Array.from({ length: MAX_OPS_PER_PROPOSAL + 1 }, () => null)],
  ])('rejects a malformed list: %s', (_label, raw) => {
    expectRejected(buildDiff(scene(), raw, { baseVersion: 1 }), 'invalid_op', -1);
  });

  it('rejects an invalid operator at its index', () => {
    expectRejected(
      buildDiff(
        scene(),
        [
          { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } },
          { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 5000 } },
        ],
        { baseVersion: 1 },
      ),
      'out_of_range',
      1,
    );
  });

  it('rejects an unknown object id', () => {
    expectRejected(
      buildDiff(scene(), [{ op: 'rename', objectId: 'ghost', name: 'X' }], { baseVersion: 1 }),
      'unknown_object',
      0,
    );
  });

  it('rejects two operators writing the same field', () => {
    expectRejected(
      buildDiff(
        scene(),
        [
          { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 190 } },
          { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } },
        ],
        { baseVersion: 1 },
      ),
      'duplicate_op',
      1,
    );
  });

  it('rejects a colour written by both a param edit and a preset', () => {
    // The two operators use different duplicate keys in W15.1
    // (`param:color` vs `preset`), yet both write the same displayed field.
    expectRejected(
      buildDiff(
        scene(),
        [
          { op: 'set_params', objectId: 'wardrobe-1', params: { color: '#123456' } },
          { op: 'apply_material_preset', objectId: 'wardrobe-1', presetId: 'metal-steel' },
        ],
        { baseVersion: 1 },
      ),
      'duplicate_change',
      -1,
    );
  });

  it('rejects a material channel written by both a preset and a direct edit', () => {
    expectRejected(
      buildDiff(
        scene(),
        [
          { op: 'apply_material_preset', objectId: 'wardrobe-1', presetId: 'wood-oak' },
          { op: 'set_material', objectId: 'wardrobe-1', metalness: 0.2 },
        ],
        { baseVersion: 1 },
      ),
      'duplicate_change',
      -1,
    );
  });

  it('rejects an operator that changes nothing', () => {
    expectRejected(
      buildDiff(scene(), [{ op: 'rename', objectId: 'wardrobe-1', name: 'Shkaf' }], {
        baseVersion: 1,
      }),
      'no_change',
    );
  });

  it('rejects an arbitrary JSON path', () => {
    expectRejected(
      buildDiff(
        scene(),
        [{ op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 }, path: 'a.b' }],
        { baseVersion: 1 },
      ),
      'unknown_field',
      0,
    );
  });
});

describe('buildDiff — baseVersion', () => {
  it.each([
    ['missing', {}],
    ['zero', { baseVersion: 0 }],
    ['negative', { baseVersion: -1 }],
    ['fractional', { baseVersion: 1.5 }],
    ['NaN', { baseVersion: Number.NaN }],
    ['Infinity', { baseVersion: Number.POSITIVE_INFINITY }],
    ['string', { baseVersion: '3' }],
    ['null', { baseVersion: null }],
  ])('rejects an unusable baseVersion: %s', (_label, options) => {
    expectRejected(
      buildDiff(scene(), VALID_OPS, options as unknown as { baseVersion: number }),
      'invalid_base_version',
      -1,
    );
  });

  it('rejects a missing options argument instead of defaulting the version', () => {
    expectRejected(
      buildDiff(scene(), VALID_OPS, undefined as unknown as { baseVersion: number }),
      'invalid_base_version',
      -1,
    );
  });

  it('never substitutes a placeholder version', () => {
    const result = buildDiff(scene(), VALID_OPS, { baseVersion: 42 });
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.diff.baseVersion).toBe(42);
  });
});

describe('buildDiff — warnings', () => {
  it.each([
    ['not an array', 'warning'],
    ['non-string entry', [1]],
    ['too long', ['a'.repeat(MAX_WARNING_LENGTH + 1)]],
    ['too many', Array.from({ length: MAX_DIFF_WARNINGS + 1 }, (_v, i) => `w${i}`)],
  ])('rejects unusable warnings: %s', (_label, warnings) => {
    expectRejected(
      buildDiff(scene(), VALID_OPS, { baseVersion: 1, warnings: warnings as string[] }),
      'invalid_value',
      -1,
    );
  });
});

describe('buildDiff — determinism and purity', () => {
  it('returns a deep-equal diff for the same input', () => {
    const ops = [
      { op: 'set_params', objectId: 'wardrobe-1', params: { heightCm: 210, widthCm: 200 } },
      { op: 'set_visibility', objectId: 'wardrobe-1', visible: false },
    ];
    const first = buildDiff(scene(), ops, { baseVersion: 5 });
    const second = buildDiff(scene(), ops, { baseVersion: 5 });
    expect(first).toEqual(second);
  });

  it('orders changes the same way regardless of operator order', () => {
    const a = buildDiff(
      scene(),
      [
        { op: 'set_visibility', objectId: 'wardrobe-1', visible: false },
        { op: 'set_params', objectId: 'wardrobe-1', params: { heightCm: 210, widthCm: 200 } },
      ],
      { baseVersion: 5 },
    );
    const b = buildDiff(
      scene(),
      [
        { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200, heightCm: 210 } },
        { op: 'set_visibility', objectId: 'wardrobe-1', visible: false },
      ],
      { baseVersion: 5 },
    );

    if (!a.ok || !b.ok) {
      throw new Error('expected both to build');
    }
    expect(a.diff.changes).toEqual(b.diff.changes);
  });

  it('does not mutate the scene', () => {
    const frozen = deepFreeze(sceneWith([wardrobe(), table()]));
    const snapshot = JSON.parse(JSON.stringify(frozen));

    buildDiff(frozen, [{ op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } }], {
      baseVersion: 1,
    });
    buildDiff(frozen, [{ op: 'rename', objectId: 'ghost', name: 'X' }], { baseVersion: 1 });

    expect(frozen).toEqual(snapshot);
  });
});

describe('buildDiff — scope boundaries', () => {
  it('rejects an assembly id', () => {
    const withAssembly = sceneWith([wardrobe()], [{ id: 'asm-1', kind: 'wall-cabinet', params: {} }]);
    expectRejected(
      buildDiff(withAssembly, [{ op: 'set_visibility', objectId: 'asm-1', visible: false }], {
        baseVersion: 1,
      }),
      'assembly_not_editable',
      0,
    );
  });

  it('rejects the room', () => {
    expectRejected(
      buildDiff(scene(), [{ op: 'rename', objectId: ROOM_OBJECT_ID, name: 'X' }], { baseVersion: 1 }),
      'room_not_editable',
      0,
    );
  });

  it.each(['DELETE_OBJECT', 'ADD_FURNITURE', 'LOAD_SCENE', 'SET_LAYOUT', 'ADD_ASSEMBLY'])(
    'rejects the denylisted reducer action %s',
    (type) => {
      expectRejected(
        buildDiff(scene(), [{ type, id: 'wardrobe-1' }], { baseVersion: 1 }),
        'denied_action',
        0,
      );
    },
  );

  it('rejects TOGGLE_VISIBILITY, which the DSL does not expose', () => {
    expectRejected(
      buildDiff(scene(), [{ op: 'TOGGLE_VISIBILITY', objectId: 'wardrobe-1' }], { baseVersion: 1 }),
      'denied_action',
      0,
    );
  });

  it('rejects a set that touches two objects', () => {
    expectRejected(
      buildDiff(
        scene(),
        [
          { op: 'rename', objectId: 'wardrobe-1', name: 'Shkaf' },
          { op: 'rename', objectId: 'table-1', name: 'Stol' },
        ],
        { baseVersion: 1 },
      ),
      'multiple_objects',
      1,
    );
  });
});

describe('buildDiff — visibility maps onto the W15.2 reducer action', () => {
  it('emits a visibility change whose target the reducer can reach', () => {
    const base = scene();
    const result = buildDiff(base, [{ op: 'set_visibility', objectId: 'wardrobe-1', visible: false }], {
      baseVersion: 1,
    });

    if (!result.ok) {
      throw new Error(result.message);
    }
    const [change] = result.diff.changes;
    expect(change).toMatchObject({ kind: 'visibility', field: 'visible', before: true, after: false });

    // The diff names a target value; SET_VISIBILITY applies exactly that value.
    const next = sceneReducer(
      { data: base, selectedId: null },
      { type: 'SET_VISIBILITY', id: result.diff.objectId, visible: change.after as boolean },
    );
    expect(next.data.objects[0].visible).toBe(false);
    expect(next.data.objects[1]).toEqual(base.objects[1]);
  });

  it('is idempotent through the reducer when replayed', () => {
    const base = scene();
    const result = buildDiff(base, [{ op: 'set_visibility', objectId: 'wardrobe-1', visible: false }], {
      baseVersion: 1,
    });
    if (!result.ok) {
      throw new Error(result.message);
    }

    const once = sceneReducer(
      { data: base, selectedId: null },
      { type: 'SET_VISIBILITY', id: 'wardrobe-1', visible: false },
    );
    const twice = sceneReducer(once, { type: 'SET_VISIBILITY', id: 'wardrobe-1', visible: false });
    expect(twice).toBe(once);
  });
});
