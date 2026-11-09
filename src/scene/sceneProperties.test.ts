import { describe, expect, it } from 'vitest';
import { parseSceneJson, serializeSceneToJson } from '../export/sceneJson';
import { ROOM_STANDARD_DEFINITION_ID } from '../geometry/interior/roomDefinition';
import { DEFAULT_ROOM_SPEC } from '../geometry/interior/roomSpec';
import { createRoomInstance, roomInstanceGeometryKey } from './roomInstance';
import { sceneReducer } from './sceneReducer';
import { roomSelectionId } from './selectionIds';
import {
  OBJECT_NAME_MAX_LENGTH,
  createDefaultSceneState,
  createTableSceneObject,
  type RoomInstance,
  type SceneState,
} from './types';

const EXPORT_METADATA = { name: 'Properties', furnitureType: null, units: 'cm' as const };
const EXPORT_TIME = '2026-01-01T00:00:00.000Z';

function room(id = 'room-a', name = 'Xona A'): RoomInstance {
  return {
    ...createRoomInstance(ROOM_STANDARD_DEFINITION_ID, id, {
      ...DEFAULT_ROOM_SPEC,
      showCeiling: false,
    }),
    name,
  };
}

function state(): SceneState {
  const base = createDefaultSceneState(() => 'unused');
  return {
    data: {
      ...base.data,
      rooms: [room()],
      objects: [createTableSceneObject('table-1', { name: 'Stol A' })],
    },
    selectedId: roomSelectionId('room-a'),
  };
}

describe('9A.2.11 — visibility and rename history', () => {
  it('hides and shows a room with selection clearing and undo/redo', () => {
    const before = state();
    const hidden = sceneReducer(before, { type: 'TOGGLE_ROOM_VISIBILITY', id: 'room-a' });
    expect(hidden.data.rooms?.[0].visible).toBe(false);
    expect(hidden.selectedId).toBeNull();
    expect(hidden.history?.past[0]).toMatchObject({
      kind: 'visibility',
      entityType: 'room',
      entityId: 'room-a',
      before: true,
      after: false,
    });

    const undo = sceneReducer(hidden, { type: 'UNDO' });
    expect(undo.data.rooms?.[0].visible).toBe(true);
    expect(undo.selectedId).toBeNull();
    const redo = sceneReducer(undo, { type: 'REDO' });
    expect(redo.data.rooms?.[0].visible).toBe(false);
  });

  it('hides and shows furniture with one history command', () => {
    const before = { ...state(), selectedId: 'table-1' };
    const hidden = sceneReducer(before, { type: 'TOGGLE_VISIBILITY', id: 'table-1' });
    expect(hidden.data.objects[0].visible).toBe(false);
    expect(hidden.selectedId).toBeNull();
    expect(hidden.history?.past).toHaveLength(1);
    const undo = sceneReducer(hidden, { type: 'UNDO' });
    expect(undo.data.objects[0].visible).toBe(true);
    const redo = sceneReducer(undo, { type: 'REDO' });
    expect(redo.data.objects[0].visible).toBe(false);
    expect(redo.history?.past).toHaveLength(1);
  });

  it('renames rooms and furniture with undo/redo and rejects blanks', () => {
    const before = state();
    const renamedRoom = sceneReducer(before, {
      type: 'RENAME_ROOM',
      id: 'room-a',
      name: '  Mehmonxona  ',
    });
    expect(renamedRoom.data.rooms?.[0].name).toBe('Mehmonxona');
    expect(renamedRoom.history?.past[0]).toMatchObject({
      kind: 'rename',
      entityType: 'room',
      before: 'Xona A',
      after: 'Mehmonxona',
    });

    const renamedObject = sceneReducer(renamedRoom, {
      type: 'RENAME_OBJECT',
      id: 'table-1',
      name: 'Yozuv stoli',
    });
    expect(renamedObject.data.objects[0].name).toBe('Yozuv stoli');
    expect(renamedObject.history?.past.map((entry) => entry.kind)).toEqual([
      'rename',
      'rename',
    ]);

    const undoObject = sceneReducer(renamedObject, { type: 'UNDO' });
    expect(undoObject.data.objects[0].name).toBe('Stol A');
    const undoRoom = sceneReducer(undoObject, { type: 'UNDO' });
    expect(undoRoom.data.rooms?.[0].name).toBe('Xona A');
    const redoRoom = sceneReducer(undoRoom, { type: 'REDO' });
    expect(redoRoom.data.rooms?.[0].name).toBe('Mehmonxona');
  });

  it('rejects blank names and truncates overlong names', () => {
    const before = state();
    expect(
      sceneReducer(before, { type: 'RENAME_ROOM', id: 'room-a', name: '   ' }),
    ).toBe(before);
    expect(
      sceneReducer(before, { type: 'RENAME_OBJECT', id: 'table-1', name: '' }),
    ).toBe(before);

    const long = sceneReducer(before, {
      type: 'RENAME_ROOM',
      id: 'room-a',
      name: 'x'.repeat(200),
    });
    expect(long.data.rooms?.[0].name).toHaveLength(OBJECT_NAME_MAX_LENGTH);
  });

  it('changes the display name without changing the geometry key', () => {
    const base = room();
    const renamed = { ...base, name: 'Yangi nom' };
    expect(roomInstanceGeometryKey(renamed)).toBe(roomInstanceGeometryKey(base));
  });

  it('keeps unknown ids inert', () => {
    const before = state();
    expect(
      sceneReducer(before, { type: 'RENAME_ROOM', id: 'missing', name: 'X' }),
    ).toBe(before);
    expect(
      sceneReducer(before, { type: 'TOGGLE_ROOM_VISIBILITY', id: 'missing' }),
    ).toBe(before);
    expect(
      sceneReducer(before, { type: 'TOGGLE_VISIBILITY', id: 'missing' }),
    ).toBe(before);
  });

  it('round-trips room and furniture names through scene JSON', () => {
    const renamed = sceneReducer(
      sceneReducer(state(), { type: 'RENAME_ROOM', id: 'room-a', name: 'Mehmonxona' }),
      { type: 'RENAME_OBJECT', id: 'table-1', name: 'Yozuv stoli' },
    );
    const parsed = parseSceneJson(
      serializeSceneToJson(renamed.data, EXPORT_METADATA, EXPORT_TIME),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.scene.rooms?.[0].name).toBe('Mehmonxona');
    expect(parsed.scene.objects[0].name).toBe('Yozuv stoli');
  });

  it('orders visibility and transform commands in one stack', () => {
    const moved = sceneReducer(state(), {
      type: 'UPDATE_ROOM_TRANSFORM',
      id: 'room-a',
      position: { x: 50 },
      recordHistory: true,
    });
    const hidden = sceneReducer(moved, { type: 'TOGGLE_ROOM_VISIBILITY', id: 'room-a' });
    expect(hidden.history?.past.map((entry) => entry.kind)).toEqual([
      'transform',
      'visibility',
    ]);
    const undoHide = sceneReducer(hidden, { type: 'UNDO' });
    expect(undoHide.data.rooms?.[0].visible).toBe(true);
    expect(undoHide.data.rooms?.[0].position.x).toBe(50);
    const undoMove = sceneReducer(undoHide, { type: 'UNDO' });
    expect(undoMove.data.rooms?.[0].position.x).toBe(0);
  });
});
