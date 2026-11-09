/**
 * Phase 9A.2.10 — undo/redo keyboard policy.
 *
 * Kept pure so the platform shortcuts, text-input guard and gizmo-drag guard
 * are testable without a live React tree or WebGL context.
 */
export type HistoryShortcut = 'undo' | 'redo';

export interface HistoryShortcutEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly target?: EventTarget | null;
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True for form fields and contentEditable hosts where Ctrl+Z is text editing. */
export function isEditableShortcutTarget(target: EventTarget | null | undefined): boolean {
  if (!target) {
    return false;
  }
  const element = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
  };
  if (element.isContentEditable === true) {
    return true;
  }
  const tagName =
    typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  return EDITABLE_TAGS.has(tagName);
}

/**
 * Resolve Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and the Windows Ctrl+Y convention.
 * Alt combos and unmodified keys are left to the browser; a gizmo drag wins over
 * every shortcut.
 */
export function resolveHistoryShortcut(
  event: HistoryShortcutEvent,
  options: { readonly isTransforming?: boolean } = {},
): HistoryShortcut | null {
  if (options.isTransforming === true || event.altKey) {
    return null;
  }
  if (!event.ctrlKey && !event.metaKey) {
    return null;
  }
  if (isEditableShortcutTarget(event.target)) {
    return null;
  }
  const key = event.key.toLowerCase();
  if (key === 'z') {
    return event.shiftKey ? 'redo' : 'undo';
  }
  if (key === 'y' && !event.shiftKey) {
    return 'redo';
  }
  return null;
}
