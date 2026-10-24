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

interface ManufacturingPanelProps {
  object: SceneObject | null;
  projectName: string;
  /** The full scene; needed for the 3D export inside the document package. */
  scene: SceneData;
}

type Status = 'idle' | 'ok' | 'error';

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
  // A ref, not state: two clicks in the same tick would both see `packaging`.
  const packageLock = useRef(false);

  const computed = useMemo(() => {
    if (!object) {
      return null;
    }
    try {
      const bomOutcome = buildBom(object.type, object.params);
      if (!bomOutcome.ok) {
        return { error: bomOutcome.reason };
      }
      return { bom: bomOutcome.bom, cutList: buildCutList(bomOutcome.bom) };
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
