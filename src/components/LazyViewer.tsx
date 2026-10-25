/**
 * C8.2 — lazy boundary for the 3D stage.
 *
 * The viewer pulls in three.js, which is the single heaviest dependency in the
 * app and by far the largest part of the main chunk. Loading it behind a lazy
 * boundary lets the shell (panels, toolbar, readout) paint and become
 * interactive without waiting for the renderer to be parsed, and moves ~1 MB of
 * JavaScript off the critical path.
 *
 * Two failure modes are handled explicitly, because a blank canvas is the worst
 * possible outcome for a 3D editor:
 *
 * - the chunk is still downloading → a labelled loading state that occupies the
 *   same box, so the layout does not jump when the canvas arrives;
 * - the chunk fails to load (offline, stale deployment, blocked request) → an
 *   error state with a retry, instead of React's default blank screen.
 *
 * `SceneViewer` is imported as a *type* only, so it is erased at build time and
 * does not pull three.js back into the eager graph.
 */
import { Component, Suspense, lazy, type ReactNode } from 'react';
import type { SceneData } from '../scene/types';
import type { CameraPreset } from '../scene/sceneSettings';
import type { SceneViewer } from '../viewer/SceneViewer';

const ViewerCanvas = lazy(() =>
  import('./ViewerCanvas').then((module) => ({ default: module.ViewerCanvas })),
);

interface LazyViewerProps {
  scene: SceneData;
  selectedId: string | null;
  resetToken: number;
  cameraPreset: CameraPreset;
  cameraPresetToken: number;
  onSelect: (id: string | null) => void;
  onReady: (viewer: SceneViewer | null) => void;
}

/**
 * Shown while the viewer chunk downloads. Uses the same `.viewer` class as the
 * real canvas, which is `position: absolute; inset: 0`, so the placeholder and
 * the canvas occupy identical space.
 */
export function ViewerLoading() {
  return (
    <div className="viewer viewer--status" role="status" aria-live="polite">
      <p className="viewer__status">3D ko‘rinish yuklanmoqda…</p>
    </div>
  );
}

interface ViewerFailureProps {
  onRetry: () => void;
}

export function ViewerFailure({ onRetry }: ViewerFailureProps) {
  return (
    <div className="viewer viewer--status" role="alert">
      <p className="viewer__status">3D ko‘rinish yuklanmadi.</p>
      <p className="viewer__hint">
        Renderer faylini olish imkoni bo‘lmadi. Qayta urinib ko‘ring; sahifani yangilash ham
        yordam beradi.
      </p>
      <button type="button" className="visual-reset" onClick={onRetry}>
        Qayta urinish
      </button>
    </div>
  );
}

interface ViewerBoundaryState {
  failed: boolean;
}

/**
 * Catches a rejected dynamic import. React.lazy re-throws the import error during
 * render, so without a boundary the whole app would unmount.
 */
class ViewerBoundary extends Component<{ children: ReactNode }, ViewerBoundaryState> {
  state: ViewerBoundaryState = { failed: false };

  static getDerivedStateFromError(): ViewerBoundaryState {
    return { failed: true };
  }

  private readonly retry = () => {
    this.setState({ failed: false });
  };

  render() {
    if (this.state.failed) {
      return <ViewerFailure onRetry={this.retry} />;
    }
    return this.props.children;
  }
}

export function LazyViewer(props: LazyViewerProps) {
  return (
    <ViewerBoundary>
      <Suspense fallback={<ViewerLoading />}>
        <ViewerCanvas {...props} />
      </Suspense>
    </ViewerBoundary>
  );
}
