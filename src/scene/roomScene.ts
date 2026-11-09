/**
 * Phase 9A.2.7 — scene assembly for opt-in room instances.
 *
 * The viewer and the export pipeline both need the same thing: turn every
 * validated `RoomInstance` into a Three.js group through the existing
 * `buildRoomInstance()` pipeline, skip a room that fails to build, and keep a
 * disposer for its geometry and materials.
 *
 * Keeping that policy here means the WebGL viewer and the exporter cannot drift
 * apart, and neither needs its own geometry builder.
 */
import type * as THREE from 'three';
import { tryBuildRoomInstance, type RoomInstanceIssue } from './roomInstance';
import type { RoomInstance } from './types';

export interface BuiltRoomEntry {
  readonly roomId: string;
  readonly group: THREE.Group;
  dispose: () => void;
}

export type RoomEntryBuildResult =
  | { readonly ok: true; readonly entry: BuiltRoomEntry }
  | { readonly ok: false; readonly issues: readonly RoomInstanceIssue[] };

/**
 * Build one room without throwing. Validation runs again here so a programmatic
 * caller that bypassed `validateSceneData` still cannot get broken geometry.
 */
export function buildRoomEntry(room: RoomInstance): RoomEntryBuildResult {
  const result = tryBuildRoomInstance(room);
  if (!result.ok) {
    return { ok: false, issues: result.issues };
  }
  return {
    ok: true,
    entry: {
      roomId: room.id,
      group: result.built.group,
      dispose: result.built.dispose,
    },
  };
}

export interface BuiltSceneRooms {
  readonly entries: readonly BuiltRoomEntry[];
  /** Issues from rooms that were skipped; always present, empty when all built. */
  readonly issues: readonly RoomInstanceIssue[];
}

/**
 * Build every room in order. A failed room is skipped, and the remaining rooms
 * still build: one corrupt record must not blank the whole scene or export.
 */
export function buildSceneRooms(rooms: readonly RoomInstance[] | undefined): BuiltSceneRooms {
  const entries: BuiltRoomEntry[] = [];
  const issues: RoomInstanceIssue[] = [];
  for (const room of rooms ?? []) {
    const result = buildRoomEntry(room);
    if (result.ok) {
      entries.push(result.entry);
    } else {
      issues.push(...result.issues);
    }
  }
  return { entries, issues };
}

/** Dispose every built room and clear its parent link. */
export function disposeRoomEntries(entries: readonly BuiltRoomEntry[]): void {
  for (const entry of entries) {
    entry.group.removeFromParent();
    entry.dispose();
  }
}

/**
 * Should the legacy `SceneData.room` be rendered next to the opt-in rooms?
 *
 * The legacy room predates `SceneData.rooms` and is the only room the old
 * viewer/export path knows. When an opt-in room exists it supersedes it, which
 * prevents two rooms being drawn on top of each other; a legacy-only scene is
 * completely unaffected.
 */
export function includeLegacyRoom(rooms: readonly RoomInstance[] | undefined): boolean {
  return !rooms || rooms.length === 0;
}
