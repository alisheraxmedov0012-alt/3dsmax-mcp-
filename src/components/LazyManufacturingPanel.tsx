/**
 * C8.3 — lazy boundary for the manufacturing panel.
 *
 * The panel is the only consumer of the whole manufacturing document stack: the
 * BOM and cut-list builders, the technical drawing generator, the C1/C8 package
 * builders, validation, assembly instructions, the cutting optimiser and the
 * product description. None of it is needed to render the first screen, so it
 * now lives in its own chunk instead of the entry bundle.
 *
 * Why a boundary rather than a conditional render: `ManufacturingPanel` is
 * mounted unconditionally (it shows a "pick a piece" hint when nothing is
 * selected), so there is no state in the app that can be used to defer it
 * without changing behaviour. A lazy boundary moves the work off the critical
 * path — the shell paints without waiting for it — while keeping the mount point
 * stable, so the panel keeps its own state across parent re-renders.
 *
 * Failure modes are handled explicitly: a placeholder that reserves the panel's
 * shape while the chunk downloads, and an error state with a retry if the chunk
 * request fails (which would otherwise unmount the whole app, since React.lazy
 * re-throws the import error during render).
 */
import { Component, Suspense, lazy, type ReactNode } from 'react';
import type { SceneData, SceneObject } from '../scene/types';
import type { SheetMaterialId } from '../manufacturing/sheetMaterial';
import type { PngPreset } from '../export/sceneImage';

const ManufacturingPanel = lazy(() =>
  import('./ManufacturingPanel').then((module) => ({ default: module.ManufacturingPanel })),
);

interface LazyManufacturingPanelProps {
  object: SceneObject | null;
  projectName: string;
  scene: SceneData;
  onAssignSheetMaterial?: (partId: string, materialId: SheetMaterialId, thicknessMm: number) => void;
  onRemoveSheetMaterial?: (partId: string) => void;
  onCapturePreview?: (preset: PngPreset) => Promise<Blob | null>;
  /** A2.2: multi-angle product shots for the ZIP, or null when unavailable. */
  onCaptureProductPreviews?: () => Promise<Array<{ name: string; bytes: Uint8Array }> | null>;
}

/** Occupies the panel's slot so the sidebar does not jump when it arrives. */
export function ManufacturingPanelLoading() {
  return (
    <section className="manufacturing" data-testid="manufacturing-loading" role="status" aria-live="polite">
      <h2 className="manufacturing__title">Ishlab chiqarishga tayyorlash</h2>
      <p className="visual__hint">Panel yuklanmoqda…</p>
    </section>
  );
}

interface ManufacturingPanelFailureProps {
  onRetry: () => void;
}

export function ManufacturingPanelFailure({ onRetry }: ManufacturingPanelFailureProps) {
  return (
    <section className="manufacturing" data-testid="manufacturing-error" role="alert">
      <h2 className="manufacturing__title">Ishlab chiqarishga tayyorlash</h2>
      <p className="field__error">
        Panel yuklanmadi — hujjat modullarini olish imkoni bo‘lmadi.
      </p>
      <button type="button" className="visual-reset" onClick={onRetry}>
        Qayta urinish
      </button>
    </section>
  );
}

interface BoundaryState {
  failed: boolean;
}

class ManufacturingBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  private readonly retry = () => {
    this.setState({ failed: false });
  };

  render() {
    if (this.state.failed) {
      return <ManufacturingPanelFailure onRetry={this.retry} />;
    }
    return this.props.children;
  }
}

export function LazyManufacturingPanel(props: LazyManufacturingPanelProps) {
  return (
    <ManufacturingBoundary>
      <Suspense fallback={<ManufacturingPanelLoading />}>
        <ManufacturingPanel {...props} />
      </Suspense>
    </ManufacturingBoundary>
  );
}
