/**
 * Phase 4.3B — viewport texture resolution status per scene object.
 *
 * The viewer resolves textures asynchronously. The material panel needs to show
 * loading/failure without being coupled to the renderer, so the viewer writes a
 * tiny status record and the panel subscribes to it.
 */
export type TextureResolutionState = 'loading' | 'ready' | 'error';

export interface TextureResolutionStatus {
  state: TextureResolutionState;
  message?: string;
}

const statuses = new Map<string, TextureResolutionStatus>();
const listeners = new Map<string, Set<() => void>>();

function notify(objectId: string): void {
  for (const listener of listeners.get(objectId) ?? []) {
    listener();
  }
}

export function setTextureResolutionStatus(
  objectId: string,
  status: TextureResolutionStatus,
): void {
  statuses.set(objectId, status);
  notify(objectId);
}

export function clearTextureResolutionStatus(objectId: string): void {
  if (statuses.delete(objectId)) {
    notify(objectId);
  }
}

export function getTextureResolutionStatus(
  objectId: string | null | undefined,
): TextureResolutionStatus | undefined {
  return objectId ? statuses.get(objectId) : undefined;
}

export function subscribeTextureResolution(
  objectId: string,
  listener: () => void,
): () => void {
  const set = listeners.get(objectId) ?? new Set<() => void>();
  set.add(listener);
  listeners.set(objectId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) {
      listeners.delete(objectId);
    }
  };
}
