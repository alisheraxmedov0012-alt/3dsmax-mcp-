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
import {
  createFurnitureSceneObject,
  createTableSceneObject,
  SCENE_SCHEMA_VERSION,
  type SceneData,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';

function makeScene(): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
    objects: [createTableSceneObject('obj-1')],
    settings: createDefaultSettings(),
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

  it('migrates a v2 scene (no settings) by adding default visualization settings', () => {
    const v2 = {
      id: 'v2-1',
      name: 'Stage 5 loyiha',
      scene: {
        schemaVersion: 2,
        room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
        objects: [createTableSceneObject('t1')],
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      schemaVersion: 2,
    };

    const result = validateSavedProject(v2);
    expect(result?.schemaVersion).toBe(PROJECTS_SCHEMA_VERSION);
    expect(result?.scene.settings.background).toBe('#1b1f24');
    expect(result?.scene.settings.cameraPreset).toBe('iso');
  });

  it('preserves visualization settings and material on round-trip', () => {
    const project: SavedProject = {
      ...validProject,
      scene: {
        ...validProject.scene,
        settings: {
          background: '#101820',
          lights: {
            ambientIntensity: 0.5,
            ambientColor: '#ffffff',
            keyEnabled: false,
            keyIntensity: 3,
            keyColor: '#ffcc00',
            fillEnabled: true,
            fillIntensity: 0.2,
            fillColor: '#ffffff',
            shadowsEnabled: false,
          },
          roomMaterials: { floorColor: '#111111', wallColor: '#222222', ceilingColor: '#333333' },
          cameraPreset: 'top',
          lightingPreset: 'warmInterior',
          qualityPreset: 'high',
          exposure: 1.4,
          toneMapping: 'reinhard',
        },
        objects: [createTableSceneObject('t1', { material: { metalness: 0.8, roughness: 0.3 } })],
      },
    };

    const raw = serializeProjects([project]);
    const [restored] = deserializeProjects(raw).projects;

    expect(restored.scene.settings.background).toBe('#101820');
    expect(restored.scene.settings.lights.keyEnabled).toBe(false);
    expect(restored.scene.settings.lights.keyIntensity).toBe(3);
    expect(restored.scene.settings.roomMaterials.floorColor).toBe('#111111');
    expect(restored.scene.settings.cameraPreset).toBe('top');
    expect(restored.scene.settings.lightingPreset).toBe('warmInterior');
    expect(restored.scene.settings.qualityPreset).toBe('high');
    expect(restored.scene.settings.exposure).toBeCloseTo(1.4, 5);
    expect(restored.scene.settings.toneMapping).toBe('reinhard');
    expect(restored.scene.objects[0].material).toEqual({ metalness: 0.8, roughness: 0.3 });
  });

  it('round-trips a scene mixing several W2 furniture types', () => {
    const project: SavedProject = {
      ...validProject,
      scene: {
        ...validProject.scene,
        objects: [
          createTableSceneObject('t1'),
          createFurnitureSceneObject('sofa', 's1', { position: { x: 50, y: 0, z: -30 } }),
          createFurnitureSceneObject('wardrobe', 'w1'),
          createFurnitureSceneObject('bed', 'b1'),
        ],
      },
    };

    const raw = serializeProjects([project]);
    const [restored] = deserializeProjects(raw).projects;

    expect(restored.scene.objects.map((object) => object.type)).toEqual([
      'table',
      'sofa',
      'wardrobe',
      'bed',
    ]);
    // Type-specific channels survive the round-trip.
    expect(restored.scene.objects[1].params).toEqual(project.scene.objects[1].params);
    expect(restored.scene.objects[2].params).toEqual(project.scene.objects[2].params);
  });

  it('round-trips W6 room ceiling, openings and furniture placement', () => {
    const project: SavedProject = {
      ...validProject,
      scene: {
        ...validProject.scene,
        room: {
          widthCm: 520,
          lengthCm: 640,
          heightCm: 290,
          showCeiling: true,
          openings: [
            { id: 'd1', kind: 'door', wall: 'south', offsetCm: 0, widthCm: 90, heightCm: 205, sillCm: 0 },
            { id: 'w1', kind: 'window', wall: 'east', offsetCm: -80, widthCm: 130, heightCm: 120, sillCm: 95 },
          ],
        },
        objects: [
          createFurnitureSceneObject('sofa', 's1', {
            position: { x: -200, y: 0, z: -280 },
            rotation: { x: 0, y: 0, z: 0 },
          }),
          createFurnitureSceneObject('bed', 'b1', { rotation: { x: 0, y: 180, z: 0 } }),
        ],
      },
    };

    const raw = serializeProjects([project]);
    const [restored] = deserializeProjects(raw).projects;

    expect(restored.scene.room.showCeiling).toBe(true);
    expect(restored.scene.room.openings?.map((entry) => entry.id)).toEqual(['d1', 'w1']);
    expect(restored.scene.objects[0].position).toEqual({ x: -200, y: 0, z: -280 });
    expect(restored.scene.objects[1].rotation.y).toBe(180);
  });

  it('opens an old Stage 6 project without W6 fields', () => {
    // An old project has no showCeiling/openings — it must open unchanged.
    const [restored] = deserializeProjects(serializeProjects([validProject])).projects;
    expect(restored.scene.room.showCeiling).toBeUndefined();
    expect(restored.scene.room.openings).toBeUndefined();
    expect(restored.scene.room.widthCm).toBe(validProject.scene.room.widthCm);
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
