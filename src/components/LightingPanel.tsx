import { LIGHT_LIMITS, SHADOW_LIMITS, type LightSettings, type NumericRange } from '../scene/sceneSettings';
import { ENVIRONMENT_INTENSITY_LIMITS } from '../render/renderPresets';

interface LightingPanelProps {
  lights: LightSettings;
  environmentEnabled: boolean;
  environmentIntensity: number;
  onUpdate: (patch: Partial<LightSettings>) => void;
  onEnvironmentUpdate: (patch: { enabled?: boolean; intensity?: number }) => void;
  onReset: () => void;
}

const RANGE = LIGHT_LIMITS.intensity;

interface SliderRowProps {
  label: string;
  value: number;
  range?: NumericRange;
  onChange: (value: number) => void;
}

function IntensityRow({ label, value, range = RANGE, onChange }: SliderRowProps) {
  return (
    <div className="field">
      <label className="field__label">
        {label}
        <span className="field__range">
          {range.min}–{range.max}
        </span>
      </label>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        aria-label={`${label} slayder`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <input
        className="field__input"
        type="number"
        inputMode="decimal"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

export function LightingPanel({
  lights,
  environmentEnabled,
  environmentIntensity,
  onUpdate,
  onEnvironmentUpdate,
  onReset,
}: LightingPanelProps) {
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
          checked={lights.rimEnabled}
          onChange={(event) => onUpdate({ rimEnabled: event.target.checked })}
        />
        Orqa (rim) yorug&apos;lik
      </label>
      <IntensityRow
        label="Rim intensivligi"
        value={lights.rimIntensity}
        onChange={(value) => onUpdate({ rimIntensity: value })}
      />
      <div className="field">
        <span className="field__label">Rim rangi</span>
        <input
          type="color"
          value={lights.rimColor}
          aria-label="Rim yorug'lik rangi"
          onChange={(event) => onUpdate({ rimColor: event.target.value })}
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

      <div className="field">
        <span className="field__label">Soya sozlamalari</span>
        <IntensityRow
          label="Soya radiusi"
          value={lights.shadowRadius}
          range={SHADOW_LIMITS.radius}
          onChange={(value) => onUpdate({ shadowRadius: value })}
        />
        <IntensityRow
          label="Soya kuchi"
          value={lights.shadowIntensity}
          range={SHADOW_LIMITS.intensity}
          onChange={(value) => onUpdate({ shadowIntensity: value })}
        />
        <IntensityRow
          label="Soya bias"
          value={lights.shadowBias}
          range={SHADOW_LIMITS.bias}
          onChange={(value) => onUpdate({ shadowBias: value })}
        />
        <IntensityRow
          label="Soya normal bias"
          value={lights.shadowNormalBias}
          range={SHADOW_LIMITS.normalBias}
          onChange={(value) => onUpdate({ shadowNormalBias: value })}
        />
      </div>

      <label className="toggle">
        <input
          type="checkbox"
          checked={environmentEnabled}
          onChange={(event) => onEnvironmentUpdate({ enabled: event.target.checked })}
        />
        Muhit yorug&apos;ligi (environment)
      </label>
      <IntensityRow
        label="Muhit intensivligi"
        value={environmentIntensity}
        range={ENVIRONMENT_INTENSITY_LIMITS}
        onChange={(value) => onEnvironmentUpdate({ intensity: value })}
      />
      <p className="visual__hint">
        RoomEnvironment asosida; tashqi HDRI yuklanmaydi.
      </p>

      <button type="button" className="visual-reset" onClick={onReset}>
        Yorug'likni tiklash
      </button>
    </section>
  );
}
