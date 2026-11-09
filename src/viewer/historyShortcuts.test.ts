import { describe, expect, it } from 'vitest';
import {
  isEditableShortcutTarget,
  resolveHistoryShortcut,
  type HistoryShortcutEvent,
} from './historyShortcuts';

function event(overrides: Partial<HistoryShortcutEvent> = {}): HistoryShortcutEvent {
  return {
    key: 'z',
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    target: null,
    ...overrides,
  };
}

describe('9A.2.10 — undo/redo keyboard policy', () => {
  it('maps Ctrl+Z to undo and Ctrl+Shift+Z to redo', () => {
    expect(resolveHistoryShortcut(event())).toBe('undo');
    expect(resolveHistoryShortcut(event({ shiftKey: true }))).toBe('redo');
    expect(resolveHistoryShortcut(event({ key: 'Z', shiftKey: true }))).toBe('redo');
  });

  it('supports Cmd on macOS and Ctrl+Y on Windows', () => {
    expect(resolveHistoryShortcut(event({ ctrlKey: false, metaKey: true }))).toBe('undo');
    expect(resolveHistoryShortcut(event({ key: 'y' }))).toBe('redo');
  });

  it('ignores unmodified keys, other keys and Alt combos', () => {
    expect(resolveHistoryShortcut(event({ ctrlKey: false }))).toBeNull();
    expect(resolveHistoryShortcut(event({ key: 'a' }))).toBeNull();
    expect(resolveHistoryShortcut(event({ altKey: true }))).toBeNull();
    expect(resolveHistoryShortcut(event({ key: 'y', shiftKey: true }))).toBeNull();
  });

  it('does not steal shortcuts from inputs, textareas, selects or contentEditable', () => {
    expect(resolveHistoryShortcut(event({ target: { tagName: 'INPUT' } as never }))).toBeNull();
    expect(resolveHistoryShortcut(event({ target: { tagName: 'textarea' } as never }))).toBeNull();
    expect(resolveHistoryShortcut(event({ target: { tagName: 'SELECT' } as never }))).toBeNull();
    expect(
      resolveHistoryShortcut(event({ target: { tagName: 'DIV', isContentEditable: true } as never })),
    ).toBeNull();
    expect(resolveHistoryShortcut(event({ target: { tagName: 'DIV' } as never }))).toBe('undo');
  });

  it('reports editable targets through the exported helper', () => {
    expect(isEditableShortcutTarget(null)).toBe(false);
    expect(isEditableShortcutTarget(undefined)).toBe(false);
    expect(isEditableShortcutTarget({ tagName: 'INPUT' } as never)).toBe(true);
    expect(isEditableShortcutTarget({ tagName: 'SPAN' } as never)).toBe(false);
  });

  it('never fires while a gizmo drag owns the pointer', () => {
    expect(resolveHistoryShortcut(event(), { isTransforming: true })).toBeNull();
    expect(resolveHistoryShortcut(event({ shiftKey: true }), { isTransforming: true })).toBeNull();
  });
});
