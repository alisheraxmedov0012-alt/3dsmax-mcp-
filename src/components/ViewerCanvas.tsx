import { useEffect, useRef } from 'react';
import type { TableParams } from '../geometry/tableParams';
import { TableViewer } from '../viewer/TableViewer';

interface ViewerCanvasProps {
  params: TableParams | null;
}

export function ViewerCanvas({ params }: ViewerCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<TableViewer | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const viewer = new TableViewer(container);
    viewerRef.current = viewer;

    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (params && viewerRef.current) {
      viewerRef.current.setParams(params);
    }
  }, [params]);

  return <div className="viewer" ref={containerRef} />;
}
