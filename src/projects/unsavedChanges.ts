import type { SceneData } from '../scene/types';

/**
 * Unsaved-changes helpers.
 *
 * The scene is compared by a cheap signature rather than object identity, so a
 * re-render that did not change the data is not treated as a change. This drives
 * the "leave without saving?" protection; it is deliberately conservative — it
 * only ever signals *more* dirtiness, never less.
 */

export function sceneSignature(name: string, scene: SceneData): string {
  return JSON.stringify({ name: name.trim(), scene });
}

export function hasUnsavedChanges(currentSignature: string, savedSignature: string): boolean {
  return currentSignature !== savedSignature;
}

/** Unload protection is active only when there is unsaved work not being saved. */
export function shouldProtectUnload(dirty: boolean, saving: boolean): boolean {
  return dirty && !saving;
}
