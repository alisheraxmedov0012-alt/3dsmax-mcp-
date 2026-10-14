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

const validProject: SavedProject = {
  id: 'abc-1',
  name: 'Mening stolim',
  params: { widthCm: 150, heightCm: 80, depthCm: 70, color: '#8b5a2b' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  schemaVersion: PROJECTS_SCHEMA_VERSION,
};

describe('validateSavedProject', () => {
  it('accepts a well-formed project', () => {
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

  it('rejects an entry with invalid parameters', () => {
    expect(
      validateSavedProject({ ...validProject, params: { widthCm: 9999, color: '#fff' } }),
    ).toBeNull();
    expect(validateSavedProject({ ...validProject, params: 'x' })).toBeNull();
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

  it('tolerates missing timestamps and schema version', () => {
    const result = validateSavedProject({
      id: 'x',
      name: 'A',
      params: { widthCm: 120, heightCm: 75, depthCm: 60, color: '#a9744f' },
    });

    expect(result).not.toBeNull();
    expect(result?.createdAt).toBe('');
    expect(result?.updatedAt).toBe('');
    expect(result?.schemaVersion).toBe(PROJECTS_SCHEMA_VERSION);
  });
});

describe('deserializeProjects', () => {
  it('returns empty for null or empty input', () => {
    expect(deserializeProjects(null)).toEqual({ projects: [], skipped: 0 });
    expect(deserializeProjects('')).toEqual({ projects: [], skipped: 0 });
  });

  it('returns empty for malformed JSON without throwing', () => {
    expect(deserializeProjects('{ not json')).toEqual({ projects: [], skipped: 0 });
  });

  it('reads the { projects: [...] } container', () => {
    const raw = JSON.stringify({ schemaVersion: 1, projects: [validProject] });
    expect(deserializeProjects(raw)).toEqual({ projects: [validProject], skipped: 0 });
  });

  it('reads a bare array for forward/backward tolerance', () => {
    const raw = JSON.stringify([validProject]);
    expect(deserializeProjects(raw).projects).toHaveLength(1);
  });

  it('skips invalid entries and reports the count', () => {
    const raw = JSON.stringify({
      projects: [validProject, { id: '' }, { id: 'ok', params: { widthCm: 1 } }, null],
    });
    const result = deserializeProjects(raw);

    expect(result.projects).toHaveLength(1);
    expect(result.skipped).toBe(3);
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
