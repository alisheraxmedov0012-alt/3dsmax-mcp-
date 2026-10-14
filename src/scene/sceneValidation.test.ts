import { describe, expect, it } from 'vitest';
import {
  migrateLegacyParamsToScene,
  validateRoomConfig,
  validateSceneData,
  validateSceneObject,
} from './sceneValidation';
import {
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
