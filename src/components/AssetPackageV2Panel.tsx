/**
 * Phase 6.1 — professional asset package v2 UI.
 *
 * Deliberately separate from the legacy A4 package section: the old API and
 * button stay untouched, while this panel exposes the multi-format builder.
 */
import { useState } from 'react';
import { downloadBlob } from '../export/downloadFile';
import {
  ASSET_PACKAGE_V2_LIMITS,
  ASSET_PACKAGE_V2_MODEL_FORMATS,
  ASSET_PACKAGE_V2_SKU_PATTERN,
  buildAssetPackageV2,
  sanitizeArchiveRoot,
  type AssetPackageV2ModelFormat,
} from '../export/assetPackageV2';
import type { AssetPreviewImage } from '../export/assetPackage';
import type { SceneData, SceneObject } from '../scene/types';

interface AssetPackageV2PanelProps {
  scene: SceneData;
  object: SceneObject;
  projectName: string;
  onCaptureProductPreviews?: () => Promise<Array<{ name: string; bytes: Uint8Array }> | null>;
  captureBlockedReason?: string;
}

const FORMAT_LABELS: Record<AssetPackageV2ModelFormat, string> = {
  glb: 'GLB (metr, PBR)',
  obj: 'OBJ + MTL (mm, geometriya + asosiy teksturalar)',
  stl: 'STL (mm, faqat geometriya)',
  '3mf': '3MF (mm, faqat geometriya)',
};

const FORMAT_HINTS: Record<AssetPackageV2ModelFormat, string> = {
  glb: 'PBR materiallar va teksturalar fayl ichida.',
  obj: 'MTL avtomatik qo‘shiladi; baseColor/normal PNG sidecar. Roughness/metalness/AO/emissive faqat GLB’da.',
  stl: 'Material va tekstura yo‘q; units metadata yo‘q.',
  '3mf': 'Material/rang yo‘q; watertight/manifold kafolatlanmagan.',
};

const FORMAT_PROGRESS: Record<AssetPackageV2ModelFormat, string> = {
  glb: 'GLB eksport qilinmoqda…',
  obj: 'OBJ/MTL va teksturalar tayyorlanmoqda…',
  stl: 'STL eksport qilinmoqda…',
  '3mf': '3MF eksport qilinmoqda…',
};

function defaultTitle(projectName: string, object: SceneObject): string {
  return projectName.trim() !== '' ? projectName.trim() : object.name;
}

export function AssetPackageV2Panel({
  scene,
  object,
  projectName,
  onCaptureProductPreviews,
  captureBlockedReason,
}: AssetPackageV2PanelProps) {
  const [title, setTitle] = useState(() => defaultTitle(projectName, object));
  const [sku, setSku] = useState('');
  const [description, setDescription] = useState('');
  const [author, setAuthor] = useState('');
  const [licenseName, setLicenseName] = useState('');
  const [licenseSpdx, setLicenseSpdx] = useState('');
  const [licenseText, setLicenseText] = useState('');
  const [formats, setFormats] = useState<AssetPackageV2ModelFormat[]>([
    ...ASSET_PACKAGE_V2_MODEL_FORMATS,
  ]);
  const [includePreviews, setIncludePreviews] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const toggleFormat = (format: AssetPackageV2ModelFormat) => {
    setFormats((current) =>
      current.includes(format)
        ? current.filter((entry) => entry !== format)
        : [...current, format],
    );
    setError('');
    setMessage('');
  };

  const validate = (): string | null => {
    if (title.trim() === '') return 'Mahsulot nomi majburiy.';
    if (sku.trim() !== '' && !ASSET_PACKAGE_V2_SKU_PATTERN.test(sku.trim())) {
      return 'SKU faqat harf, raqam, ".", "_" va "-" dan iborat bo‘lishi kerak.';
    }
    if (formats.length === 0) return 'Kamida bitta eksport formatini tanlang.';
    if (
      (licenseText.trim() !== '' || licenseSpdx.trim() !== '') &&
      licenseName.trim() === ''
    ) {
      return 'Litsenziya matni yoki SPDX uchun litsenziya nomi ham kiritilishi kerak.';
    }
    if (captureBlockedReason) return captureBlockedReason;
    return null;
  };

  const handleGenerate = async () => {
    if (busy) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      setMessage('');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    setProgress('Paket tayyorlanmoqda…');

    try {
      let previews: readonly AssetPreviewImage[] | null = null;
      if (includePreviews) {
        if (!onCaptureProductPreviews) {
          setError('Preview rasmlarini olish imkoni yo‘q. Preview’ni o‘chirib qayta urinib ko‘ring.');
          return;
        }
        setProgress('6 rakurs preview rasmlari olinmoqda…');
        const captured = await onCaptureProductPreviews();
        if (!captured || captured.length === 0) {
          setError('Preview rasmlarini olish imkoni bo‘lmadi.');
          return;
        }
        previews = captured;
      }

      const root =
        sanitizeArchiveRoot(sku.trim() !== '' ? sku.trim() : title.trim()) ?? 'Product';
      const outcome = await buildAssetPackageV2(
        {
          scene,
          object,
          projectName: title.trim(),
          product: {
            title: title.trim(),
            ...(sku.trim() ? { sku: sku.trim() } : {}),
            ...(description.trim() ? { description: description.trim() } : {}),
            ...(author.trim() ? { author: author.trim() } : {}),
            ...(licenseName.trim()
              ? {
                  license: {
                    name: licenseName.trim(),
                    ...(licenseSpdx.trim() ? { spdx: licenseSpdx.trim() } : {}),
                    ...(licenseText.trim() ? { text: licenseText } : {}),
                  },
                }
              : {}),
          },
          ...(previews ? { previews } : {}),
        },
        ASSET_PACKAGE_V2_LIMITS,
        {
          formats,
          archiveRoot: root,
          onProgress: (entry) => {
            if (entry.format) {
              setProgress(FORMAT_PROGRESS[entry.format]);
            } else {
              setProgress('ZIP va checksums yig‘ilmoqda…');
            }
          },
        },
      );
      if (!outcome.ok) {
        setError(`Asset paketi yaratilmadi: ${outcome.reason}`);
        return;
      }

      downloadBlob(
        new Blob([outcome.asset.bytes], { type: 'application/zip' }),
        outcome.asset.filename,
      );
      const megabytes = outcome.asset.bytes.byteLength / (1024 * 1024);
      setMessage(
        `ZIP tayyor: ${outcome.asset.entries.length} fayl · ` +
          `${outcome.asset.metadata.models.length} model · ` +
          `${megabytes.toFixed(2)} MB.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Asset paketi yaratilmadi: ${cause.message}`
          : 'Asset paketi yaratilmadi.',
      );
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <section className="field asset-v2" data-testid="asset-v2-package">
      <span className="field__label">Professional asset paketi (v2)</span>
      <p className="visual__hint">
        GLB, OBJ/MTL, STL va 3MF bitta ZIP’da; tanlangan obyekt, preview rasmlar, metadata,
        SHA-256 checksums va ixtiyoriy litsenziya matni bilan.
      </p>

      <div className="field">
        <label className="field__label" htmlFor="asset-v2-title">Mahsulot nomi *</label>
        <input
          id="asset-v2-title"
          className="field__input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          data-testid="asset-v2-title"
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="asset-v2-sku">SKU</label>
        <input
          id="asset-v2-sku"
          className="field__input"
          value={sku}
          onChange={(event) => setSku(event.target.value)}
          placeholder="OAK-001"
          data-testid="asset-v2-sku"
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="asset-v2-description">Tavsif</label>
        <textarea
          id="asset-v2-description"
          className="field__input"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          data-testid="asset-v2-description"
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="asset-v2-author">Muallif</label>
        <input
          id="asset-v2-author"
          className="field__input"
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
          data-testid="asset-v2-author"
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="asset-v2-license-name">Litsenziya nomi</label>
        <input
          id="asset-v2-license-name"
          className="field__input"
          value={licenseName}
          onChange={(event) => setLicenseName(event.target.value)}
          placeholder="Masalan: CC BY 4.0"
          data-testid="asset-v2-license-name"
        />
        <label className="field__label" htmlFor="asset-v2-license-spdx">SPDX (ixtiyoriy)</label>
        <input
          id="asset-v2-license-spdx"
          className="field__input"
          value={licenseSpdx}
          onChange={(event) => setLicenseSpdx(event.target.value)}
          placeholder="CC-BY-4.0"
          data-testid="asset-v2-license-spdx"
        />
        <label className="field__label" htmlFor="asset-v2-license-text">Litsenziya matni (ixtiyoriy)</label>
        <textarea
          id="asset-v2-license-text"
          className="field__input"
          value={licenseText}
          onChange={(event) => setLicenseText(event.target.value)}
          rows={3}
          data-testid="asset-v2-license-text"
        />
        <p className="visual__hint">
          Litsenziya avtomatik tanlanmaydi. Matn kiritilsa, u LICENSE.txt sifatida paketga qo‘shiladi.
        </p>
      </div>

      <div className="field">
        <span className="field__label">Eksport formatlari</span>
        {ASSET_PACKAGE_V2_MODEL_FORMATS.map((format) => (
          <label className="toggle" key={format}>
            <input
              type="checkbox"
              checked={formats.includes(format)}
              onChange={() => toggleFormat(format)}
              data-testid={`asset-v2-format-${format}`}
            />
            {FORMAT_LABELS[format]}
          </label>
        ))}
        <p className="visual__hint">
          {FORMAT_HINTS[formats[0] ?? 'glb']} OBJ tanlansa MTL va kerakli PNG teksturalar avtomatik qo‘shiladi.
        </p>
      </div>

      <label className="toggle">
        <input
          type="checkbox"
          checked={includePreviews}
          onChange={(event) => setIncludePreviews(event.target.checked)}
          data-testid="asset-v2-include-previews"
        />
        6 rakurs preview rasmlarini qo‘shish
      </label>

      <button
        type="button"
        className="render__button"
        onClick={handleGenerate}
        disabled={busy}
        data-testid="asset-v2-download"
      >
        {busy ? 'Asset paketi yig‘ilmoqda…' : 'Professional ZIP paketini yuklab olish'}
      </button>

      {progress && (
        <p className="render__message" role="status" aria-live="polite" data-testid="asset-v2-progress">
          {progress}
        </p>
      )}
      {error && (
        <p className="field__error" role="alert" data-testid="asset-v2-error">
          {error}
        </p>
      )}
      {message && !error && (
        <p className="render__message" role="status" data-testid="asset-v2-message">
          {message}
        </p>
      )}
    </section>
  );
}
