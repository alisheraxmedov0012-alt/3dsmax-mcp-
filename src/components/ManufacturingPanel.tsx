import { useMemo, useRef, useState } from 'react';
import { downloadBlob } from '../export/downloadFile';
import { FURNITURE_TYPE_LABELS } from '../geometry/furniture/types';
import type { SceneData, SceneObject } from '../scene/types';
import { buildBom } from '../manufacturing/bom';
import { buildCutList } from '../manufacturing/cutList';
import {
  buildManufacturingArtifact,
  type ManufacturingArtifactKind,
} from '../manufacturing/manufacturingExport';
import { buildManufacturingPackage } from '../manufacturing/manufacturingPackage';
import { createTechnicalDrawingSvg } from '../manufacturing/technicalDrawing';
import { validateManufacturing, type ValidationLevel } from '../manufacturing/validation';
import { groupByMaterial } from '../manufacturing/sheetMaterial';

interface ManufacturingPanelProps {
  object: SceneObject | null;
  projectName: string;
  /** The full scene; needed for the 3D export inside the document package. */
  scene: SceneData;
}

type Status = 'idle' | 'ok' | 'error';

const VALIDATION_LEVEL_LABELS: Record<ValidationLevel, string> = {
  error: 'Xatolik',
  warning: 'Ogohlantirish',
  info: "Ma'lumot",
};

const EXPORT_BUTTONS: Array<{ kind: ManufacturingArtifactKind; label: string }> = [
  { kind: 'bom-csv', label: 'BOM (CSV)' },
  { kind: 'bom-json', label: 'BOM (JSON)' },
  { kind: 'cutlist-csv', label: 'Kesish ro‘yxati (CSV)' },
  { kind: 'cutlist-json', label: 'Kesish ro‘yxati (JSON)' },
];

/**
 * W9 manufacturing panel: preliminary technical drawing, BOM and cut list for the
 * selected piece. Everything is read-only over the scene — a failure here can
 * never modify or lose the project.
 */
export function ManufacturingPanel({ object, projectName, scene }: ManufacturingPanelProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [packaging, setPackaging] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  // Refs, not state: two clicks in the same tick would both see the state value.
  const packageLock = useRef(false);
  const pdfLock = useRef(false);

  const computed = useMemo(() => {
    if (!object) {
      return null;
    }
    try {
      const bomOutcome = buildBom(object.type, object.params, object.sheetMaterials);
      if (!bomOutcome.ok) {
        return { error: bomOutcome.reason };
      }
      return {
        bom: bomOutcome.bom,
        cutList: buildCutList(bomOutcome.bom),
        validation: validateManufacturing(object.type, object.params, object.sheetMaterials),
      };
    } catch (error) {
      console.error('Ishlab chiqarish hisob-kitobi xatosi:', error);
      return { error: "Hisob-kitobda kutilmagan xatolik yuz berdi." };
    }
  }, [object]);

  if (!object) {
    return (
      <section className="manufacturing">
        <h2 className="manufacturing__title">Ishlab chiqarishga tayyorlash</h2>
        <p className="visual__hint">
          Texnik chizma, detallar ro‘yxati va kesish ro‘yxati uchun mebelni tanlang.
        </p>
      </section>
    );
  }

  const handleDrawing = () => {
    try {
      const result = createTechnicalDrawingSvg(object.type, object.params, {
        title: projectName.trim() !== '' ? projectName : FURNITURE_TYPE_LABELS[object.type],
        date: new Date().toISOString().slice(0, 10),
      });
      if (!result.ok) {
        setStatus('error');
        setMessage(result.reason);
        return;
      }
      downloadBlob(new Blob([result.svg], { type: 'image/svg+xml' }), 'texnik-chizma.svg');
      setStatus('ok');
      setMessage(
        `Texnik chizma yuklab olindi (W ${result.overall.widthMm} x H ${result.overall.heightMm} x D ${result.overall.depthMm} mm).`,
      );
    } catch (error) {
      console.error('Chizma xatosi:', error);
      setStatus('error');
      setMessage('Chizma yaratilmadi. Loyiha o‘zgarmadi.');
    }
  };

  /**
   * Build the PDF from the very data already shown in this panel.
   *
   * Nothing is recomputed from the scene: the BOM, cut list, materials,
   * validation report and drawing come from `computed`, so the PDF cannot drift
   * from what the user is looking at.
   */
  const handlePdf = async () => {
    if (pdfLock.current || !computed || 'error' in computed) {
      return;
    }
    pdfLock.current = true;
    setPdfBusy(true);
    setStatus('idle');
    setMessage('PDF hujjati tayyorlanmoqda…');

    try {
      // Same generator and options as the "Chizma (SVG)" action, so the PDF
      // embeds the drawing the user can also download on its own.
      const drawing = createTechnicalDrawingSvg(object.type, object.params, {
        title: projectName.trim() !== '' ? projectName : FURNITURE_TYPE_LABELS[object.type],
        date: new Date().toISOString().slice(0, 10),
      });
      if (!drawing.ok) {
        setStatus('error');
        setMessage(`PDF yaratilmadi: ${drawing.reason}`);
        return;
      }

      // Loaded on demand: pdf-lib and the embedded fonts are only worth their
      // weight when someone actually exports a PDF, so they stay out of the
      // initial bundle.
      const { buildManufacturingPdf } = await import('../manufacturing/pdfDocument');
      const outcome = await buildManufacturingPdf({
        type: object.type,
        params: object.params,
        projectName,
        bom: computed.bom,
        cutList: computed.cutList,
        materials: groupByMaterial(computed.bom.rows),
        validation: computed.validation,
        drawing: { svg: drawing.svg, scale: drawing.scale },
        overall: drawing.overall,
        generatedAt: new Date(),
      });

      if (!outcome.ok) {
        // No bytes were produced, so there is nothing that could be corrupt.
        setStatus('error');
        setMessage(`PDF yaratilmadi: ${outcome.reason}`);
        return;
      }

      downloadBlob(new Blob([outcome.bytes], { type: 'application/pdf' }), outcome.filename);
      setStatus('ok');
      setMessage(
        `${outcome.filename} yuklab olindi (${outcome.pageCount} sahifa, ${computed.validation.counts.error} xatolik).`,
      );
    } catch (error) {
      console.error('PDF xatosi:', error);
      setStatus('error');
      setMessage('PDF yaratilmadi. Loyiha o‘zgarmadi.');
    } finally {
      pdfLock.current = false;
      setPdfBusy(false);
    }
  };

  const handleExport = (kind: ManufacturingArtifactKind) => {
    if (!computed || 'error' in computed) {
      setStatus('error');
      setMessage('Detallar ro‘yxati mavjud emas.');
      return;
    }
    try {
      const artifact = buildManufacturingArtifact({
        kind,
        name: projectName.trim() !== '' ? projectName : 'loyiha',
        furnitureType: object.type,
        bom: computed.bom,
        cutList: computed.cutList,
      });
      downloadBlob(new Blob([artifact.content], { type: artifact.mimeType }), artifact.filename);
      setStatus('ok');
      setMessage(`${artifact.filename} yuklab olindi.`);
    } catch (error) {
      console.error('Eksport xatosi:', error);
      setStatus('error');
      setMessage('Eksport amalga oshmadi. Loyiha o‘zgarmadi.');
    }
  };

  const handlePackage = async () => {
    if (packageLock.current) {
      return;
    }
    packageLock.current = true;
    setPackaging(true);
    setStatus('idle');
    setMessage('Hujjatlar to‘plami tayyorlanmoqda…');

    try {
      const outcome = await buildManufacturingPackage({ scene, object, projectName });

      if (!outcome.ok) {
        // A failed build produced no bytes, so nothing can be downloaded.
        setStatus('error');
        setMessage(`To‘plamni tayyorlab bo‘lmadi: ${outcome.reason}`);
        return;
      }

      downloadBlob(new Blob([outcome.package.bytes], { type: outcome.package.mimeType }), outcome.package.filename);
      setStatus('ok');
      setMessage(
        `${outcome.package.filename} yuklab olindi (${outcome.package.entries.length} fayl, ` +
          `${outcome.package.totalParts} detal, ${outcome.package.cutPieces} panel).`,
      );
    } catch (error) {
      console.error('To‘plam xatosi:', error);
      setStatus('error');
      setMessage('To‘plamni tayyorlab bo‘lmadi. Loyiha o‘zgarmadi.');
    } finally {
      packageLock.current = false;
      setPackaging(false);
    }
  };

  return (
    <section className="manufacturing">
      <h2 className="manufacturing__title">Ishlab chiqarishga tayyorlash</h2>
      <p className="visual__hint">
        {FURNITURE_TYPE_LABELS[object.type]} · dastlabki hisob-kitob (geometriyadan o‘lchandi).
      </p>

      {computed && 'error' in computed && (
        <p className="render__message render__message--error" role="alert">
          {computed.error}
        </p>
      )}

      {computed && !('error' in computed) && (
        <>
          <div className="field">
            <span className="field__label">Ishlab chiqarish hujjatlari</span>
            <button
              type="button"
              className="visual-reset manufacturing__package-button"
              onClick={handlePackage}
              disabled={packaging}
              data-testid="manufacturing-package"
            >
              {packaging ? 'To‘plam tayyorlanmoqda…' : 'Loyiha hujjatlarini ZIP formatida yuklab olish'}
            </button>
            <p className="visual__hint">
              Bitta arxivda: model.glb, BOM.csv, cutlist.csv, drawing.svg, meta.json, README.txt.
            </p>
          </div>

          <div className="field" data-testid="manufacturing-validation">
            <span className="field__label">
              Tekshiruv: {computed.validation.counts.error} xatolik ·{' '}
              {computed.validation.counts.warning} ogohlantirish
            </span>
            {computed.validation.issues.filter((entry) => entry.level !== 'info').length === 0 ? (
              <p className="visual__hint">
                Aniqlangan muammo yo‘q. Bu ishlab chiqarishga yaroqlilikni tasdiqlamaydi — quyidagi
                cheklovlar hali tekshirilmagan.
              </p>
            ) : (
              <ul className="manufacturing__validation-list">
                {computed.validation.issues
                  .filter((entry) => entry.level !== 'info')
                  .map((entry) => (
                    <li
                      key={`${entry.level}-${entry.code}-${entry.partId ?? 'all'}`}
                      className={`manufacturing__validation-item manufacturing__validation-item--${entry.level}`}
                    >
                      <strong>{VALIDATION_LEVEL_LABELS[entry.level]}</strong>
                      {entry.partId ? ` · ${entry.partId}` : ''}: {entry.message}
                    </li>
                  ))}
              </ul>
            )}
            <ul className="image-ref__warnings">
              {computed.validation.limitations.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          <div className="field">
            <span className="field__label">PDF hujjat</span>
            <button
              type="button"
              className="visual-reset manufacturing__package-button"
              onClick={handlePdf}
              disabled={pdfBusy}
              data-testid="manufacturing-pdf"
            >
              {pdfBusy
                ? 'PDF tayyorlanmoqda…'
                : 'Ishlab chiqarish hujjatlarini PDF formatida yuklab olish'}
            </button>
            <p className="visual__hint">
              Bitta hujjatda: texnik chizma, BOM, kesish ro‘yxati, materiallar va tekshiruv
              natijasi.
            </p>
          </div>

          <div className="field">
            <span className="field__label">Texnik chizma</span>
            <button type="button" className="visual-reset" onClick={handleDrawing}>
              Chizma (SVG) yuklab olish
            </button>
            <p className="visual__hint">Old, yon va yuqoridan ko‘rinishlar; o‘lchamlar mm.</p>
          </div>

          <div className="field">
            <span className="field__label">
              Detallar: {computed.bom.rows.length} tur · {computed.bom.totalParts} dona
            </span>
            <ul className="manufacturing__list">
              {computed.bom.rows.map((entry) => (
                <li key={entry.partId + entry.sizeMm.x}>
                  {entry.name} × {entry.quantity} — {entry.sizeMm.x}×{entry.sizeMm.y}×{entry.sizeMm.z} mm
                  {entry.thicknessMm !== null ? ` (qalinlik ${entry.thicknessMm} mm)` : ''}
                  {/* Material is shown next to the measured geometry, never instead of it. */}
                  {entry.material
                    ? ` · ${entry.material.name}, nominal ${entry.material.thicknessMm} mm`
                    : ''}
                </li>
              ))}
            </ul>
          </div>

          <div className="field">
            <span className="field__label">
              Kesish ro‘yxati: {computed.cutList.totalPieces} panel · {computed.cutList.panelAreaM2} m²
            </span>
            <div className="preset-grid">
              {EXPORT_BUTTONS.map((entry) => (
                <button
                  key={entry.kind}
                  type="button"
                  className="visual-reset"
                  onClick={() => handleExport(entry.kind)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field__label">Cheklovlar</span>
            <ul className="image-ref__warnings">
              {computed.bom.limitations.map((line) => (
                <li key={line}>{line}</li>
              ))}
              {computed.cutList.limitations.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </>
      )}

      {message &&
        (status === 'error' ? (
          <p className="render__message render__message--error" role="alert">
            {message}
          </p>
        ) : (
          <p className="render__message" role="status" aria-live="polite">
            {message}
          </p>
        ))}
    </section>
  );
}
