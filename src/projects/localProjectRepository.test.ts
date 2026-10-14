import { describe, expect, it } from 'vitest';
import { createLocalProjectRepository } from './localProjectRepository';
import { PROJECTS_STORAGE_KEY, type ProjectInput } from './types';
import { createTableSceneObject, SCENE_SCHEMA_VERSION, type SceneData } from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';

/** Minimal in-memory implementation of the Web Storage API. */
class FakeStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

function makeScene(overrides?: Partial<SceneData>): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
    objects: [createTableSceneObject('obj-1')],
    settings: createDefaultSettings(),
    ...overrides,
  };
}

const input: ProjectInput = {
  name: 'Stol A',
  scene: makeScene(),
};

function makeRepository(overrides?: { ids?: string[]; times?: string[] }) {
  const storage = new FakeStorage();
  const ids = overrides?.ids ?? ['id-1', 'id-2', 'id-3'];
  const times = overrides?.times ?? [
    '2026-01-01T00:00:00.000Z',
    '2026-01-02T00:00:00.000Z',
    '2026-01-03T00:00:00.000Z',
  ];
  let idIndex = 0;
  let timeIndex = 0;

  const repository = createLocalProjectRepository({
    storage,
    generateId: () => ids[Math.min(idIndex++, ids.length - 1)],
    now: () => times[Math.min(timeIndex++, times.length - 1)],
  });

  return { repository, storage };
}

describe('createLocalProjectRepository', () => {
  it('starts empty', async () => {
    const { repository } = makeRepository();
    expect(await repository.list()).toEqual([]);
  });

  it('creates a project and lists it', async () => {
    const { repository } = makeRepository();
    const created = await repository.create(input);

    expect(created.id).toBe('id-1');
    expect(created.name).toBe('Stol A');
    expect(created.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(created.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(created.schemaVersion).toBe(SCENE_SCHEMA_VERSION);
    expect(await repository.list()).toEqual([created]);
  });

  it('applies a default name for a blank name', async () => {
    const { repository } = makeRepository();
    const created = await repository.create({ ...input, name: '   ' });

    expect(created.name).toBe('Nomsiz loyiha');
  });

  it('updates an existing project without creating a duplicate', async () => {
    const { repository } = makeRepository();
    const created = await repository.create(input);

    const updated = await repository.update(created.id, {
      name: 'Stol B',
      scene: makeScene({ room: { widthCm: 600, lengthCm: 700, heightCm: 300 } }),
    });

    expect(updated?.name).toBe('Stol B');
    expect(updated?.scene.room.widthCm).toBe(600);
    expect(updated?.createdAt).toBe(created.createdAt);

    const all = await repository.list();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Stol B');
  });

  it('returns null when updating a missing project', async () => {
    const { repository } = makeRepository();
    expect(await repository.update('missing', input)).toBeNull();
  });

  it('removes a project', async () => {
    const { repository } = makeRepository();
    const created = await repository.create(input);

    expect(await repository.remove(created.id)).toBe(true);
    expect(await repository.list()).toEqual([]);
    expect(await repository.remove(created.id)).toBe(false);
  });

  it('sorts the list by most recently updated first', async () => {
    const { repository } = makeRepository();
    const first = await repository.create({ ...input, name: 'First' });
    const second = await repository.create({ ...input, name: 'Second' });

    await repository.update(first.id, { ...input, name: 'First updated' });

    const list = await repository.list();
    expect(list[0].id).toBe(first.id);
    expect(list[1].id).toBe(second.id);
  });

  it('isolates projects by storage key', async () => {
    const storage = new FakeStorage();
    const a = createLocalProjectRepository({ storage, generateId: () => 'a' });
    const b = createLocalProjectRepository({
      storage,
      generateId: () => 'b',
      storageKey: 'other-key',
    });

    await a.create({ ...input, name: 'In A' });
    await b.create({ ...input, name: 'In B' });

    expect((await a.list()).map((p) => p.name)).toEqual(['In A']);
    expect((await b.list()).map((p) => p.name)).toEqual(['In B']);
    expect(storage.getItem(PROJECTS_STORAGE_KEY)).not.toBeNull();
  });

  it('does not crash when stored data is malformed', async () => {
    const storage = new FakeStorage();
    storage.setItem(PROJECTS_STORAGE_KEY, '{ broken json');
    const repository = createLocalProjectRepository({ storage });

    expect(await repository.list()).toEqual([]);
  });

  it('skips corrupt entries when loading', async () => {
    const storage = new FakeStorage();
    storage.setItem(
      PROJECTS_STORAGE_KEY,
      JSON.stringify({
        projects: [
          { id: 'good', name: 'Ok', scene: makeScene() },
          { id: '', name: 'Bad' },
        ],
      }),
    );
    const repository = createLocalProjectRepository({ storage });

    const list = await repository.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('good');
  });

  it('preserves the full scene through a reload', async () => {
    const storage = new FakeStorage();
    const first = createLocalProjectRepository({ storage, generateId: () => 'id-1' });
    const scene: SceneData = {
      schemaVersion: SCENE_SCHEMA_VERSION,
      room: { widthCm: 800, lengthCm: 900, heightCm: 320 },
      objects: [
        createTableSceneObject('t1', {
          position: { x: 100, y: 0, z: -50 },
          rotation: { x: 0, y: 90, z: 0 },
          visible: false,
        }),
        createTableSceneObject('t2', { scale: { x: 2, y: 2, z: 2 } }),
      ],
      settings: createDefaultSettings(),
    };
    await first.create({ name: 'Scene', scene });

    const second = createLocalProjectRepository({ storage });
    const list = await second.list();
    expect(list).toHaveLength(1);
    expect(list[0].scene.room.widthCm).toBe(800);
    expect(list[0].scene.objects).toHaveLength(2);
    expect(list[0].scene.objects[0].position.x).toBe(100);
    expect(list[0].scene.objects[0].rotation.y).toBe(90);
    expect(list[0].scene.objects[0].visible).toBe(false);
    expect(list[0].scene.objects[1].scale.x).toBe(2);
  });

  it('loads legacy (v1) table-only projects by migrating them to a scene', async () => {
    const storage = new FakeStorage();
    storage.setItem(
      PROJECTS_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        projects: [
          {
            id: 'legacy-1',
            name: 'Eski loyiha',
            params: { widthCm: 160, heightCm: 78, depthCm: 70, color: '#c0392b' },
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
            schemaVersion: 1,
          },
        ],
      }),
    );

    const repository = createLocalProjectRepository({ storage });
    const list = await repository.list();

    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Eski loyiha');
    expect(list[0].scene.objects).toHaveLength(1);
    expect(list[0].scene.objects[0].params).toEqual({
      widthCm: 160,
      heightCm: 78,
      depthCm: 70,
      color: '#c0392b',
    });
    expect(list[0].schemaVersion).toBe(SCENE_SCHEMA_VERSION);
  });
});
