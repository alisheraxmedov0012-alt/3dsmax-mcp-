/**
 * Phase 9A.2.10 — toolbar undo/redo controls.
 *
 * Presentational only: disabled state mirrors the real history stacks and the
 * callbacks dispatch the universal UNDO/REDO actions in App.
 */
interface HistoryControlsProps {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}

export function HistoryControls({ canUndo, canRedo, onUndo, onRedo }: HistoryControlsProps) {
  return (
    <div className="stage__modes" role="group" aria-label="Tarix">
      <button
        type="button"
        className="stage__button"
        onClick={onUndo}
        disabled={!canUndo}
        title="Bekor qilish (Ctrl+Z)"
        aria-label="Bekor qilish"
      >
        ↶
      </button>
      <button
        type="button"
        className="stage__button"
        onClick={onRedo}
        disabled={!canRedo}
        title="Qayta qilish (Ctrl+Shift+Z)"
        aria-label="Qayta qilish"
      >
        ↷
      </button>
    </div>
  );
}
