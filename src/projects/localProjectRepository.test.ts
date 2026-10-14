import { describe, expect, it } from 'vitest';
import { createLocalProjectRepository } from './localProjectRepository';
import { PROJECTS_STORAGE_KEY, type ProjectInput } from './types';

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

const input: ProjectInput = {
  name: 'Stol A',
  params: { widthCm: 140, heightCm: 75, depthCm: 60, color: '#a9744f' },
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
      params: { widthCm: 200, heightCm: 90, depthCm: 80, color: '#c0392b' },
    });

    expect(updated?.name).toBe('Stol B');
    expect(updated?.params.widthCm).toBe(200);
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

    // Updating the first makes it the most recent.
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
          { id: 'good', name: 'Ok', params: { widthCm: 120, heightCm: 75, depthCm: 60, color: '#a9744f' } },
          { id: '', name: 'Bad' },
        ],
      }),
    );
    const repository = createLocalProjectRepository({ storage });

    const list = await repository.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('good');
  });

  it('produces projects that pass validation on the next load', async () => {
    const storage = new FakeStorage();
    const first = createLocalProjectRepository({ storage, generateId: () => 'id-1' });
    await first.create(input);

    // A fresh repository instance reads the same storage (simulates reload).
    const second = createLocalProjectRepository({ storage });
    const list = await second.list();
    expect(list).toHaveLength(1);
    expect(list[0].params).toEqual(input.params);
  });
});
