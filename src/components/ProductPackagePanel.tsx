/**
 * C8 — the product package section.
 *
 * This is the "first commercial product" flow: check readiness, look at the
 * result, read the English description, download the bundle. It reuses the
 * C1–C7 builders through `productReadiness` / `productPackage`; nothing about
 * BOMs, drawings, assembly or nesting is recomputed here.
 *
 * Three honesty rules shape the UI:
 *
 * 1. A readiness report is tagged with the model it described. Change the model
 *    and the panel says the report is stale instead of showing a verdict that no
 *    longer applies.
 * 2. Statuses are rendered with their own words and colours — a warning never
 *    looks like a pass.
 * 3. The 3D preview is labelled as a live view of the model being exported, not a
 *    photograph or a photorealistic render.
 */
import { useMemo, useState } from 'react';
import { downloadBlob } from '../export/downloadFile';
import type { SceneData, SceneObject } from '../scene/types';
import type { SheetMaterialEntry } from '../manufacturing/sheetMaterial';
import {
  READINESS_STATUS_LABELS,
  assessProductReadiness,
  combineReadiness,
  readinessFingerprint,
  type ProductReadiness,
  type ReadinessStatus,
} from '../manufacturing/productReadiness';
import { verifyProductExports } from '../manufacturing/productPackage';
import {
  buildProductDescription,
  productDescriptionMarkdown,
  type ProductDescription,
} from '../manufacturing/productDescription';
import { buildBom } from '../manufacturing/bom';
import { buildCutList } from '../manufacturing/cutList';
import type { CuttingPlan } from '../manufacturing/cuttingPlan';
import { buildFurnitureAssemblyPlan } from '../manufacturing/assemblyInstructions';
import { validateManufacturing } from '../manufacturing/validation';
import { createTechnicalDrawingSvg } from '../manufacturing/technicalDrawing';
import type { PngPreset } from '../export/sceneImage';

interface ProductPackagePanelProps {
  object: SceneObject | null;
  scene: SceneData;
  projectName: string;
  /**
   * The C7 layout currently shown in the cutting-plan section. C8 reuses it
   * instead of asking for board sizes a second time, so the bundle cannot contain
   * a different layout from the one the reader just looked at.
   */
  cuttingPlan: CuttingPlan | null;
  /**
   * Captures the live 3D view. Supplied by the app, which owns the renderer; the
   * panel never constructs a second WebGL context.
   */
  onCapturePreview?: (preset: PngPreset) => Promise<Blob | null>;
  /** Saves a material assignment; reused from C3.1. */
  onAssignSheetMaterial?: (
    partId: string,
    materialId: import('../manufacturing/sheetMaterial').SheetMaterialId,
    thicknessMm: number,
  ) => void;
}

const STATUS_MODIFIER: Record<ReadinessStatus, string> = {
  pass: 'pass',
  warning: 'warning',
  fail: 'fail',
  not_applicable: 'na',
};

interface Generated {
  readiness: ProductReadiness;
  description: ProductDescription;
  fingerprint: string;
  objectId: string;
  filename: string;
  bytes: Uint8Array<ArrayBuffer>;
}

const PREVIEW_PRESET: PngPreset = 'preview';

function statusLabel(status: ReadinessStatus): string {
  return READINESS_STATUS_LABELS[status];
}

export function ProductPackagePanel({
  object,
  scene,
  projectName,
  cuttingPlan,
  onCapturePreview,
}: ProductPackagePanelProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const fingerprint = useMemo(
    () =>
      object
        ? readinessFingerprint({
            type: object.type,
            params: object.params,
            sheetMaterials: object.sheetMaterials,
          })
        : '',
    [object],
  );

  if (!object) {
    return (
      <div className="field product" data-testid="product-package">
        <span className="field__label">Mahsulot paketi</span>
        <p className="visual__hint">Mahsulot paketini tayyorlash uchun mebelni tanlang.</p>
      </div>
    );
  }

  const current = generated && generated.objectId === object.id ? generated : null;
  const stale = Boolean(current && current.fingerprint !== fingerprint);

  const materials = (object.sheetMaterials ?? []) as readonly SheetMaterialEntry[];

  const handleCheck = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const structural = assessProductReadiness({
        type: object.type,
        params: object.params,
        sheetMaterials: materials,
        cuttingPlan,
      });
      const verification = await verifyProductExports({
        scene,
        object,
        projectName,
        cuttingPlan,
        verifyC1Package: true,
      });
      const readiness = combineReadiness(structural, verification.checks);

      // The description is built from the same artifacts the package uses, so
      // the panel and the downloaded Markdown cannot disagree.
      const bom = buildBom(object.type, object.params, materials);
      const description =
        verification.product && bom.ok
          ? (() => {
              const cutList = buildCutList(bom.bom);
              const validation = validateManufacturing(object.type, object.params, materials);
              const assembly = buildFurnitureAssemblyPlan({ bom: bom.bom, validation });
              const drawing = createTechnicalDrawingSvg(object.type, object.params, {
                title: projectName.trim() !== '' ? projectName : object.name,
                date: new Date().toISOString().slice(0, 10),
              });
              return buildProductDescription(
                {
                  type: object.type,
                  overallMm: drawing.ok
                    ? drawing.overall
                    : { widthMm: 0, heightMm: 0, depthMm: 0 },
                  bom: bom.bom,
                  cutList,
                  validation,
                  assembly,
                  cuttingPlan,
                },
                verification.product.expectedEntries.filter(
                  (name) => name !== 'meta.json' && name !== 'README.txt',
                ),
              );
            })()
          : null;

      setGenerated(
        verification.product && description
          ? {
              readiness,
              description,
              fingerprint,
              objectId: object.id,
              filename: verification.product.filename,
              bytes: verification.product.bytes,
            }
          : null,
      );
      if (!verification.product) {
        setError(
          readiness.blockers[0] ?? "Mahsulot paketi yaratilmadi — sabab tekshiruv natijasida.",
        );
      } else {
        setMessage(
          `Tekshiruv: ${statusLabel(readiness.status)} · ${readiness.counts.pass} tayyor, ${readiness.counts.warning} ogohlantirish, ${readiness.counts.fail} xato.`,
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Mahsulot paketi tayyorlanmadi: ${cause.message}`
          : 'Mahsulot paketi tayyorlanmadi.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = () => {
    if (!current) {
      return;
    }
    downloadBlob(
      new Blob([current.bytes], { type: 'application/zip' }),
      current.filename,
    );
  };

  const handleDownloadDescription = () => {
    if (!current) {
      return;
    }
    downloadBlob(
      new Blob([productDescriptionMarkdown(current.description)], { type: 'text/markdown' }),
      'product-description.md',
    );
  };

  const handlePreview = async () => {
    if (!onCapturePreview) {
      return;
    }
    setError('');
    try {
      const blob = await onCapturePreview(PREVIEW_PRESET);
      if (!blob) {
        setError('3D ko‘rinishni olish imkoni bo‘lmadi.');
        return;
      }
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (cause) {
      setError(
        cause instanceof Error ? `3D ko‘rinish xatosi: ${cause.message}` : '3D ko‘rinish xatosi.',
      );
    }
  };

  return (
    <div className="field product" data-testid="product-package">
      <span className="field__label">Birinchi tijoriy mahsulot — paket</span>
      <p className="visual__hint">
        Tanlangan model uchun tayyorlik tekshiriladi va bitta paketda: 3D model, BOM, kesish
        ro‘yxati, chizma, materiallar, validatsiya, montaj, kesish rejasi, PDF va inglizcha tavsif
        yig‘iladi.
      </p>

      <ul className="product__status" data-testid="product-context">
        <li>
          Mahsulot: {object.name} · {current ? current.description.name : '—'}
        </li>
        <li>
          Materiallar: {materials.length > 0 ? `${materials.length} detalga tayinlangan` : 'tayinlanmagan'}
        </li>
      </ul>

      <button
        type="button"
        className="visual-reset manufacturing__package-button"
        onClick={handleCheck}
        disabled={busy}
        data-testid="product-check"
      >
        {busy ? 'Tekshirilmoqda…' : current ? 'Tayyorlikni qayta tekshirish' : 'Tayyorlikni tekshirish'}
      </button>

      {onCapturePreview && (
        <button
          type="button"
          className="visual-reset"
          onClick={handlePreview}
          data-testid="product-preview"
        >
          3D ko‘rinishni olish
        </button>
      )}

      {previewUrl && (
        <figure className="product__preview" data-testid="product-preview-image">
          <img src={previewUrl} alt="Tanlangan modelning joriy 3D ko‘rinishi" />
          <figcaption className="visual__hint">
            Joriy modelning brauzerdagi 3D ko‘rinishi (PNG). Bu fotosurat yoki fotorealistik render
            emas.
          </figcaption>
        </figure>
      )}

      {error && (
        <p className="field__error" role="alert" data-testid="product-error">
          {error}
        </p>
      )}
      {message && !error && (
        <p className="render__message" role="status" data-testid="product-message">
          {message}
        </p>
      )}

      {stale && (
        <p className="render__message render__message--error" role="alert" data-testid="product-stale">
          Model yoki materiallar o‘zgargan — quyidagi natija eski model uchun. Qayta tekshiring.
        </p>
      )}

      {!current && !error && (
        <p className="visual__hint">
          Natija tekshiruvdan keyin ko‘rsatiladi. Tekshiruv model, detallar va eksportlarning
          o‘zaro mosligini tekshiradi.
        </p>
      )}

      {current && (
        <>
          <p
            className={`product__verdict product__verdict--${STATUS_MODIFIER[current.readiness.status]}`}
            data-testid="product-verdict"
          >
            Umumiy holat: {statusLabel(current.readiness.status)} ·{' '}
            {current.readiness.counts.pass} tayyor · {current.readiness.counts.warning}{' '}
            ogohlantirish · {current.readiness.counts.fail} xato ·{' '}
            {current.readiness.counts.not_applicable} qo‘llanmaydi
          </p>

          <ul className="product__checks" data-testid="product-checks">
            {current.readiness.checks.map((check) => (
              <li
                key={check.id}
                className={`product__check product__check--${STATUS_MODIFIER[check.status]}`}
                data-testid={`product-check-${check.id}`}
              >
                <span className="product__check-label">{check.label}</span>
                <span className="product__check-status">{statusLabel(check.status)}</span>
                <span className="product__check-detail">{check.detail}</span>
              </li>
            ))}
          </ul>

          <div className="product__actions">
            <button
              type="button"
              className="visual-reset manufacturing__package-button"
              onClick={handleDownload}
              data-testid="product-download"
            >
              Mahsulot paketini yuklab olish (ZIP)
            </button>
            <button
              type="button"
              className="visual-reset"
              onClick={handleDownloadDescription}
              data-testid="product-download-description"
            >
              Inglizcha tavsifni yuklab olish (MD)
            </button>
          </div>

          <div className="product__description" data-testid="product-description">
            <p className="field__label">Product description (English)</p>
            <p className="product__description-name">
              {current.description.name} — {current.description.purpose}
            </p>
            <ul className="manufacturing__list">
              {current.description.features.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="field__label">Dimensions</p>
            <ul className="manufacturing__list">
              {current.description.dimensions.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="field__label">Materials</p>
            <ul className="manufacturing__list">
              {current.description.materials.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="field__label">Included documents</p>
            <ul className="manufacturing__list">
              {current.description.documents.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          <ul className="image-ref__warnings" data-testid="product-limitations">
            {current.description.limitations.map((line) => (
              <li key={line}>{line}</li>
            ))}
            {current.readiness.limitations.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
