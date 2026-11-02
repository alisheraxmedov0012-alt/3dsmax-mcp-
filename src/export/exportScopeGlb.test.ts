// @vitest-environment jsdom
/**
 * B2.1 — GLB keeps the room by default.
 *
 * GLTFExporter needs a DOM `FileReader`, so this scope check lives in its own
 * jsdom file, following the convention the other GLB export tests use. Only the
 * print formats changed their default; GLB must keep shipping the room.
 */
import { describe, expect, it } from 'vitest';
import { createTableSceneObject, SCENE_SCHEMA_VERSION, type SceneData } from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { exportSceneToGlb } from './sceneExport';

function sceneWithRoom(): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
    objects: [createTableSceneObject('t1')],
    settings: createDefaultSettings(),
  };
}

describe('B2.1 — GLB export scope', () => {
  it('still includes the room when no option is given', async () => {
    const scene = sceneWithRoom();
    const byDefault = (await exportSceneToGlb(scene)).byteLength;
    const withoutRoom = (await exportSceneToGlb(scene, { includeRoom: false })).byteLength;
    expect(byDefault).toBeGreaterThan(withoutRoom);
  });

  it('honours an explicit includeRoom: false', async () => {
    const scene = sceneWithRoom();
    const withRoom = await exportSceneToGlb(scene, { includeRoom: true });
    const withoutRoom = await exportSceneToGlb(scene, { includeRoom: false });
    expect(withRoom.byteLength).toBeGreaterThan(withoutRoom.byteLength);
  });
});
