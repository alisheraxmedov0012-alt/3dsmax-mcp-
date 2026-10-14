import { useEffect, useRef } from 'react';
import type { SceneData } from '../scene/types';
import { SceneViewer } from '../viewer/SceneViewer';

interface ViewerCanvasProps {
  scene: SceneData;
  selectedId: string | null;
  resetToken: number;
  onSelect: (id: string | null) => void;
}

export function ViewerCanvas({ scene, selectedId, resetToken, onSelect }: ViewerCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<SceneViewer | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const viewer = new SceneViewer(container, {
      onSelect: (id) => onSelectRef.current(id),
    });
    viewerRef.current = viewer;

    return () => {
      viewer.dispose();
      viewerRef.current = null;
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

  return <div className="viewer" ref={containerRef} />;
}
