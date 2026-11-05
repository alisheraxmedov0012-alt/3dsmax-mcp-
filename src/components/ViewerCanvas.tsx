import { useEffect, useRef, useState } from 'react';
import type { SceneData } from '../scene/types';
import type { CameraPreset } from '../scene/sceneSettings';
import { SceneViewer } from '../viewer/SceneViewer';

interface ViewerCanvasProps {
  scene: SceneData;
  selectedId: string | null;
  resetToken: number;
  cameraPreset: CameraPreset;
  cameraPresetToken: number;
  onSelect: (id: string | null) => void;
  onReady: (viewer: SceneViewer | null) => void;
}

export function ViewerCanvas({
  scene,
  selectedId,
  resetToken,
  cameraPreset,
  cameraPresetToken,
  onSelect,
  onReady,
}: ViewerCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<SceneViewer | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const onSelectRef = useRef(onSelect);
  const onReadyRef = useRef(onReady);
  onSelectRef.current = onSelect;
  onReadyRef.current = onReady;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const viewer = new SceneViewer(container, {
      onSelect: (id) => onSelectRef.current(id),
      onContextLost: () => setContextLost(true),
      onContextRestored: () => setContextLost(false),
    });
    viewerRef.current = viewer;
    onReadyRef.current(viewer);

    return () => {
      viewer.dispose();
      viewerRef.current = null;
      onReadyRef.current(null);
    };
  }, []);

  useEffect(() => {
    viewerRef.current?.setScene(scene, selectedId);
  }, [scene, selectedId]);

  useEffect(() => {
    if (resetToken > 0) {
      viewerRef.current?.resetView();
    }
  }, [resetToken]);

  useEffect(() => {
    if (cameraPresetToken > 0) {
      viewerRef.current?.applyCameraPreset(cameraPreset);
    }
    // Only react to explicit preset changes, not to every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraPresetToken]);

  return (
    <div className="viewer" ref={containerRef}>
      {contextLost && (
        <div className="viewer__status viewer__status--overlay" role="alert">
          <p className="viewer__status-text">
            WebGL konteksti yo’qoldi. Brauzer uni tiklamoqda; eksport vaqtincha
            ishlamaydi.
          </p>
          <button
            type="button"
            className="viewer__status-button"
            onClick={() => window.location.reload()}
          >
            Sahifani yangilash
          </button>
        </div>
      )}
    </div>
  );
}
