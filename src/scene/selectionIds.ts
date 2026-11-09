/**
 * Selection ids shared by the reducer, hierarchy and viewer.
 *
 * Furniture and imported models use their scene-object id; opt-in rooms use a
 * prefixed id so the namespaces cannot collide, and the legacy room keeps
 * `ROOM_OBJECT_ID`.
 */
import { ROOM_OBJECT_ID } from './types';

export const ROOM_SELECTION_PREFIX = 'room-instance:';

export function roomSelectionId(roomId: string): string {
  return `${ROOM_SELECTION_PREFIX}${roomId}`;
}

export function parseRoomSelectionId(selectionId: string | null): string | null {
  if (!selectionId || !selectionId.startsWith(ROOM_SELECTION_PREFIX)) {
    return null;
  }
  const roomId = selectionId.slice(ROOM_SELECTION_PREFIX.length);
  return roomId === '' ? null : roomId;
}

/** True when a selection id addresses the legacy, config-driven room. */
export function isLegacyRoomSelection(selectionId: string | null): boolean {
  return selectionId === ROOM_OBJECT_ID;
}
