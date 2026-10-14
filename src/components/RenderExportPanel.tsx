import { PNG_PRESETS, type PngPreset } from '../export/sceneImage';
import {
  QUALITY_PRESETS,
  QUALITY_PRESET_LABELS,
  type QualityPresetId,
} from '../render/renderPresets';

export type RenderStatus = 'idle' | 'working' | 'success' | 'error';

interface RenderExportPanelProps {
  preset: PngPreset;
  quality: QualityPresetId;
  status: RenderStatus;
  message: string;
  disabled: boolean;
  onPresetChange: (preset: PngPreset) => void;
  onQualityChange: (quality: QualityPresetId) => void;
  onExport: () => void;
}

const PRESET_LABELS: Record<PngPreset, string> = {
  preview: `Tezkor (${PNG_PRESETS.preview.width}×${PNG_PRESETS.preview.height})`,
  standard: `Standart (${PNG_PRESETS.standard.width}×${PNG_PRESETS.standard.height})`,
  high: `Yuqori (${PNG_PRESETS.high.width}×${PNG_PRESETS.high.height})`,
};

export function RenderExportPanel({
  preset,
  quality,
  status,
  message,
  disabled,
  onPresetChange,
  onQualityChange,
  onExport,
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
          {(Object.keys(PRESET_LABELS) as PngPreset[]).map((key) => (
            <button
              key={key}
              type="button"
              className={key === preset ? 'preset preset--active' : 'preset'}
              aria-pressed={key === preset}
              onClick={() => onPresetChange(key)}
            >
              {PRESET_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="render__button"
        onClick={onExport}
        disabled={disabled || isWorking}
      >
        {isWorking ? 'Render qilinmoqda…' : 'PNG sifatida saqlash'}
      </button>

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
