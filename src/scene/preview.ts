/**
 * Stage 3.4 — AI preview overlay.
 *
 * A preview is a *render-only* view of the scene: the selected object is shown
 * with the proposed spec while `SceneState` (and therefore saving and export)
 * still holds the applied one. Nothing here mutates the scene data.
 */
import type { SceneData, SceneObject, SceneSpec } from './types';

export interface SpecPreview {
  readonly objectId: string;
  readonly definitionId: string;
  /** Spec the proposal was computed from; identity marks a stale preview. */
  readonly baseSpec: SceneSpec;
  readonly spec: SceneSpec;
}

/**
 * A preview only applies while the same object is selected *and* its spec is
 * still the one the proposal was computed from. An applied edit, undo/redo or a
 * different selection therefore invalidates it without extra bookkeeping.
 */
export function isPreviewApplicable(
  preview: SpecPreview | null,
  object: SceneObject | null,
): preview is SpecPreview {
  return Boolean(
    preview &&
      object &&
      object.id === preview.objectId &&
      object.definitionId === preview.definitionId &&
      object.spec === preview.baseSpec,
  );
}

/** Render-only copy of the scene with the preview spec applied. */
export function previewScene(data: SceneData, preview: SpecPreview): SceneData {
  const index = data.objects.findIndex((object) => object.id === preview.objectId);
  if (index === -1) {
    return data;
  }
  const objects = data.objects.slice();
  objects[index] = { ...objects[index], spec: preview.spec };
  return { ...data, objects };
}

export interface SpecChange {
  readonly key: string;
  readonly before: number | string | boolean | undefined;
  readonly after: number | string | boolean | undefined;
}

/** Parameter-level difference between two specs, in the first spec's key order. */
export function diffSpecs(before: SceneSpec, after: SceneSpec): SpecChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: SpecChange[] = [];
  for (const key of keys) {
    if (before[key] !== after[key]) {
      changes.push({ key, before: before[key], after: after[key] });
    }
  }
  return changes;
}

/**
 * Image exports must never show a proposal that has not been applied.
 *
 * The viewer renders the preview, so any canvas/PNG capture would otherwise bake
 * unconfirmed geometry into a deliverable. The caller blocks the capture and
 * shows this message.
 */
export const PREVIEW_CAPTURE_MESSAGE = "Avval AI o‘zgarishini Apply yoki Cancel qiling.";

export function previewCaptureBlockReason(preview: SpecPreview | null): string | null {
  return preview ? PREVIEW_CAPTURE_MESSAGE : null;
}
