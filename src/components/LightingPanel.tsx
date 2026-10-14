import { LIGHT_LIMITS, type LightSettings } from '../scene/sceneSettings';

interface LightingPanelProps {
  lights: LightSettings;
  onUpdate: (patch: Partial<LightSettings>) => void;
  onReset: () => void;
}

const RANGE = LIGHT_LIMITS.intensity;

interface SliderRowProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
}

function IntensityRow({ label, value, onChange }: SliderRowProps) {
  return (
    <div className="field">
      <label className="field__label">
        {label}
        <span className="field__range">
          {RANGE.min}–{RANGE.max}
        </span>
      </label>
      <input
        type="range"
        min={RANGE.min}
        max={RANGE.max}
        step={RANGE.step}
        value={value}
        aria-label={`${label} slayder`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <input
        className="field__input"
        type="number"
        inputMode="decimal"
        min={RANGE.min}
        max={RANGE.max}
        step={RANGE.step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

export function LightingPanel({ lights, onUpdate, onReset }: LightingPanelProps) {
  return (
    <section className="lighting">
      <h2 className="lighting__title">Yorug'lik</h2>

      <IntensityRow
        label="Umumiy (ambient)"
        value={lights.ambientIntensity}
        onChange={(value) => onUpdate({ ambientIntensity: value })}
      />
      <div className="field">
        <span className="field__label">Ambient rangi</span>
        <input
          type="color"
          value={lights.ambientColor}
          aria-label="Ambient rangi"
          onChange={(event) => onUpdate({ ambientColor: event.target.value })}
        />
      </div>

      <label className="toggle">
        <input
          type="checkbox"
          checked={lights.keyEnabled}
          onChange={(event) => onUpdate({ keyEnabled: event.target.checked })}
        />
        Asosiy yorug'lik (key)
      </label>
      <IntensityRow
        label="Asosiy intensivlik"
        value={lights.keyIntensity}
        onChange={(value) => onUpdate({ keyIntensity: value })}
      />
      <div className="field">
        <span className="field__label">Asosiy rang</span>
        <input
          type="color"
          value={lights.keyColor}
          aria-label="Asosiy yorug'lik rangi"
          onChange={(event) => onUpdate({ keyColor: event.target.value })}
        />
      </div>

      <label className="toggle">
        <input
          type="checkbox"
          checked={lights.fillEnabled}
          onChange={(event) => onUpdate({ fillEnabled: event.target.checked })}
        />
        To'ldiruvchi yorug'lik (fill)
      </label>
      <IntensityRow
        label="To'ldiruvchi intensivlik"
        value={lights.fillIntensity}
        onChange={(value) => onUpdate({ fillIntensity: value })}
      />
      <div className="field">
        <span className="field__label">To'ldiruvchi rang</span>
        <input
          type="color"
          value={lights.fillColor}
          aria-label="To'ldiruvchi yorug'lik rangi"
          onChange={(event) => onUpdate({ fillColor: event.target.value })}
        />
      </div>

      <label className="toggle">
        <input
          type="checkbox"
          checked={lights.shadowsEnabled}
          onChange={(event) => onUpdate({ shadowsEnabled: event.target.checked })}
        />
        Soyalar
      </label>

      <button type="button" className="visual-reset" onClick={onReset}>
        Yorug'likni tiklash
      </button>
    </section>
  );
}
