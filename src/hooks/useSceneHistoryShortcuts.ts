import { useEffect } from 'react';

/**
 * Keyboard shortcuts for undo/redo:
 * - `Ctrl/Cmd+Z` → undo
 * - `Ctrl/Cmd+Shift+Z` and `Ctrl/Cmd+Y` → redo
 *
 * Ignored while the user is typing, so `Ctrl+Z` inside a text field keeps its
 * native meaning for that field instead of rewinding the whole scene.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function useSceneHistoryShortcuts(
  undo: () => void,
  redo: () => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, enabled]);
}
