import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FURNITURE_TYPES,
  FURNITURE_TYPE_LABELS,
  type FurnitureType,
} from '../geometry/furniture/types';
import {
  IMAGE_FORMAT_LABELS,
  SUPPORTED_IMAGE_MIME,
  validateImageContent,
} from '../image/imageFile';
import { describeImageTo3DStatus } from '../image/imageTo3dProvider';
import { loadImageSample, canDecodeImages, type LoadedImageSample } from '../image/referenceImage';
import { inferDesignSpec, type InferenceResult } from '../image/referenceInference';
import type { DesignSpec } from '../image/designSpec';

interface ImageReferencePanelProps {
  /** Called with the confirmed type + spec once the user accepts the proposal. */
  onConfirm: (type: FurnitureType, spec: DesignSpec) => void;
}

type Status = 'idle' | 'working' | 'ready' | 'error';

type ReferenceField = 'widthCm' | 'heightCm' | 'depthCm';

const REFERENCE_LABELS: Record<ReferenceField, string> = {
  widthCm: 'Kenglik',
  heightCm: 'Balandlik',
  depthCm: 'Chuqurlik',
};

const ACCEPT_ATTR = SUPPORTED_IMAGE_MIME.join(',');

export function ImageReferencePanel({ onConfirm }: ImageReferencePanelProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [sample, setSample] = useState<LoadedImageSample | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [type, setType] = useState<FurnitureType>('table');
  const [reference, setReference] = useState<ReferenceField>('widthCm');
  const [referenceValue, setReferenceValue] = useState('');
  const [proposal, setProposal] = useState<DesignSpec | null>(null);
  const urlRef = useRef<string | null>(null);

  const providerStatus = describeImageTo3DStatus();

  // Revoke the preview object URL when it changes or the panel unmounts.
  useEffect(() => {
    urlRef.current = previewUrl;
    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [previewUrl]);

  const clearImage = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPreviewUrl(null);
    setSample(null);
    setProposal(null);
  }, []);

  const handleFile = async (file: File) => {
    setProposal(null);
    setStatus('working');
    setMessage('Rasm tekshirilmoqda…');

    try {
      const buffer = await file.arrayBuffer();
      // Content-based validation: filename and MIME are only cross-checked.
      const validation = validateImageContent({ buffer, declaredMime: file.type });
      if (!validation.ok) {
        clearImage();
        setStatus('error');
        setMessage(validation.message);
        return;
      }

      if (!canDecodeImages()) {
        clearImage();
        setStatus('error');
        setMessage("Bu qurilmada rasmni tahlil qilib bo'lmaydi.");
        return;
      }

      const loaded = await loadImageSample(buffer, validation.format);
      // Create the preview URL only after the image passed every check.
      clearImage();
      const url = URL.createObjectURL(file);
      urlRef.current = url;
      setPreviewUrl(url);
      setSample(loaded);
      setStatus('ready');
      setMessage(
        `Rasm qabul qilindi: ${IMAGE_FORMAT_LABELS[validation.format]}, ` +
          `${loaded.width}×${loaded.height}px.`,
      );
    } catch (error) {
      clearImage();
      setStatus('error');
      setMessage(error instanceof Error ? error.message : "Rasmni o'qib bo'lmadi.");
    }
  };

  const handleInfer = () => {
    if (!sample) {
      return;
    }
    const parsed = referenceValue.trim() === '' ? null : Number(referenceValue);
    const result: InferenceResult = inferDesignSpec({
      type,
      sample: { aspectRatio: sample.aspectRatio, averageColor: sample.averageColor },
      referenceWidthCm: parsed !== null && Number.isFinite(parsed) ? parsed : null,
      reference,
    });

    if (!result.ok) {
      setProposal(null);
      setStatus('error');
      setMessage(result.message);
      return;
    }
    setProposal(result.spec);
    setStatus('ready');
    setMessage('Taxminiy parametrlar tayyor. Tekshiring va tasdiqlang.');
  };

  const handleConfirm = () => {
    if (!proposal) {
      return;
    }
    // The scene is only changed here, after the user confirms.
    onConfirm(proposal.furniture, proposal);
    setProposal(null);
    clearImage();
    setStatus('idle');
    setReferenceValue('');
    setMessage("Tasdiqlangan parametrlar asosida model sahnaga qo'shildi.");
  };

  return (
    <section className="image-ref">
      <h2 className="image-ref__title">Rasm asosida yaratish</h2>

      <div className="field">
        <span className="field__label">Reference rasm (PNG/JPEG/WebP)</span>
        <input
          className="field__input"
          type="file"
          accept={ACCEPT_ATTR}
          aria-label="Reference rasm yuklash"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleFile(file);
            }
            // Allow re-selecting the same file.
            event.target.value = '';
          }}
        />
        <p className="visual__hint">
          Rasm faqat shu qurilmada tahlil qilinadi; tasdiqlamaguningizcha hech qayerga
          yuborilmaydi va saqlanmaydi.
        </p>
      </div>

      {previewUrl && (
        <div className="image-ref__preview">
          <img src={previewUrl} alt="Yuklangan rasm" className="image-ref__image" />
          <button type="button" className="visual-reset" onClick={clearImage}>
            Rasmni olib tashlash
          </button>
        </div>
      )}

      {status === 'error' ? (
        <p className="render__message render__message--error" role="alert">
          {message}
        </p>
      ) : (
        message && (
          <p className="render__message" role="status" aria-live="polite">
            {message}
          </p>
        )
      )}

      {sample && (
        <div className="field">
          <span className="field__label">Parametrlarni aniqlash</span>
          <select
            className="field__input"
            value={type}
            aria-label="Mebel turi"
            onChange={(event) => setType(event.target.value as FurnitureType)}
          >
            {FURNITURE_TYPES.map((entry) => (
              <option key={entry} value={entry}>
                {FURNITURE_TYPE_LABELS[entry]}
              </option>
            ))}
          </select>
          <select
            className="field__input"
            value={reference}
            aria-label="Ma'lum o'lcham turi"
            onChange={(event) => setReference(event.target.value as ReferenceField)}
          >
            {(Object.keys(REFERENCE_LABELS) as ReferenceField[]).map((field) => (
              <option key={field} value={field}>
                {REFERENCE_LABELS[field]}
              </option>
            ))}
          </select>
          <input
            className="field__input"
            type="number"
            inputMode="decimal"
            min={10}
            max={400}
            placeholder="Ma'lum o'lcham (sm) — majburiy"
            aria-label="Ma'lum o'lcham (sm)"
            value={referenceValue}
            onChange={(event) => setReferenceValue(event.target.value)}
          />
          <button type="button" className="visual-reset" onClick={handleInfer}>
            Parametrlarni baholash
          </button>
          <p className="visual__hint">
            Rasm aniq o&apos;lcham bermaydi; kamida bitta ma&apos;lum o&apos;lchamni kiriting.
            Baholash proporsiya evristikasi (AI emas).
          </p>
        </div>
      )}

      {proposal && (
        <div className="image-ref__proposal">
          <h3 className="image-ref__subtitle">
            Taklif: {FURNITURE_TYPE_LABELS[proposal.furniture]}
          </h3>
          {proposal.dimensions && (
            <p className="image-ref__dims">
              {proposal.dimensions.width_cm} × {proposal.dimensions.height_cm} ×{' '}
              {proposal.dimensions.depth_cm} sm (ishonch: past / taxminiy)
            </p>
          )}
          {proposal.notes.length > 0 && (
            <ul className="image-ref__notes">
              {proposal.notes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {proposal.warnings.length > 0 && (
            <ul className="image-ref__warnings">
              {proposal.warnings.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <button type="button" className="render__button" onClick={handleConfirm}>
            Tasdiqlash va modelni qo&apos;shish
          </button>
        </div>
      )}

      <div className="field">
        <span className="field__label">Haqiqiy image-to-3D (AI mesh)</span>
        <p className="visual__hint">{providerStatus.message}</p>
        <button type="button" className="visual-reset" disabled aria-disabled="true">
          AI mesh generatsiyasi (sozlanmagan)
        </button>
      </div>
    </section>
  );
}
