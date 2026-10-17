import { describe, expect, it } from 'vitest';
import { sceneReducer } from './sceneReducer';
import { createTableSceneObject, SCENE_SCHEMA_VERSION, type SceneData } from './types';
import { createDefaultSettings } from './sceneSettings';
import { validateSceneData } from './sceneValidation';
import { buildSceneObject } from './buildSceneObject';

const OBJECT_COUNT = 100;

/**
 * Builds a reproducible large scene: 100 lightweight table objects spread over a
 * grid inside a large room. Deterministic so timings are comparable across runs.
 */
function buildLargeScene(): SceneData {
  const columns = 10;
  const spacing = 150;
  const objects = Array.from({ length: OBJECT_COUNT }, (_, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    return createTableSceneObject(`obj-${index}`, {
      position: { x: col * spacing - 675, y: 0, z: row * spacing - 675 },
      rotation: { x: 0, y: (index % 4) * 90, z: 0 },
    });
  });

  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { widthCm: 2000, lengthCm: 2000, heightCm: 400 },
    objects,
    settings: createDefaultSettings(),
  };
}

describe('large scene (100 objects)', () => {
  it('validates, serializes and rebuilds 100 objects within a sane time', () => {
    const scene = buildLargeScene();
    expect(scene.objects).toHaveLength(OBJECT_COUNT);
    expect(new Set(scene.objects.map((object) => object.id)).size).toBe(OBJECT_COUNT);

    const validationStart = performance.now();
    const validated = validateSceneData(scene);
    const validationMs = performance.now() - validationStart;

    const serializeStart = performance.now();
    const raw = JSON.stringify(scene);
    const parsed = JSON.parse(raw) as SceneData;
    const serializeMs = performance.now() - serializeStart;

    const rebuildStart = performance.now();
    const built = parsed.objects.map((object) => buildSceneObject(object));
    const rebuildMs = performance.now() - rebuildStart;

    const disposeStart = performance.now();
    built.forEach((entry) => entry.dispose());
    const disposeMs = performance.now() - disposeStart;

    // eslint-disable-next-line no-console
    console.info(
      `[large-scene] 100 objects — validate ${validationMs.toFixed(1)}ms, ` +
        `serialize ${serializeMs.toFixed(1)}ms, rebuild ${rebuildMs.toFixed(1)}ms, ` +
        `dispose ${disposeMs.toFixed(1)}ms`,
    );

    expect(validated.scene?.objects).toHaveLength(OBJECT_COUNT);
    expect(validated.droppedObjects).toBe(0);
    expect(built).toHaveLength(OBJECT_COUNT);

    // Generous smoke bounds (times depend on the machine); the point is to prove
    // the 100-object path completes without pathological slowdown.
    expect(validationMs).toBeLessThan(2000);
    expect(rebuildMs).toBeLessThan(5000);
  });

  it('updates only the affected object in a 100-object scene', () => {
    let state = {
      data: buildLargeScene(),
      selectedId: 'obj-0' as string | null,
      revision: 1,
    };

    const before = new Set(
      state.data.objects.map((object) => `${object.id}:${JSON.stringify(object.position)}`),
    );

    const updateStart = performance.now();
    state = sceneReducer(state, {
      type: 'UPDATE_TRANSFORM',
      id: 'obj-50',
      position: { x: 1234 },
    });
    const updateMs = performance.now() - updateStart;

    // eslint-disable-next-line no-console
    console.info(`[large-scene] single transform update: ${updateMs.toFixed(3)}ms`);

    const changed = state.data.objects.filter(
      (object) =>
        !before.has(`${object.id}:${JSON.stringify(object.position)}`),
    );
    expect(changed).toHaveLength(1);
    expect(changed[0].id).toBe('obj-50');
    expect(updateMs).toBeLessThan(100);
  });
});
