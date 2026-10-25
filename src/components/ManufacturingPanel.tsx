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
import { groupByMaterial, type SheetMaterialId } from '../manufacturing/sheetMaterial';
import {
  buildFurnitureAssemblyPlan,
  isAssemblyPlanStale,
  type AssemblyPlan,
} from '../manufacturing/assemblyInstructions';
import type { CuttingPlan } from '../manufacturing/cuttingPlan';
import type { PngPreset } from '../export/sceneImage';
import { AssemblyInstructionsPanel } from './AssemblyInstructionsPanel';
import { CuttingPlanPanel } from './CuttingPlanPanel';
import { ProductPackagePanel } from './ProductPackagePanel';
import { SheetMaterialPanel } from './SheetMaterialPanel';

interface ManufacturingPanelProps {
  object: SceneObject | null;
  projectName: string;
  /** The full scene; needed for the 3D export inside the document package. */
  scene: SceneData;
  /** C3.1: save one part's manufacturing material. */
  onAssignSheetMaterial?: (
    partId: string,
    materialId: SheetMaterialId,
    thicknessMm: number,
  ) => void;
  /** C3.1: remove one part's manufacturing material. */
  onRemoveSheetMaterial?: (partId: string) => void;
  /** C8: capture the live 3D view for the product panel (owned by the app). */
  onCapturePreview?: (preset: PngPreset) => Promise<Blob | null>;
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
export function ManufacturingPanel({
  object,
  projectName,
  scene,
  onAssignSheetMaterial,
  onRemoveSheetMaterial,
  onCapturePreview,
}: ManufacturingPanelProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [packaging, setPackaging] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  // Refs, not state: two clicks in the same tick would both see the state value.
  const packageLock = useRef(false);
  const pdfLock = useRef(false);
  /**
   * The plan the reader asked for, tagged with the object it was built from.
   * Staleness is derived from that tag plus the fingerprint, so no effect has to
   * chase the model — a changed model simply makes the shown plan stale.
   */
  const [generated, setGenerated] = useState<{ plan: AssemblyPlan; objectId: string } | null>(null);
  /**
   * The C7 layout the panel last calculated, tagged with the object it belongs to.
   * The tag is what keeps a layout for a previously selected piece out of the PDF;
   * the panel already withholds a plan whose settings changed.
   */
  const [cuttingState, setCuttingState] = useState<{ objectId: string; plan: CuttingPlan } | null>(
    null,
  );

  const computed = useMemo(() => {
    if (!object) {
      return null;
    }
    try {
      const bomOutcome = buildBom(object.type, object.params, object.sheetMaterials);
      if (!bomOutcome.ok) {
        return { error: bomOutcome.reason };
      }
      const validation = validateManufacturing(
        object.type,
        object.params,
        object.sheetMaterials,
      );
      return {
        bom: bomOutcome.bom,
        cutList: buildCutList(bomOutcome.bom),
        validation,
        // Built from the same BOM and report the panel displays, so the steps
        // cannot disagree with the parts list next to them.
        assembly: buildFurnitureAssemblyPlan({ bom: bomOutcome.bom, validation }),
      };
    } catch (error) {
      console.error('Ishlab chiqarish hisob-kitobi xatosi:', error);
      return { error: "Hisob-kitobda kutilmagan xatolik yuz berdi." };
    }
  }, [object]);

  // A plan for a previously selected object is never shown against this one.
  const shownPlan = generated && generated.objectId === object?.id ? generated.plan : null;
  const currentPlan = computed && !('error' in computed) ? computed.assembly : null;
  const planStale = Boolean(
    shownPlan && currentPlan && isAssemblyPlanStale(shownPlan, currentPlan.fingerprint),
  );
  const cuttingPlan =
    cuttingState && cuttingState.objectId === object?.id ? cuttingState.plan : null;

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
        // A fresh plan, never the one on screen: a PDF must describe the model as
        // it is now, even when the reader left a stale plan open.
        assembly: computed.assembly,
        // C7 is different: its sheet settings live in the panel, so the parent
        // only ever holds the plan the reader last calculated.
        cuttingPlan,
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

  const handleGenerateAssembly = () => {
    if (!computed || 'error' in computed) {
      setStatus('error');
      setMessage('Montaj yo‘riqnomasi uchun hisob-kitob mavjud emas.');
      return;
    }
    setGenerated({ plan: computed.assembly, objectId: object.id });
    setStatus('ok');
    setMessage(
      computed.assembly.steps.length === 0
        ? 'Montaj yo‘riqnomasi tuzilmadi — sabab bo‘limda ko‘rsatilgan.'
        : `Montaj yo‘riqnomasi tayyor: ${computed.assembly.steps.length} qadam.`,
    );
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

          {/* C6: ordered assembly steps derived from the model's part roles.
              Steps are only shown after an explicit generate, so what the reader
              sees is always a plan they asked for — and one they can see go stale. */}
          <AssemblyInstructionsPanel
            plan={shownPlan}
            stale={planStale}
            onGenerate={handleGenerateAssembly}
          />

          {/* C7: material usage and cutting layout. The panel owns its own sheet
              settings, because a board size is a shop decision that has no place
              in the scene model. */}
          <CuttingPlanPanel
            cutList={computed.cutList}
            bom={computed.bom}
            onPlanChange={(plan) =>
              setCuttingState(plan ? { objectId: object.id, plan } : null)
            }
          />

          {/* C8: readiness + one bundle. The cutting layout is the one C7 holds,
              so the package and the section above cannot disagree. */}
          <ProductPackagePanel
            object={object}
            scene={scene}
            projectName={projectName}
            cuttingPlan={cuttingPlan}
            onCapturePreview={onCapturePreview}
          />

          {/* C3.1: assign manufacturing material per generated part. Parts come
              from the BOM, so an assignment can only target a real part. */}
          {onAssignSheetMaterial && onRemoveSheetMaterial && (
            <SheetMaterialPanel
              object={object}
              parts={computed.bom.rows.map((row) => ({ partId: row.partId, name: row.name }))}
              onAssign={onAssignSheetMaterial}
              onRemove={onRemoveSheetMaterial}
            />
          )}

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
