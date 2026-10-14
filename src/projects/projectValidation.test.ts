import { describe, expect, it } from 'vitest';
import {
  deserializeProjects,
  serializeProjects,
  validateSavedProject,
} from './projectValidation';
import {
  DEFAULT_PROJECT_NAME,
  MAX_PROJECT_NAME_LENGTH,
  PROJECTS_SCHEMA_VERSION,
  type SavedProject,
} from './types';
import { createTableSceneObject, SCENE_SCHEMA_VERSION, type SceneData } from '../scene/types';

function makeScene(): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
    objects: [createTableSceneObject('obj-1')],
  };
}

const validProject: SavedProject = {
  id: 'abc-1',
  name: 'Mening stolim',
  scene: makeScene(),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  schemaVersion: PROJECTS_SCHEMA_VERSION,
};

describe('validateSavedProject', () => {
  it('accepts a well-formed scene project', () => {
    expect(validateSavedProject(validProject)).toEqual(validProject);
  });

  it('rejects a non-object', () => {
    expect(validateSavedProject('nope')).toBeNull();
    expect(validateSavedProject(null)).toBeNull();
    expect(validateSavedProject([])).toBeNull();
  });

  it('rejects an entry without a usable id', () => {
    expect(validateSavedProject({ ...validProject, id: '' })).toBeNull();
    expect(validateSavedProject({ ...validProject, id: 5 })).toBeNull();
  });

  it('rejects an entry with neither scene nor legacy params', () => {
    expect(validateSavedProject({ id: 'x', name: 'A' })).toBeNull();
  });

  it('migrates a legacy table-only (v1) record into a scene', () => {
    const legacy = {
      id: 'legacy',
      name: 'Eski',
      params: { widthCm: 150, heightCm: 80, depthCm: 65, color: '#8b5a2b' },
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      schemaVersion: 1,
    };

    const result = validateSavedProject(legacy);
    expect(result).not.toBeNull();
    expect(result?.schemaVersion).toBe(PROJECTS_SCHEMA_VERSION);
    expect(result?.scene.objects).toHaveLength(1);
    expect(result?.scene.objects[0].params).toEqual(legacy.params);
  });

  it('normalizes an out-of-range room instead of rejecting the record', () => {
    const result = validateSavedProject({
      ...validProject,
      scene: {
        ...validProject.scene,
        room: { widthCm: 999999, lengthCm: -5, heightCm: 280 },
      },
    });

    expect(result).not.toBeNull();
    // OUT_OF_RANGE is clamped into ROOM_LIMITS.
    expect(result?.scene.room.widthCm).toBeLessThanOrEqual(2000);
    expect(result?.scene.room.lengthCm).toBeGreaterThanOrEqual(100);
  });

  it('drops invalid objects but keeps valid ones', () => {
    const result = validateSavedProject({
      ...validProject,
      scene: {
        ...validProject.scene,
        objects: [createTableSceneObject('ok'), { id: '', type: 'table' }, { type: 'table' }],
      },
    });

    expect(result?.scene.objects).toHaveLength(1);
    expect(result?.scene.objects[0].id).toBe('ok');
  });

  it('falls back to a default name when missing or blank', () => {
    expect(validateSavedProject({ ...validProject, name: '   ' })?.name).toBe(DEFAULT_PROJECT_NAME);
    expect(validateSavedProject({ ...validProject, name: 42 })?.name).toBe(DEFAULT_PROJECT_NAME);
  });

  it('truncates an over-long name', () => {
    const long = 'a'.repeat(200);
    expect(validateSavedProject({ ...validProject, name: long })?.name).toHaveLength(
      MAX_PROJECT_NAME_LENGTH,
    );
  });
});

describe('deserializeProjects', () => {
  it('returns empty for null, empty or malformed input', () => {
    expect(deserializeProjects(null)).toEqual({ projects: [], skipped: 0 });
    expect(deserializeProjects('')).toEqual({ projects: [], skipped: 0 });
    expect(deserializeProjects('{ not json')).toEqual({ projects: [], skipped: 0 });
  });

  it('reads the { projects: [...] } container', () => {
    const raw = JSON.stringify({ schemaVersion: 2, projects: [validProject] });
    expect(deserializeProjects(raw)).toEqual({ projects: [validProject], skipped: 0 });
  });

  it('skips invalid entries and reports the count', () => {
    const raw = JSON.stringify({
      projects: [validProject, { id: '' }, { id: 'ok' }],
    });
    const result = deserializeProjects(raw);

    expect(result.projects).toHaveLength(1);
    expect(result.skipped).toBe(2);
  });
});

describe('serializeProjects', () => {
  it('round-trips through deserializeProjects', () => {
    const raw = serializeProjects([validProject]);
    expect(deserializeProjects(raw).projects).toEqual([validProject]);
  });

  it('stores the schema version in a container object', () => {
    const parsed = JSON.parse(serializeProjects([]));
    expect(parsed.schemaVersion).toBe(PROJECTS_SCHEMA_VERSION);
    expect(parsed.projects).toEqual([]);
  });
});
