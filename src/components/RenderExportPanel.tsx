import {
  PNG_PRESET_LABELS,
  UI_PNG_PRESETS,
  type PngPreset,
} from '../export/sceneImage';
import {
  QUALITY_PRESETS,
  QUALITY_PRESET_LABELS,
  type QualityPresetId,
} from '../render/renderPresets';

export type RenderStatus = 'idle' | 'working' | 'success' | 'error';

export interface RenderProgress {
  current: number;
  total: number;
  label: string;
}

interface RenderExportPanelProps {
  preset: PngPreset;
  quality: QualityPresetId;
  transparent: boolean;
  /** False once the browser probe proved that alpha cannot be preserved. */
  transparentAvailable: boolean;
  status: RenderStatus;
  message: string;
  progress: RenderProgress | null;
  disabled: boolean;
  onPresetChange: (preset: PngPreset) => void;
  onQualityChange: (quality: QualityPresetId) => void;
  onTransparentChange: (transparent: boolean) => void;
  onExportCurrent: () => void;
  onExportBatch: () => void;
}

export function RenderExportPanel({
  preset,
  quality,
  transparent,
  transparentAvailable,
  status,
  message,
  progress,
  disabled,
  onPresetChange,
  onQualityChange,
  onTransparentChange,
  onExportCurrent,
  onExportBatch,
}: RenderExportPanelProps) {
  const isWorking = status === 'working';

  return (
    <section className="render">
      <h2 className="render__title">Render (PNG)</h2>

      <div className="field">
        <span className="field__label">Render sifati</span>
        <div className="preset-grid">
          {QUALITY_PRESETS.map((key) => (
            <button
              key={key}
              type="button"
              className={key === quality ? 'preset preset--active' : 'preset'}
              aria-pressed={key === quality}
              onClick={() => onQualityChange(key)}
            >
              {QUALITY_PRESET_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field__label">Rezolyutsiya</span>
        <div className="preset-grid">
          {UI_PNG_PRESETS.map((key) => (
            <button
              key={key}
              type="button"
              className={key === preset ? 'preset preset--active' : 'preset'}
              aria-pressed={key === preset}
              onClick={() => onPresetChange(key)}
            >
              {PNG_PRESET_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field__label">Fon</span>
        <div className="preset-grid">
          <button
            type="button"
            className={!transparent ? 'preset preset--active' : 'preset'}
            aria-pressed={!transparent}
            onClick={() => onTransparentChange(false)}
          >
            Opaque
          </button>
          <button
            type="button"
            className={transparent ? 'preset preset--active' : 'preset'}
            aria-pressed={transparent}
            onClick={() => onTransparentChange(true)}
            disabled={!transparentAvailable}
            title={
              transparentAvailable
                ? 'Shaffof fonli PNG'
                : "Brauzer shaffof fonni saqlamadi; bu variant o'chirildi."
            }
          >
            Shaffof fon
          </button>
        </div>
        <p className="visual__hint">
          Shaffof fon faqat fonni tozalaydi; xona devori kontent sifatida qoladi.
          6 rakursli ZIPda xona yashiriladi.
        </p>
      </div>

      <button
        type="button"
        className="render__button"
        onClick={onExportCurrent}
        disabled={disabled || isWorking}
      >
        Joriy rakursni PNG qilib saqlash
      </button>

      <button
        type="button"
        className="render__button render__button--secondary"
        onClick={onExportBatch}
        disabled={disabled || isWorking}
      >
        6 rakursni ZIP qilib saqlash
      </button>

      {progress && (
        <div
          className="render__progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.current}
        >
          <div
            className="render__progress-bar"
            style={{ width: `${(progress.current / progress.total) * 100}%` }}
          />
          <span className="render__progress-text">
            {progress.current}/{progress.total} — {progress.label}
          </span>
        </div>
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

      <p className="visual__hint">
        Brauzerdagi WebGL render asosida; fotorealistik render fermasi emas.
      </p>
    </section>
  );
}
