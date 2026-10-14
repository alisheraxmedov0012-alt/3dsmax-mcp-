import { PNG_PRESETS, type PngPreset } from '../export/sceneImage';

export type RenderStatus = 'idle' | 'working' | 'success' | 'error';

interface RenderExportPanelProps {
  preset: PngPreset;
  status: RenderStatus;
  message: string;
  disabled: boolean;
  onPresetChange: (preset: PngPreset) => void;
  onExport: () => void;
}

const PRESET_LABELS: Record<PngPreset, string> = {
  standard: `Standart (${PNG_PRESETS.standard.width}×${PNG_PRESETS.standard.height})`,
  high: `Yuqori (${PNG_PRESETS.high.width}×${PNG_PRESETS.high.height})`,
};

export function RenderExportPanel({
  preset,
  status,
  message,
  disabled,
  onPresetChange,
  onExport,
}: RenderExportPanelProps) {
  const isWorking = status === 'working';

  return (
    <section className="render">
      <h2 className="render__title">Render (PNG)</h2>

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
