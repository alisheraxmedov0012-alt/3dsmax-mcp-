import { useMemo } from 'react';
import { buildFurniture } from '../geometry/furniture/buildFurniture';
import type { SceneObject } from '../scene/types';
import { analyzePrintGeometry } from '../print/meshValidation';

/**
 * B1/B3 — a print-geometry report, not a slicer.
 *
 * Every value shown comes from the mesh that is currently selected. Checks that
 * need printer, material, orientation or self-intersection data are listed as
 * "not verified" instead of being guessed.
 */
export function PrintReadinessPanel({ object }: { object: SceneObject | null }) {
  const report = useMemo(() => {
    if (!object) return null;
    const built = buildFurniture(object.type, object.params);
    try {
      return analyzePrintGeometry(built.group);
    } finally {
      built.dispose();
    }
  }, [object]);

  return (
    <section className="export" data-testid="print-readiness">
      <h2 className="export__title">3D print tayyorligi</h2>

      {!object || !report ? (
        <p className="visual__hint">
          Print geometriyasini tekshirish uchun mebelni tanlang.
        </p>
      ) : (
        <>
          <p
            className={
              report.watertight
                ? 'render__message'
                : 'render__message render__message--error'
            }
            role="status"
            data-testid="print-watertight"
          >
            {report.watertight
              ? "Har bir mesh yopiq va manifold: asosiy geometriya tekshiruvidan o'tdi."
              : "Ochiq chegara, manifold yoki degenerativ uchburchak topildi — printga tayyor emas."}
          </p>

          <ul className="image-ref__notes" data-testid="print-metrics">
            <li>Mesh: {report.meshes} · uchburchak: {report.triangles}</li>
            <li>
              Yopiq mesh: {report.closedMeshes} · ochiq: {report.openMeshes}
            </li>
            <li>
              Ochiq chegara: {report.boundaryEdges} · non-manifold: {report.nonManifoldEdges} ·
              degenerativ: {report.degenerateTriangles}
            </li>
            {report.sizeMm && (
              <li>
                O‘lcham: {report.sizeMm.x} × {report.sizeMm.y} × {report.sizeMm.z} mm
              </li>
            )}
          </ul>

          <ul className="image-ref__warnings" data-testid="print-limitations">
            {report.limitations.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
