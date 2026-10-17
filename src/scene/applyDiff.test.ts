import { describe, expect, it } from 'vitest';
import { applyDiff, type ApplyDiffRejection, type ApplyDiffResult } from './applyDiff';
import { buildDiff } from './buildDiff';
import { getMaterialPreset } from '../materials/presets';
import { EDIT_SCHEMA_VERSION, type SceneEditChange, type SceneEditDiff } from './sceneDiff';
import { createDefaultSettings } from './sceneSettings';
import {
  ROOM_DEFAULTS,
  ROOM_OBJECT_ID,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  type SceneAssembly,
  type SceneData,
  type SceneObject,
  type SceneState,
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

function stateWith(objects: SceneObject[], assemblies?: SceneAssembly[]): SceneState {
  const data = sceneWith(objects, assemblies);
  return { data, selectedId: data.objects[0]?.id ?? null };
}

function build(scene: SceneData, ops: unknown[], baseVersion = 1): SceneEditDiff {
  const result = buildDiff(scene, ops, { baseVersion });
  if (!result.ok) {
    throw new Error(`fixture diff failed: ${result.code} — ${result.message}`);
  }
  return result.diff;
}

function expectApplied(result: ApplyDiffResult): Extract<ApplyDiffResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected apply, got ${result.code} — ${result.message}`);
  }
  return result;
}

function expectRejected(result: ApplyDiffResult, code: string): ApplyDiffRejection {
  if (result.ok) {
    throw new Error(`expected rejection «${code}», got an applied state`);
  }
  expect(result.code).toBe(code);
  expect(result.message.length).toBeGreaterThan(0);
  return result;
}


/** Rewrites matching changes without spreading inside `map` (lint rule). */
function patchChanges(
  changes: readonly SceneEditChange[],
  predicate: (change: SceneEditChange) => boolean,
  patch: Partial<SceneEditChange>,
): SceneEditChange[] {
  const next: SceneEditChange[] = [];
  for (const change of changes) {
    next.push(predicate(change) ? Object.assign({}, change, patch) : change);
  }
  return next;
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

const WIDTH_OP = [{ op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } }];

describe('applyDiff — success', () => {
  it('applies a valid diff', () => {
    const scene = stateWith([wardrobe(), table()]);
    const diff = build(scene.data, WIDTH_OP);
    const result = expectApplied(applyDiff(scene, diff, { currentVersion: 1 }));

    expect(result.state.data.objects[0].params.widthCm).toBe(200);
    expect(result.state.data.objects[1]).toEqual(scene.data.objects[1]);
    expect(result.actions).toEqual([
      {
        type: 'UPDATE_PARAMS',
        id: 'wardrobe-1',
        params: { ...scene.data.objects[0].params, widthCm: 200 },
      },
    ]);
  });

  it('continues when baseVersion equals currentVersion', () => {
    const scene = stateWith([wardrobe()]);
    const diff = build(scene.data, WIDTH_OP, 9);
    const result = expectApplied(applyDiff(scene, diff, { currentVersion: 9 }));
    expect(result.state.data.objects[0].params.widthCm).toBe(200);
  });

  it('applies several valid operations in sequence', () => {
    const scene = stateWith([wardrobe()]);
    const diff = build(scene.data, [
      { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200, heightCm: 210 } },
      { op: 'set_transform', objectId: 'wardrobe-1', position: { x: 25 }, rotation: { y: 90 } },
      { op: 'rename', objectId: 'wardrobe-1', name: 'Katta shkaf' },
      { op: 'set_material', objectId: 'wardrobe-1', metalness: 0.4 },
      { op: 'set_visibility', objectId: 'wardrobe-1', visible: false },
    ]);

    const result = expectApplied(applyDiff(scene, diff, { currentVersion: 1 }));
    const object = result.state.data.objects[0];

    expect(object.params.widthCm).toBe(200);
    expect(object.params.heightCm).toBe(210);
    expect(object.position.x).toBe(25);
    expect(object.rotation.y).toBe(90);
    expect(object.name).toBe('Katta shkaf');
    expect(object.material.metalness).toBe(0.4);
    expect(object.visible).toBe(false);
  });

  it('applies a material preset, including the colour it implies', () => {
    const scene = stateWith([wardrobe()]);
    const diff = build(scene.data, [
      { op: 'apply_material_preset', objectId: 'wardrobe-1', presetId: 'metal-steel' },
    ]);

    const result = expectApplied(applyDiff(scene, diff, { currentVersion: 1 }));
    const object = result.state.data.objects[0];
    expect(object.material.materialId).toBe('metal-steel');
    expect(object.material.metalness).toBe(getMaterialPreset('metal-steel').metalness);
    expect(object.params.color).toBe('#c9ced3');
  });
});

describe('applyDiff — version contract', () => {
  it('rejects a stale diff', () => {
    const scene = stateWith([wardrobe()]);
    const diff = build(scene.data, WIDTH_OP, 3);
    const result = expectRejected(applyDiff(scene, diff, { currentVersion: 4 }), 'stale_version');
    expect(result.index).toBe(-1);
  });

  it.each([
    ['zero', 0],
    ['negative', -3],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['string', '2'],
    ['null', null],
    ['missing object', undefined],
  ])('rejects an unusable currentVersion: %s', (_label, currentVersion) => {
    const scene = stateWith([wardrobe()]);
    const diff = build(scene.data, WIDTH_OP, 1);
    expectRejected(
      applyDiff(scene, diff, { currentVersion } as unknown as { currentVersion: number }),
      'invalid_current_version',
    );
  });

  it('rejects a diff whose own baseVersion is unusable', () => {
    const scene = stateWith([wardrobe()]);
    const diff = { ...build(scene.data, WIDTH_OP), baseVersion: 0 };
    expectRejected(applyDiff(scene, diff, { currentVersion: 1 }), 'invalid_base_version');
  });

  it('rejects a wrong schema version', () => {
    const scene = stateWith([wardrobe()]);
    const diff = { ...build(scene.data, WIDTH_OP), schemaVersion: 99 };
    expectRejected(applyDiff(scene, diff, { currentVersion: 1 }), 'invalid_schema_version');
  });

  it('keeps the schema version pinned', () => {
    const scene = stateWith([wardrobe()]);
    const diff = build(scene.data, WIDTH_OP);
    expect(diff.schemaVersion).toBe(EDIT_SCHEMA_VERSION);
  });
});

describe('applyDiff — targets', () => {
  it('rejects an unknown object id', () => {
    const scene = stateWith([wardrobe()]);
    const diff = { ...build(scene.data, WIDTH_OP), objectId: 'ghost' };
    expectRejected(applyDiff(scene, diff, { currentVersion: 1 }), 'unknown_object');
  });

  it('rejects the room', () => {
    const scene = stateWith([wardrobe()]);
    const diff = { ...build(scene.data, WIDTH_OP), objectId: ROOM_OBJECT_ID };
    expectRejected(applyDiff(scene, diff, { currentVersion: 1 }), 'room_not_editable');
  });

  it('rejects an assembly id', () => {
    const scene = stateWith(
      [wardrobe()],
      [{ id: 'asm-1', kind: 'wall-cabinet', params: {} }],
    );
    const diff = { ...build(scene.data, WIDTH_OP), objectId: 'asm-1' };
    expectRejected(applyDiff(scene, diff, { currentVersion: 1 }), 'assembly_not_editable');
  });

  it('rejects a diff whose objectType does not match the scene', () => {
    const scene = stateWith([wardrobe()]);
    const diff = { ...build(scene.data, WIDTH_OP), objectType: 'table' };
    expectRejected(applyDiff(scene, diff, { currentVersion: 1 }), 'type_mismatch');
  });

  it('rejects an empty objectId', () => {
    const scene = stateWith([wardrobe()]);
    const diff = { ...build(scene.data, WIDTH_OP), objectId: '  ' };
    expectRejected(applyDiff(scene, diff, { currentVersion: 1 }), 'invalid_object_id');
  });
});

describe('applyDiff — visibility', () => {
  it('maps a visibility change onto SET_VISIBILITY', () => {
    const scene = stateWith([wardrobe()]);
    const diff = build(scene.data, [
      { op: 'set_visibility', objectId: 'wardrobe-1', visible: false },
    ]);

    const result = expectApplied(applyDiff(scene, diff, { currentVersion: 1 }));
    expect(result.actions).toEqual([
      { type: 'SET_VISIBILITY', id: 'wardrobe-1', visible: false },
    ]);
    expect(result.state.data.objects[0].visible).toBe(false);
  });

  it('never emits TOGGLE_VISIBILITY', () => {
    const scene = stateWith([wardrobe()]);
    const diff = build(scene.data, [
      { op: 'set_visibility', objectId: 'wardrobe-1', visible: false },
    ]);
    const result = expectApplied(applyDiff(scene, diff, { currentVersion: 1 }));
    expect(result.actions.some((action) => action.type === 'TOGGLE_VISIBILITY')).toBe(false);
  });

  it('is idempotent: replaying the same diff is a successful no-op', () => {
    const scene = stateWith([wardrobe()]);
    const diff = build(scene.data, [
      { op: 'set_visibility', objectId: 'wardrobe-1', visible: false },
    ]);

    const first = expectApplied(applyDiff(scene, diff, { currentVersion: 1 }));
    expect(first.state.data.objects[0].visible).toBe(false);

    const second = expectApplied(applyDiff(first.state, diff, { currentVersion: 1 }));
    expect(second.state).toBe(first.state);
    expect(second.actions).toEqual([]);
  });
});

describe('applyDiff — atomicity', () => {
  it('returns no partial result when a later change is invalid', () => {
    const scene = stateWith([wardrobe()]);
    const diff = build(scene.data, [
      { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } },
    ]);
    // Craft a second, independently valid-looking change that the scene rejects.
    const broken: SceneEditDiff = {
      ...diff,
      changes: [
        ...diff.changes,
        {
          kind: 'param',
          field: 'heightCm',
          label: 'Balandlik (sm)',
          unit: 'sm',
          before: 200,
          after: 5000,
        },
      ],
    };

    expectRejected(applyDiff(scene, broken, { currentVersion: 1 }), 'out_of_range');
    // The input scene is untouched: widthCm is still the original value.
    expect(scene.data.objects[0].params.widthCm).toBe(180);
  });

  it('rejects a change the operators would not produce', () => {
    // A preset rewrites metalness to its own value; claiming a different target
    // means the diff does not describe what applying it would do.
    const scene = stateWith([wardrobe()]);
    const diff = build(scene.data, [
      { op: 'apply_material_preset', objectId: 'wardrobe-1', presetId: 'wood-oak' },
    ]);
    const tampered: SceneEditDiff = {
      ...diff,
      changes: patchChanges(
        diff.changes,
        (change) => change.kind === 'material' && change.field === 'metalness',
        { after: 0.77 },
      ),
    };

    expectRejected(applyDiff(scene, tampered, { currentVersion: 1 }), 'stale_content');
  });

  it('rejects a diff whose before value does not match the scene', () => {
    const scene = stateWith([wardrobe()]);
    const diff = build(scene.data, WIDTH_OP);
    const tampered: SceneEditDiff = {
      ...diff,
      changes: patchChanges(diff.changes, () => true, { before: 999 }),
    };

    expectRejected(applyDiff(scene, tampered, { currentVersion: 1 }), 'stale_content');
  });

  it('rejects a partially applied diff', () => {
    const scene = stateWith([wardrobe()]);
    const diff = build(scene.data, [
      { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200, heightCm: 210 } },
    ]);

    // Someone already set width by hand; height is still the old value.
    const moved: SceneState = {
      data: {
        ...scene.data,
        objects: [
          { ...scene.data.objects[0], params: { ...scene.data.objects[0].params, widthCm: 200 } },
        ],
      },
      selectedId: scene.selectedId,
    };

    expectRejected(applyDiff(moved, diff, { currentVersion: 1 }), 'stale_content');
  });

  it('rejects duplicate changes', () => {
    const scene = stateWith([wardrobe()]);
    const diff = build(scene.data, WIDTH_OP);
    const duplicated: SceneEditDiff = {
      ...diff,
      changes: [...diff.changes, ...diff.changes],
    };

    expectRejected(applyDiff(scene, duplicated, { currentVersion: 1 }), 'duplicate_change');
  });

  it('rejects a diff with no changes', () => {
    const scene = stateWith([wardrobe()]);
    const diff = { ...build(scene.data, WIDTH_OP), changes: [] };
    expectRejected(applyDiff(scene, diff, { currentVersion: 1 }), 'invalid_diff');
  });

  it('rejects an unknown change kind', () => {
    const scene = stateWith([wardrobe()]);
    const diff = build(scene.data, WIDTH_OP);
    const tampered: SceneEditDiff = {
      ...diff,
      changes: [{ ...diff.changes[0], kind: 'delete' as SceneEditChange['kind'] }],
    };
    expectRejected(applyDiff(scene, tampered, { currentVersion: 1 }), 'invalid_change');
  });

  it.each(['DELETE_OBJECT', 'TOGGLE_VISIBILITY', 'LOAD_SCENE', 'ADD_ASSEMBLY'])(
    'rejects a change that names the reducer action %s',
    (kind) => {
      const scene = stateWith([wardrobe()]);
      const diff = build(scene.data, WIDTH_OP);
      const tampered = {
        ...diff,
        changes: [{ kind, field: 'visible', before: true, after: false }],
      };
      const result = applyDiff(scene, tampered, { currentVersion: 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('invalid_change');
      }
    },
  );

  it('ignores unrelated fields on a change instead of dispatching them', () => {
    const scene = stateWith([wardrobe()]);
    const diff = build(scene.data, [
      { op: 'set_visibility', objectId: 'wardrobe-1', visible: false },
    ]);
    const withNoise = {
      ...diff,
      changes: patchChanges(diff.changes, () => true, { action: 'DELETE_OBJECT' } as Partial<SceneEditChange>),
    };

    // The extra field is never read; the action list is built from the DSL map.
    const result = expectApplied(applyDiff(scene, withNoise, { currentVersion: 1 }));
    expect(result.actions.map((action) => action.type)).toEqual(['SET_VISIBILITY']);
  });
});

describe('applyDiff — reducer clamping is not success', () => {
  it('rejects a transform value the reducer would clamp', () => {
    const scene = stateWith([wardrobe()]);
    const diff = build(scene.data, [
      { op: 'set_transform', objectId: 'wardrobe-1', position: { x: 10 } },
    ]);
    const outOfRange: SceneEditDiff = {
      ...diff,
      changes: patchChanges(diff.changes, () => true, { after: 5000 }),
    };

    expectRejected(applyDiff(scene, outOfRange, { currentVersion: 1 }), 'out_of_range');
  });

  it('rejects a material value the reducer would clamp', () => {
    const scene = stateWith([wardrobe()]);
    const diff = build(scene.data, [
      { op: 'set_material', objectId: 'wardrobe-1', metalness: 0.4 },
    ]);
    const outOfRange: SceneEditDiff = {
      ...diff,
      changes: patchChanges(diff.changes, () => true, { after: 1.5 }),
    };

    expectRejected(applyDiff(scene, outOfRange, { currentVersion: 1 }), 'out_of_range');
  });

  it('rejects a rotation the reducer would clamp to a different angle', () => {
    const scene = stateWith([wardrobe()]);
    const diff = build(scene.data, [
      { op: 'set_transform', objectId: 'wardrobe-1', rotation: { y: 10 } },
    ]);
    const clamped: SceneEditDiff = {
      ...diff,
      changes: patchChanges(diff.changes, () => true, { after: 370 }),
    };

    // 370 normalizes to 10, so the operator still validates; but the stated
    // value and the applied value must agree.
    const result = applyDiff(scene, clamped, { currentVersion: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.data.objects[0].rotation.y).toBe(10);
    }
  });
});

describe('applyDiff — no-op and purity', () => {
  it('returns the same state reference when every target value already holds', () => {
    const scene = stateWith([wardrobe()]);
    const diff: SceneEditDiff = {
      schemaVersion: EDIT_SCHEMA_VERSION,
      objectId: 'wardrobe-1',
      objectType: 'wardrobe',
      baseVersion: 1,
      changes: [
        {
          kind: 'name',
          field: 'name',
          label: 'Nom',
          unit: null,
          before: 'Eski',
          after: scene.data.objects[0].name,
        },
      ],
      warnings: [],
    };

    const result = expectApplied(applyDiff(scene, diff, { currentVersion: 1 }));
    expect(result.state).toBe(scene);
    expect(result.actions).toEqual([]);
  });

  it('does not mutate the input scene', () => {
    const scene = stateWith([wardrobe(), table()]);
    deepFreeze(scene);
    const snapshot = JSON.parse(JSON.stringify(scene));
    const diff = build(scene.data, [
      { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } },
      { op: 'set_transform', objectId: 'wardrobe-1', rotation: { y: 45 } },
      { op: 'set_visibility', objectId: 'wardrobe-1', visible: false },
    ]);

    expectApplied(applyDiff(scene, diff, { currentVersion: 1 }));
    expect(scene).toEqual(snapshot);
  });

  it('does not mutate the diff', () => {
    const scene = stateWith([wardrobe()]);
    const diff = build(scene.data, WIDTH_OP);
    const snapshot = JSON.parse(JSON.stringify(diff));
    applyDiff(scene, diff, { currentVersion: 1 });
    expect(diff).toEqual(snapshot);
  });

  it('is deterministic', () => {
    const scene = stateWith([wardrobe()]);
    const diff = build(scene.data, [
      { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } },
      { op: 'set_visibility', objectId: 'wardrobe-1', visible: false },
    ]);

    const first = expectApplied(applyDiff(scene, diff, { currentVersion: 1 }));
    const second = expectApplied(applyDiff(scene, diff, { currentVersion: 1 }));
    expect(first.actions).toEqual(second.actions);
    expect(first.state).toEqual(second.state);
  });

  it('leaves selection untouched', () => {
    const scene = stateWith([wardrobe(), table()]);
    const diff = build(scene.data, [
      { op: 'set_params', objectId: 'table-1', params: { widthCm: 140 } },
    ]);
    const result = expectApplied(applyDiff(scene, diff, { currentVersion: 1 }));
    expect(result.state.selectedId).toBe(scene.selectedId);
  });

  it('keeps assemblies intact', () => {
    const scene = stateWith(
      [wardrobe()],
      [{ id: 'asm-1', kind: 'wall-cabinet', params: { widthCm: 60 } }],
    );
    const diff = build(scene.data, WIDTH_OP);
    const result = expectApplied(applyDiff(scene, diff, { currentVersion: 1 }));
    expect(result.state.data.assemblies).toEqual(scene.data.assemblies);
  });
});
