/**
 * Phase 9A.2.9 — universal selection identity.
 *
 * Furniture objects use their scene-object id; opt-in rooms are addressed with
 * a prefixed id so the two namespaces can never collide. The existing legacy
 * room keeps its `ROOM_OBJECT_ID` selection id. The viewer, highlight helper and
 * transform gizmo all resolve a selection through this module, so there is one
 * selection model rather than a room-only fork.
 */
import type * as THREE from 'three';
import { ROOM_OBJECT_ID } from '../scene/types';
import {
  roomSelectionId,
  parseRoomSelectionId,
  ROOM_SELECTION_PREFIX,
} from '../scene/selectionIds';

export { roomSelectionId, parseRoomSelectionId, ROOM_SELECTION_PREFIX };

export type SelectionTargetKind = 'object' | 'room' | 'legacy-room';

export interface SelectionTarget {
  readonly kind: SelectionTargetKind;
  readonly selectionId: string;
  readonly group: THREE.Object3D;
  readonly roomId?: string;
  readonly objectId?: string;
}

export interface SelectionGroupEntry {
  readonly group: THREE.Object3D;
}

/**
 * Resolve the current selection id to the group a highlight/gizmo should use.
 * Hidden groups are not selectable; the legacy room is always available.
 */
export function resolveSelectionTarget(
  selectedId: string | null,
  legacyRoom: THREE.Object3D | null,
  rooms: ReadonlyMap<string, SelectionGroupEntry>,
  objects: ReadonlyMap<string, SelectionGroupEntry>,
): SelectionTarget | null {
  if (!selectedId) {
    return null;
  }
  if (selectedId === ROOM_OBJECT_ID) {
    return legacyRoom
      ? {
          kind: 'legacy-room',
          selectionId: ROOM_OBJECT_ID,
          group: legacyRoom,
        }
      : null;
  }

  const roomId = parseRoomSelectionId(selectedId);
  if (roomId !== null) {
    const entry = rooms.get(roomId);
    if (!entry || !entry.group.visible) {
      return null;
    }
    return {
      kind: 'room',
      selectionId: selectedId,
      group: entry.group,
      roomId,
    };
  }

  const entry = objects.get(selectedId);
  if (!entry || !entry.group.visible) {
    return null;
  }
  return {
    kind: 'object',
    selectionId: selectedId,
    group: entry.group,
    objectId: selectedId,
  };
}

export type SceneHitKind = 'room' | 'object';

export interface SceneHit {
  readonly selectionId: string;
  readonly kind: SceneHitKind;
  /** Ray distance in scene centimetres. */
  readonly distance: number;
}

/**
 * Pick one hit from a distance-sorted raycast result.
 *
 * Furniture wins a near-tie over a room shell (a desk standing against a wall
 * should be clickable), but a room surface that is clearly in front still wins:
 * furniture behind a wall is never selected through it.
 */
export function pickSelectionFromHits(
  hits: readonly SceneHit[],
  tieToleranceCm = 0.5,
): string | null {
  let roomHit: SceneHit | null = null;
  let objectHit: SceneHit | null = null;
  for (const hit of hits) {
    if (hit.kind === 'room') {
      if (!roomHit || hit.distance < roomHit.distance) {
        roomHit = hit;
      }
    } else if (!objectHit || hit.distance < objectHit.distance) {
      objectHit = hit;
    }
  }
  if (objectHit && (!roomHit || objectHit.distance <= roomHit.distance + tieToleranceCm)) {
    return objectHit.selectionId;
  }
  return roomHit?.selectionId ?? null;
}
