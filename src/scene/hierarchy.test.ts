import { describe, expect, it } from 'vitest';
import { ROOM_STANDARD_DEFINITION_ID } from '../geometry/interior/roomDefinition';
import { DEFAULT_ROOM_SPEC } from '../geometry/interior/roomSpec';
import { buildSceneHierarchy } from './hierarchy';
import { createRoomInstance } from './roomInstance';
import { roomSelectionId } from './selectionIds';
import {
  ROOM_DEFAULTS,
  ROOM_OBJECT_ID,
  SCENE_SCHEMA_VERSION,
  createImportedSceneObject,
  createTableSceneObject,
  type RoomInstance,
  type SceneData,
} from './types';

function room(id: string, name: string, overrides: Partial<RoomInstance> = {}): RoomInstance {
  return {
    ...createRoomInstance(ROOM_STANDARD_DEFINITION_ID, id, {
      ...DEFAULT_ROOM_SPEC,
      showCeiling: false,
    }),
    name,
    ...overrides,
  };
}

function source(overrides: Partial<Pick<SceneData, 'rooms' | 'objects'>> = {}) {
  return {
    room: { ...ROOM_DEFAULTS },
    rooms: overrides.rooms,
    objects: overrides.objects ?? [],
    schemaVersion: SCENE_SCHEMA_VERSION,
  } as SceneData;
}

describe('9A.2.11 — derived scene hierarchy', () => {
  it('builds an empty scene with only the legacy room', () => {
    const hierarchy = buildSceneHierarchy(source(), null);
    expect(hierarchy.rooms).toHaveLength(1);
    expect(hierarchy.rooms[0]).toMatchObject({
      id: ROOM_OBJECT_ID,
      entityType: 'legacy-room',
      displayName: 'Xona',
      visible: true,
      canRename: false,
      canToggleVisibility: false,
      canFocus: true,
    });
    expect(hierarchy.furniture).toEqual([]);
    expect(hierarchy.isEmpty).toBe(true);
  });

  it('builds furniture, room, legacy and imported items with stable ids', () => {
    const table = createTableSceneObject('table-1', { name: 'Ish stoli' });
    const imported = createImportedSceneObject('import-1', {
      format: 'glb',
      fileName: 'model.glb',
      sourceBytes: 100,
      meshes: 1,
      triangles: 12,
      materials: 1,
      textures: 0,
      sourceHash: 'hash',
      boundsCm: { min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 50, z: 40 } },
    });
    const hierarchy = buildSceneHierarchy(
      source({
        rooms: [room('room-a', 'Mehmonxona')],
        objects: [table, imported],
      }),
      roomSelectionId('room-a'),
    );

    expect(hierarchy.rooms.map((item) => item.id)).toEqual([
      ROOM_OBJECT_ID,
      roomSelectionId('room-a'),
    ]);
    expect(hierarchy.rooms[1]).toMatchObject({
      entityId: 'room-a',
      entityType: 'room',
      displayName: 'Mehmonxona',
      selected: true,
      canRename: true,
      canToggleVisibility: true,
      canFocus: true,
    });
    expect(hierarchy.furniture[0]).toMatchObject({
      id: 'table-1',
      entityType: 'furniture',
      displayName: 'Ish stoli',
      selected: false,
      canDelete: true,
    });
    expect(hierarchy.furniture[1]).toMatchObject({
      id: 'import-1',
      entityType: 'imported',
      displayName: 'model.glb',
      typeLabel: 'Import',
      meta: '100 × 50 × 40 sm · import',
      canDelete: true,
    });
  });

  it('keeps scene order, legacy first, and marks exactly one selection', () => {
    const hierarchy = buildSceneHierarchy(
      source({
        rooms: [room('room-b', 'B xona'), room('room-a', 'A xona')],
        objects: [
          createTableSceneObject('table-b', { name: 'B stol' }),
          createTableSceneObject('table-a', { name: 'A stol' }),
        ],
      }),
      'table-a',
    );
    expect(hierarchy.rooms.map((item) => item.entityId)).toEqual([
      ROOM_OBJECT_ID,
      'room-b',
      'room-a',
    ]);
    expect(hierarchy.furniture.map((item) => item.entityId)).toEqual(['table-b', 'table-a']);
    expect(hierarchy.items.filter((item) => item.selected).map((item) => item.id)).toEqual([
      'table-a',
    ]);
  });

  it('mirrors visibility and supplies stable fallback names', () => {
    const unnamedRoom = room('room-c', '   ');
    const unnamedObject = createTableSceneObject('table-1', { name: '   ' });
    const hiddenObject = createTableSceneObject('table-2', {
      name: 'Yashirin',
      visible: false,
    });
    const hierarchy = buildSceneHierarchy(
      source({ rooms: [unnamedRoom], objects: [unnamedObject, hiddenObject] }),
      null,
    );
    expect(hierarchy.rooms[1].displayName).toBe('Xona room-c');
    expect(hierarchy.furniture[0].displayName).toBe('table');
    expect(hierarchy.furniture[1]).toMatchObject({ visible: false, displayName: 'Yashirin' });
  });
});
