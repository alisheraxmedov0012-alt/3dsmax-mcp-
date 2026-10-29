import { describe, expect, it } from 'vitest';
import {
  migrateLegacyParamsToScene,
  normalizeSheetMaterials,
  validateRoomConfig,
  validateSceneData,
  validateSceneObject,
} from './sceneValidation';
import {
  MAX_ASSEMBLIES_PER_SCENE,
  ROOM_DEFAULTS,
  ROOM_LIMITS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  createTableSceneObject,
} from './types';
import { FURNITURE_TYPES, FURNITURE_TYPE_LABELS } from '../geometry/furniture';

describe('validateRoomConfig', () => {
  it('keeps valid dimensions', () => {
    expect(validateRoomConfig({ widthCm: 500, lengthCm: 600, heightCm: 300 })).toEqual({
      widthCm: 500,
      lengthCm: 600,
      heightCm: 300,
    });
  });

  it('falls back to defaults when values are missing or non-finite', () => {
    expect(validateRoomConfig({})).toEqual(ROOM_DEFAULTS);
    expect(validateRoomConfig({ widthCm: Number.NaN, lengthCm: 'x', heightCm: Infinity })).toEqual(
      ROOM_DEFAULTS,
    );
  });

  it('clamps out-of-range dimensions', () => {
    const room = validateRoomConfig({ widthCm: 99999, lengthCm: 1, heightCm: 9999 });
    expect(room.widthCm).toBe(ROOM_LIMITS.widthCm.max);
    expect(room.lengthCm).toBe(ROOM_LIMITS.lengthCm.min);
    expect(room.heightCm).toBe(ROOM_LIMITS.heightCm.max);
  });

  it('preserves the Stage 6 shape when no W6 extras are set', () => {
    expect(validateRoomConfig({ widthCm: 400, lengthCm: 500, heightCm: 280 })).toEqual({
      widthCm: 400,
      lengthCm: 500,
      heightCm: 280,
    });
    expect('showCeiling' in validateRoomConfig({})).toBe(false);
    expect('openings' in validateRoomConfig({})).toBe(false);
  });

  it('keeps showCeiling only when true', () => {
    expect(validateRoomConfig({ showCeiling: true }).showCeiling).toBe(true);
    expect(validateRoomConfig({ showCeiling: false }).showCeiling).toBeUndefined();
    expect(validateRoomConfig({ showCeiling: 'yes' }).showCeiling).toBeUndefined();
  });

  it('validates and clamps door/window openings, dropping unusable ones', () => {
    const room = validateRoomConfig({
      openings: [
        { id: 'd1', kind: 'door', wall: 'north', offsetCm: 0, widthCm: 90, heightCm: 200, sillCm: 0 },
        { id: '', wall: 'north' },
        { id: 'x', wall: 'ceiling' },
        { id: 'w1', kind: 'window', wall: 'west', offsetCm: 99999, widthCm: Number.NaN, heightCm: 120, sillCm: 90 },
      ],
    });
    expect(room.openings?.map((entry) => entry.id)).toEqual(['d1', 'w1']);
    expect(room.openings?.[1].wall).toBe('west');
    // Out-of-range offset is clamped; non-finite width falls back to a default.
    expect(room.openings?.[1].offsetCm).toBeLessThanOrEqual(2000);
    expect(Number.isFinite(room.openings?.[1].widthCm)).toBe(true);
  });
});

describe('validateSceneObject', () => {
  it('accepts a valid table object', () => {
    const object = createTableSceneObject('t1');
    expect(validateSceneObject(object)).toEqual(object);
  });

  it('rejects objects without a usable id or with an unknown type', () => {
    expect(validateSceneObject({ ...createTableSceneObject('x'), id: '' })).toBeNull();
    expect(validateSceneObject({ ...createTableSceneObject('x'), type: 'spaceship' })).toBeNull();
    expect(validateSceneObject(null)).toBeNull();
  });

  it('rejects objects with invalid params', () => {
    const object = { ...createTableSceneObject('x'), params: { widthCm: 1, color: 'bad' } };
    expect(validateSceneObject(object)).toBeNull();
  });

  it('normalizes transforms and visibility', () => {
    const object = validateSceneObject({
      id: 'x',
      type: 'table',
      name: 'Stol',
      position: { x: 999999, y: 0, z: 0 },
      rotation: { x: 0, y: 12345, z: 0 },
      scale: { x: 0.00001, y: 1, z: 1 },
      visible: 'yes',
      params: { widthCm: 120, heightCm: 75, depthCm: 60, color: '#a9744f' },
    });

    expect(object?.position.x).toBe(2000);
    expect(object?.rotation.y).toBe(360);
    expect(object?.scale.x).toBe(0.1);
    expect(object?.visible).toBe(true);
  });

  it('defaults missing material and clamps out-of-range material', () => {
    const missing = validateSceneObject({
      ...createTableSceneObject('a'),
      material: undefined,
    });
    expect(missing?.material).toEqual({ metalness: 0.05, roughness: 0.6 });

    const clamped = validateSceneObject({
      ...createTableSceneObject('b'),
      material: { metalness: 9, roughness: -1 },
    });
    expect(clamped?.material.metalness).toBe(1);
    expect(clamped?.material.roughness).toBe(0);
  });

  it('accepts a valid object of every W2 furniture type', () => {
    for (const type of FURNITURE_TYPES) {
      const object = createFurnitureSceneObject(type, `id-${type}`);
      const validated = validateSceneObject(object);
      expect(validated?.type).toBe(type);
      expect(validated?.params).toEqual(object.params);
      expect(validated?.name).toBe(FURNITURE_TYPE_LABELS[type]);
    }
  });

  it('drops an unusable optional channel but keeps the object', () => {
    const object = {
      ...createFurnitureSceneObject('wardrobe', 'w'),
      params: { widthCm: 180, heightCm: 200, depthCm: 60, color: '#a9744f', wallThicknessCm: 999 },
    };
    const validated = validateSceneObject(object);
    expect(validated).not.toBeNull();
    // The out-of-range optional channel is dropped, not stored.
    expect(validated?.params.wallThicknessCm).toBeUndefined();
    expect(validated?.params.widthCm).toBe(180);
  });

  it('sanitizes W4 material channels and drops unusable ones', () => {
    const clamped = validateSceneObject({
      ...createTableSceneObject('c'),
      material: {
        metalness: 0.5,
        roughness: 0.5,
        materialId: 'wood-oak',
        opacity: 5,
        textureScale: -3,
        normalStrength: Number.NaN,
      },
    });
    expect(clamped?.material.materialId).toBe('wood-oak');
    expect(clamped?.material.opacity).toBe(1);
    expect(clamped?.material.textureScale).toBe(0.25);
    // Non-finite normalStrength is dropped, not stored as NaN.
    expect(clamped?.material.normalStrength).toBeUndefined();

    const unknownPreset = validateSceneObject({
      ...createTableSceneObject('d'),
      material: { metalness: 0.5, roughness: 0.5, materialId: 'nope' },
    });
    expect(unknownPreset?.material.materialId).toBeUndefined();
  });
});

describe('validateSceneData', () => {
  it('returns null for a non-object', () => {
    expect(validateSceneData(null).scene).toBeNull();
    expect(validateSceneData('x').scene).toBeNull();
  });

  it('normalizes the room and keeps valid objects', () => {
    const result = validateSceneData({
      schemaVersion: 99,
      room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
      objects: [createTableSceneObject('a'), createTableSceneObject('b')],
    });

    expect(result.scene).not.toBeNull();
    expect(result.scene?.schemaVersion).toBe(SCENE_SCHEMA_VERSION);
    expect(result.scene?.objects).toHaveLength(2);
    expect(result.droppedObjects).toBe(0);
  });

  it('drops invalid and duplicate-id objects', () => {
    const result = validateSceneData({
      room: {},
      objects: [createTableSceneObject('a'), createTableSceneObject('a'), { id: 'b' }],
    });

    expect(result.scene?.objects).toHaveLength(1);
    expect(result.droppedObjects).toBe(2);
  });

  it('tolerates a missing objects array', () => {
    const result = validateSceneData({ room: {} });
    expect(result.scene?.objects).toEqual([]);
  });

  it('adds default settings for a legacy (v2) scene without settings', () => {
    const result = validateSceneData({
      schemaVersion: 2,
      room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
      objects: [createTableSceneObject('a')],
    });

    expect(result.scene?.settings.background).toBe('#1b1f24');
    expect(result.scene?.settings.cameraPreset).toBe('iso');
    expect(result.scene?.schemaVersion).toBe(SCENE_SCHEMA_VERSION);
  });
});

describe('migrateLegacyParamsToScene', () => {
  it('builds a scene with a default room and the saved table', () => {
    const scene = migrateLegacyParamsToScene({
      widthCm: 160,
      heightCm: 78,
      depthCm: 70,
      color: '#c0392b',
    });

    expect(scene.schemaVersion).toBe(SCENE_SCHEMA_VERSION);
    expect(scene.room).toEqual(ROOM_DEFAULTS);
    expect(scene.objects).toHaveLength(1);
    expect(scene.objects[0].params).toEqual({
      widthCm: 160,
      heightCm: 78,
      depthCm: 70,
      color: '#c0392b',
    });
    expect(scene.settings.cameraPreset).toBe('iso');
  });
});

describe('W14 — scene assemblies', () => {
  function sceneWithAssemblies(assemblies: unknown) {
    return {
      schemaVersion: SCENE_SCHEMA_VERSION,
      room: { ...ROOM_DEFAULTS },
      objects: [] as unknown[],
      settings: undefined,
      assemblies,
    };
  }

  it('keeps a valid assembly and round-trips only its parameters', () => {
    const result = validateSceneData(
      sceneWithAssemblies([
        { id: 'a1', kind: 'wall-cabinet', params: { widthCm: 80, heightCm: 60 } },
      ]),
    );

    expect(result.scene).not.toBeNull();
    expect(result.scene?.assemblies).toEqual([
      { id: 'a1', kind: 'wall-cabinet', params: { widthCm: 80, heightCm: 60 } },
    ]);
    expect(result.droppedAssemblies).toBe(0);
  });

  it('omits the field entirely when a scene has no assemblies (backward compatible)', () => {
    const result = validateSceneData(sceneWithAssemblies(undefined));
    expect(result.scene).not.toBeNull();
    expect(result.scene).not.toHaveProperty('assemblies');
    expect(result.droppedAssemblies).toBe(0);
  });

  it('accepts every declared assembly kind', () => {
    const kinds = ['kitchen-base-run', 'wall-cabinet', 'wardrobe-section', 'stair-straight'];
    const result = validateSceneData(
      sceneWithAssemblies(kinds.map((kind, index) => ({ id: `a${index}`, kind, params: {} }))),
    );
    expect(result.scene?.assemblies).toHaveLength(4);
    expect(result.scene?.assemblies?.map((entry) => entry.kind)).toEqual(kinds);
  });

  it('drops unknown kinds, missing ids, bad params and duplicates', () => {
    const result = validateSceneData(
      sceneWithAssemblies([
        { id: 'ok', kind: 'wall-cabinet', params: {} },
        { id: 'bad-kind', kind: 'spaceship', params: {} },
        { kind: 'wall-cabinet', params: {} },
        { id: 'bad-params', kind: 'wall-cabinet', params: 'nope' },
        { id: 'ok', kind: 'stair-straight', params: {} },
        'not-an-object',
      ]),
    );

    expect(result.scene?.assemblies).toHaveLength(1);
    expect(result.scene?.assemblies?.[0].id).toBe('ok');
    expect(result.droppedAssemblies).toBe(5);
  });

  it('caps the list at MAX_ASSEMBLIES_PER_SCENE and reports the overflow', () => {
    const many = Array.from({ length: MAX_ASSEMBLIES_PER_SCENE + 5 }, (_, index) => ({
      id: `a${index}`,
      kind: 'wall-cabinet',
      params: {},
    }));

    const result = validateSceneData(sceneWithAssemblies(many));

    expect(result.scene?.assemblies).toHaveLength(MAX_ASSEMBLIES_PER_SCENE);
    expect(result.droppedAssemblies).toBe(5);
  });

  it('trims ids and rejects an over-long id', () => {
    const result = validateSceneData(
      sceneWithAssemblies([
        { id: '  a1  ', kind: 'wall-cabinet', params: {} },
        { id: 'x'.repeat(65), kind: 'wall-cabinet', params: {} },
      ]),
    );

    expect(result.scene?.assemblies).toHaveLength(1);
    expect(result.scene?.assemblies?.[0].id).toBe('a1');
    expect(result.droppedAssemblies).toBe(1);
  });

  it('does not touch objects, room or settings when assemblies are present', () => {
    const base = {
      schemaVersion: SCENE_SCHEMA_VERSION,
      room: { ...ROOM_DEFAULTS },
      objects: [createTableSceneObject('t1')],
      settings: undefined,
      assemblies: [{ id: 'a1', kind: 'stair-straight', params: {} }],
    };

    const withAssemblies = validateSceneData(base);
    const withoutAssemblies = validateSceneData({ ...base, assemblies: undefined });

    expect(withAssemblies.scene?.objects).toEqual(withoutAssemblies.scene?.objects);
    expect(withAssemblies.scene?.room).toEqual(withoutAssemblies.scene?.room);
  });

  it('ignores a non-array assemblies value', () => {
    const result = validateSceneData(sceneWithAssemblies({ id: 'a1' }));
    expect(result.scene).not.toBeNull();
    expect(result.scene).not.toHaveProperty('assemblies');
    expect(result.droppedAssemblies).toBe(0);
  });
});

describe('C3.1 — manufacturing material persistence', () => {
  const base = () => {
    const object = createFurnitureSceneObject('wardrobe', 'w-1');
    return { ...object, params: object.params } as Record<string, unknown>;
  };

  it('keeps a valid assignment through validation (save/load)', () => {
    const stored = {
      ...base(),
      sheetMaterials: [{ partId: 'wardrobe-door', materialId: 'mdf', thicknessMm: 18, thicknessSource: 'user' }],
    };
    const validated = validateSceneObject(stored);
    expect(validated?.sheetMaterials).toEqual([
      { partId: 'wardrobe-door', materialId: 'mdf', thicknessMm: 18, thicknessSource: 'user' },
    ]);
  });

  it('leaves an object without assignments exactly as it was', () => {
    const validated = validateSceneObject(base());
    expect(validated?.sheetMaterials).toBeUndefined();
  });

  it('drops an entry with an unknown material instead of repairing it', () => {
    const stored = {
      ...base(),
      sheetMaterials: [
        { partId: 'wardrobe-door', materialId: 'unobtainium', thicknessMm: 18 },
        { partId: 'wardrobe-side', materialId: 'ldsp', thicknessMm: 18 },
      ],
    };
    const validated = validateSceneObject(stored);
    // Only the valid entry survives; no default material is substituted.
    expect(validated?.sheetMaterials).toEqual([
      { partId: 'wardrobe-side', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' },
    ]);
  });

  it('drops an entry with an invalid thickness', () => {
    for (const bad of [0, -3, 61, Number.NaN, 'abc', null]) {
      const stored = {
        ...base(),
        sheetMaterials: [{ partId: 'wardrobe-door', materialId: 'mdf', thicknessMm: bad }],
      };
      expect(validateSceneObject(stored)?.sheetMaterials, `thickness ${String(bad)}`).toBeUndefined();
    }
  });

  it('drops empty and duplicate partIds', () => {
    const stored = {
      ...base(),
      sheetMaterials: [
        { partId: '  ', materialId: 'mdf', thicknessMm: 18 },
        { partId: 'wardrobe-door', materialId: 'mdf', thicknessMm: 18 },
        { partId: 'wardrobe-door', materialId: 'ldsp', thicknessMm: 20 },
      ],
    };
    const validated = validateSceneObject(stored);
    expect(validated?.sheetMaterials).toEqual([
      { partId: 'wardrobe-door', materialId: 'mdf', thicknessMm: 18, thicknessSource: 'user' },
    ]);
  });

  it('normalises a rounded thickness through the shared C3 rule', () => {
    const stored = {
      ...base(),
      sheetMaterials: [{ partId: 'wardrobe-door', materialId: 'mdf', thicknessMm: 18.34 }],
    };
    expect(validateSceneObject(stored)?.sheetMaterials?.[0].thicknessMm).toBe(18.3);
  });

  it('ignores a non-array payload', () => {
    const stored = { ...base(), sheetMaterials: 'nope' };
    expect(validateSceneObject(stored)?.sheetMaterials).toBeUndefined();
    expect(normalizeSheetMaterials(null)).toBeUndefined();
    expect(normalizeSheetMaterials([1, 2])).toBeUndefined();
  });

  it('caps the number of stored assignments', () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      partId: `part-${index}`,
      materialId: 'ldsp',
      thicknessMm: 18,
    }));
    const entries = normalizeSheetMaterials(many);
    expect(entries).toHaveLength(40);
  });

  it('survives a full scene round trip', () => {
    const object = createFurnitureSceneObject('wardrobe', 'w-1');
    const scene = {
      schemaVersion: SCENE_SCHEMA_VERSION,
      room: { ...ROOM_DEFAULTS },
      objects: [
        {
          ...object,
          sheetMaterials: [
            { partId: 'wardrobe-door', materialId: 'mdf', thicknessMm: 12, thicknessSource: 'user' },
          ],
        },
      ],
    };
    const result = validateSceneData(scene);
    expect(result.scene?.objects[0].sheetMaterials?.[0].materialId).toBe('mdf');
  });
});

describe('C6 — hardware persistence', () => {
  const base = () => {
    const object = createFurnitureSceneObject('table', 't-1');
    return { ...object } as Record<string, unknown>;
  };

  it('keeps valid hardware and its step links through save/load', () => {
    const stored = {
      ...base(),
      hardware: [
        {
          kind: 'screw',
          name: 'Konfirmat',
          quantity: 12,
          unit: 'pcs',
          size: '4×40 mm',
          note: 'user value',
          stepIds: ['step-1'],
        },
      ],
    };
    expect(validateSceneObject(stored)?.hardware).toEqual([
      {
        kind: 'screw',
        name: 'Konfirmat',
        quantity: 12,
        unit: 'pcs',
        size: '4×40 mm',
        note: 'user value',
        stepIds: ['step-1'],
      },
    ]);
  });

  it('keeps the pre-C6 "no hardware" shape', () => {
    expect(validateSceneObject(base())?.hardware).toBeUndefined();
  });

  it('does not let an invalid stored row reach the scene', () => {
    const stored = {
      ...base(),
      hardware: [{ kind: 'screw', name: '', quantity: 12, unit: 'pcs', size: null }],
    };
    expect(validateSceneObject(stored)?.hardware).toBeUndefined();
  });
});
