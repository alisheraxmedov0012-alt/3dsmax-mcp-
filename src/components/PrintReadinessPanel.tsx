/**
 * B3 — print readiness for the selected object.
 *
 * Every number comes from the geometry the STL/3MF exporters would write
 * (`analyzeObjectPrintReadiness`). Checks this build cannot perform are shown as
 * "Tekshirilmadi", never as a pass, and the panel never claims a print guarantee.
 *
 * The printer profile is deliberately empty by default: build volume and minimum
 * wall are properties of a specific machine and material, so the user supplies
 * them. Until they do, the dependent checks stay NOT_CHECKED.
 */
import { useMemo, useState } from 'react';
import type { SceneObject } from '../scene/types';
import { analyzeObjectPrintReadiness } from '../print/printReadiness';
import { resolvePrinterProfile } from '../print/printerProfile';
import { PRINT_STATUS_LABELS, type PrintCheckStatus } from '../print/printTypes';

const STATUS_MODIFIER: Record<PrintCheckStatus, string> = {
  PASS: 'pass',
  WARNING: 'warning',
  ERROR: 'fail',
  NOT_CHECKED: 'na',
};

function numberOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : Number(trimmed);
}

function overallMessage(status: PrintCheckStatus, firstProblem: string | null): string {
  switch (status) {
    case 'ERROR':
      return `Print uchun xato: ${firstProblem ?? "tekshiruv natijasini ko'ring"}.`;
    case 'WARNING':
      return `Print uchun ogohlantirish: ${firstProblem ?? "tekshiruv natijasini ko'ring"}.`;
    case 'PASS':
      return "Har bir tekshirilgan mesh yopiq va manifold: asosiy geometriya tekshiruvidan o'tdi.";
    default:
      return "Tekshiruvlar bajarilmadi — geometriya yo'q yoki sozlama yetishmayapti.";
  }
}

export function PrintReadinessPanel({ object }: { object: SceneObject | null }) {
  const [volumeX, setVolumeX] = useState('');
  const [volumeY, setVolumeY] = useState('');
  const [volumeZ, setVolumeZ] = useState('');
  const [minWall, setMinWall] = useState('');
  const [minFeature, setMinFeature] = useState('');

  const profileResult = useMemo(
    () =>
      resolvePrinterProfile({
        buildVolumeXmm: numberOrNull(volumeX),
        buildVolumeYmm: numberOrNull(volumeY),
        buildVolumeZmm: numberOrNull(volumeZ),
        minWallThicknessMm: numberOrNull(minWall),
        minFeatureSizeMm: numberOrNull(minFeature),
      }),
    [volumeX, volumeY, volumeZ, minWall, minFeature],
  );

  const report = useMemo(
    () => (object ? analyzeObjectPrintReadiness(object, profileResult.profile) : null),
    [object, profileResult],
  );

  return (
    <section className="export" data-testid="print-readiness">
      <h2 className="export__title">3D print tayyorligi</h2>

      <div className="field">
        <span className="field__label">Printer profili (mm)</span>
        <p className="visual__hint">
          Build volume va minimal devor — aniq printer/material xususiyati. Bo‘sh maydon
          “tekshirilmagan” degani; hech qanday chegara taxmin qilinmaydi.
        </p>
        <div className="product__actions">
          <label className="field">
            Build X
            <input
              className="field__input"
              type="number"
              min="0"
              step="0.1"
              inputMode="decimal"
              aria-label="Build volume X (mm)"
              value={volumeX}
              onChange={(event) => setVolumeX(event.target.value)}
            />
          </label>
          <label className="field">
            Build Y
            <input
              className="field__input"
              type="number"
              min="0"
              step="0.1"
              inputMode="decimal"
              aria-label="Build volume Y (mm)"
              value={volumeY}
              onChange={(event) => setVolumeY(event.target.value)}
            />
          </label>
          <label className="field">
            Build Z
            <input
              className="field__input"
              type="number"
              min="0"
              step="0.1"
              inputMode="decimal"
              aria-label="Build volume Z (mm)"
              value={volumeZ}
              onChange={(event) => setVolumeZ(event.target.value)}
            />
          </label>
          <label className="field">
            Min devor
            <input
              className="field__input"
              type="number"
              min="0"
              step="0.05"
              inputMode="decimal"
              aria-label="Minimal devor (mm)"
              value={minWall}
              onChange={(event) => setMinWall(event.target.value)}
            />
          </label>
          <label className="field">
            Min feature
            <input
              className="field__input"
              type="number"
              min="0"
              step="0.05"
              inputMode="decimal"
              aria-label="Minimal feature size (mm)"
              value={minFeature}
              onChange={(event) => setMinFeature(event.target.value)}
            />
          </label>
        </div>
        {profileResult.errors.length > 0 && (
          <ul className="image-ref__warnings" data-testid="print-profile-error">
            {profileResult.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
      </div>

      {!object || !report ? (
        <p className="visual__hint">
          Print geometriyasini tekshirish uchun mebelni tanlang.
        </p>
      ) : (
        <>
          <p
            className={`product__verdict product__verdict--${STATUS_MODIFIER[report.status]}`}
            role="status"
            data-testid="print-watertight"
          >
            {overallMessage(
              report.status,
              report.checks.find(
                (check) =>
                  (check.status === 'ERROR' || check.status === 'WARNING') && check.id !== 'slicer',
              )?.label ?? null,
            )}
          </p>

          <p className="visual__hint" data-testid="print-status">
            Umumiy holat: {PRINT_STATUS_LABELS[report.status]} ·{' '}
            {report.counts.PASS} o‘tdi · {report.counts.WARNING} ogohlantirish ·{' '}
            {report.counts.ERROR} xato · {report.counts.NOT_CHECKED} tekshirilmadi
          </p>

          <ul className="image-ref__notes" data-testid="print-metrics">
            <li>
              Mesh: {report.totals.meshes} · uchburchak: {report.totals.triangles} ·
              komponent: {report.totals.components}
            </li>
            <li>
              Yopiq chegara: {report.totals.boundaryEdges} · non-manifold:{' '}
              {report.totals.nonManifoldEdges} · degenerativ:{' '}
              {report.totals.degenerateTriangles}
            </li>
            {report.sizeMm && (
              <li>
                O‘lcham: {report.sizeMm.x} × {report.sizeMm.y} × {report.sizeMm.z} mm
              </li>
            )}
            {report.volumeMm3 !== null && (
              <li>Hajm: {Math.round(report.volumeMm3)} mm³</li>
            )}
            <li>
              Minimal devor:{' '}
              {report.minWallThicknessMm === null
                ? "o‘lchanmagan (normal bo‘ylab nur topmadi)"
                : `${report.minWallThicknessMm} mm (taxminiy)`}
            </li>
            <li>
              Eksport:{' '}
              {report.exportable
                ? 'strukturaviy jihatdan mumkin'
                : "strukturaviy xato — fayl yozilmasligi kerak"}
            </li>
          </ul>

          <ul className="image-ref__notes" data-testid="print-checks">
            {report.checks.map((check) => (
              <li
                key={check.id}
                className={`product__check product__check--${STATUS_MODIFIER[check.status]}`}
                data-testid={`print-check-${check.id}`}
              >
                <span className="product__check-label">{check.label}</span>{' '}
                <span className="product__check-status">
                  {PRINT_STATUS_LABELS[check.status]}
                </span>{' '}
                <span className="product__check-detail">{check.message}</span>
                {check.remediation && (
                  <span className="product__check-reason"> Tavsiya: {check.remediation}</span>
                )}
              </li>
            ))}
          </ul>

          <details data-testid="print-meshes">
            <summary>Mesh tafsilotlari ({report.meshes.length})</summary>
            <ul className="image-ref__notes">
              {report.meshes.map((mesh) => (
                <li key={`${mesh.name}-${mesh.index}`}>
                  {mesh.name}: {mesh.triangles} uchburchak ·{' '}
                  {mesh.closed ? 'yopiq' : 'ochiq'} ·{' '}
                  {mesh.manifold ? 'manifold' : 'non-manifold'} ·{' '}
                  {mesh.minWallThicknessMm === null
                    ? 'devor o‘lchanmagan'
                    : `devor ${mesh.minWallThicknessMm} mm`}
                  {mesh.negativeScale ? ' · manfiy masshtab' : ''}
                </li>
              ))}
            </ul>
          </details>

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
