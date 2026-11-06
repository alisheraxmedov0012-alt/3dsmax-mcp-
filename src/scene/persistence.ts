/**
 * Phase 6.2 — what a scene may look like once it leaves the session.
 *
 * An imported model's geometry lives in the runtime store, not in `SceneData`
 * (a stored scene must fit the 2 MiB server payload and the `localStorage`
 * quota). Saving the object's *metadata* without its mesh would create a record
 * that can never render: after a reload the object would sit in the hierarchy and
 * fail to build.
 *
 * So the persisted form of a scene contains parametric objects only, and the count
 * of what was left out travels with it so the caller can tell the user instead of
 * dropping work silently.
 */
import type { SceneData } from './types';

export interface PersistableScene {
  readonly scene: SceneData;
  /** Imported objects left out of the persisted form. */
  readonly droppedImported: number;
}

/** Strips the session-only objects from a scene, leaving the parametric scene. */
export function sceneForPersistence(data: SceneData): PersistableScene {
  const objects = data.objects.filter((object) => object.type !== 'imported');
  const droppedImported = data.objects.length - objects.length;
  if (droppedImported === 0) {
    // Return the same reference so callers can keep identity comparisons cheap.
    return { scene: data, droppedImported: 0 };
  }
  return { scene: { ...data, objects }, droppedImported };
}
