import { describe, expect, it } from 'vitest';
import {
  MAX_JSON_BYTES,
  SCENE_JSON_FORMAT,
  SCENE_JSON_VERSION,
  parseSceneJson,
  serializeSceneToJson,
} from './sceneJson';
import {
  createFurnitureSceneObject,
  createTableSceneObject,
  SCENE_SCHEMA_VERSION,
  type SceneData,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { FURNITURE_TYPES } from '../geometry/furniture/types';

const META = { name: 'Yotoqxona', furnitureType: 'bed', units: 'cm' as const };

function makeScene(): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: {
      widthCm: 420,
      lengthCm: 560,
      heightCm: 290,
      showCeiling: true,
      openings: [
        { id: 'd1', kind: 'door', wall: 'south', offsetCm: 0, widthCm: 90, heightCm: 205, sillCm: 0 },
      ],
    },
    objects: [
      createTableSceneObject('t1', { position: { x: 40, y: 0, z: -80 } }),
      createFurnitureSceneObject('bed', 'b1', { rotation: { x: 0, y: 180, z: 0 } }),
      createFurnitureSceneObject('wardrobe', 'w1'),
    ],
    settings: createDefaultSettings(),
  };
}

describe('serializeSceneToJson', () => {
  it('writes the documented container with format, version and metadata', () => {
    const doc = JSON.parse(serializeSceneToJson(makeScene(), META, '2026-01-01T00:00:00.000Z'));
    expect(doc.format).toBe(SCENE_JSON_FORMAT);
    expect(doc.version).toBe(SCENE_JSON_VERSION);
    expect(doc.exportedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(doc.metadata).toEqual({ name: 'Yotoqxona', furnitureType: 'bed', units: 'cm' });
    expect(doc.scene.objects).toHaveLength(3);
  });
});

describe('parseSceneJson round-trip', () => {
  it('restores the same scene', () => {
    const scene = makeScene();
    const json = serializeSceneToJson(scene, META);
    const result = parseSceneJson(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.name).toBe('Yotoqxona');
    expect(result.droppedObjects).toBe(0);
    expect(result.scene.objects.map((o) => o.type)).toEqual(['table', 'bed', 'wardrobe']);
    expect(result.scene.objects[1].rotation.y).toBe(180);
    expect(result.scene.room.showCeiling).toBe(true);
    expect(result.scene.room.openings?.[0].id).toBe('d1');
    expect(result.scene.settings).toEqual(scene.settings);
  });

  it('round-trips every furniture type', () => {
    const scene = makeScene();
    scene.objects = FURNITURE_TYPES.map((type) => createFurnitureSceneObject(type, `id-${type}`));
    const result = parseSceneJson(serializeSceneToJson(scene, META));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.objects.map((o) => o.type)).toEqual([...FURNITURE_TYPES]);
  });
});

describe('parseSceneJson rejects untrusted input', () => {
  it('rejects malformed JSON without throwing', () => {
    const result = parseSceneJson('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('malformed');
  });

  it('rejects a non-object payload', () => {
    const result = parseSceneJson('"hello"');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('malformed');
  });

  it('rejects a foreign format marker', () => {
    const result = parseSceneJson(JSON.stringify({ format: 'something-else', version: 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('wrong_format');
  });

  it('rejects an unsupported version', () => {
    const result = parseSceneJson(
      JSON.stringify({ format: SCENE_JSON_FORMAT, version: 99, scene: {} }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsupported_version');
  });

  it('rejects an oversized file before parsing', () => {
    // A payload just over the cap; content shape does not matter.
    const big = 'x'.repeat(MAX_JSON_BYTES + 1);
    const result = parseSceneJson(`{"pad":"${big}"}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('too_large');
  });

  it('rejects a payload with no usable scene', () => {
    const result = parseSceneJson(
      JSON.stringify({ format: SCENE_JSON_FORMAT, version: SCENE_JSON_VERSION, scene: 'nope' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_scene');
  });

  it('drops unknown object types without breaking the import', () => {
    const doc = JSON.parse(serializeSceneToJson(makeScene(), META));
    doc.scene.objects.push({ id: 'x', type: 'spaceship', name: 'UFO' });
    const result = parseSceneJson(JSON.stringify(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.objects.some((o) => o.type === ('spaceship' as never))).toBe(false);
    expect(result.droppedObjects).toBe(1);
  });

  it('reports assemblies it had to leave behind', () => {
    // W14: an unreadable assembly entry is dropped like an unreadable object, but
    // silently losing it would let the user save a project smaller than the file.
    const doc = JSON.parse(serializeSceneToJson(makeScene(), META));
    doc.scene.assemblies = [
      { id: 'a1', kind: 'wall-cabinet', params: { widthCm: 60 } },
      { id: 'a2', kind: 'not-a-kind', params: {} },
      { id: '', kind: 'wall-cabinet', params: {} },
    ];
    const result = parseSceneJson(JSON.stringify(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.droppedAssemblies).toBe(2);
    // The readable one survives.
    expect(result.scene.assemblies?.map((entry) => entry.id)).toEqual(['a1']);
  });

  it('reports no dropped assemblies when every entry is readable', () => {
    const doc = JSON.parse(serializeSceneToJson(makeScene(), META));
    doc.scene.assemblies = [{ id: 'a1', kind: 'wall-cabinet', params: { widthCm: 60 } }];
    const result = parseSceneJson(JSON.stringify(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.droppedAssemblies).toBe(0);
    expect(result.scene.assemblies).toHaveLength(1);
  });

  it('reports zero dropped assemblies for a scene that has none', () => {
    const result = parseSceneJson(serializeSceneToJson(makeScene(), META));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.droppedAssemblies).toBe(0);
  });

  it('never lets a non-finite value or bad parameter into the scene', () => {
    const doc = JSON.parse(serializeSceneToJson(makeScene(), META));
    // Corrupt one object's parameters and add a NaN transform.
    doc.scene.objects[0].params.widthCm = Number.NaN;
    doc.scene.objects[1].position = { x: 'nope', y: 0, z: 0 };
    const result = parseSceneJson(JSON.stringify(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const object of result.scene.objects) {
      for (const value of [
        object.params.widthCm,
        object.position.x,
        object.position.y,
        object.position.z,
      ]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it('uses a default name when metadata is missing or blank', () => {
    const doc = JSON.parse(serializeSceneToJson(makeScene(), META));
    delete doc.metadata;
    const result = parseSceneJson(JSON.stringify(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.name).toBe('Import');
  });
});
