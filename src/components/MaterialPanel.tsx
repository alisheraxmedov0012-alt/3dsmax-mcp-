import { useState } from 'react';
import { MATERIAL_PRESETS, getMaterialPreset, resolvePresetSettings } from '../materials/presets';
import {
  MATERIAL_TYPE_LABELS,
  PBR_LIMITS,
  type NumericRange,
} from '../materials/types';
import type { ObjectMaterial, SceneObject } from '../scene/types';

interface MaterialPanelProps {
  object: SceneObject | null;
  onMaterial: (patch: Partial<ObjectMaterial>) => void;
  onApplyPreset: (presetId: string) => void;
  onReset: () => void;
}

interface MaterialSliderProps {
  id: string;
  label: string;
  range: NumericRange;
  value: number;
  onChange: (value: number) => void;
}

function MaterialSlider({ id, label, range, value, onChange }: MaterialSliderProps) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        <span className="field__range">
          {range.min}–{range.max}
        </span>
      </label>
      <input
        id={id}
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

export function MaterialPanel({ object, onMaterial, onApplyPreset, onReset }: MaterialPanelProps) {
  const [presetId, setPresetId] = useState(MATERIAL_PRESETS[0].id);

  if (!object) {
    return (
      <section className="material">
        <h2 className="material__title">Material</h2>
        <p className="material__empty">Materialni sozlash uchun stolni tanlang.</p>
      </section>
    );
  }

  // Resolve the stored (possibly partial) material into concrete displayed
  // values, so the controls always reflect what the renderer actually uses.
  const resolved = resolvePresetSettings(object.material);
  const activePreset = getMaterialPreset(resolved.materialId);

  return (
    <section className="material">
      <h2 className="material__title">Material</h2>

      <div className="field">
        <label className="field__label" htmlFor="material-preset">
          Material turi
        </label>
        <select
          id="material-preset"
          className="field__input"
          value={presetId}
          onChange={(event) => setPresetId(event.target.value)}
        >
          {MATERIAL_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
        <button type="button" className="visual-reset" onClick={() => onApplyPreset(presetId)}>
          Presetni qo&apos;llash
        </button>
        <p className="material__active">
          Joriy tur: <strong>{MATERIAL_TYPE_LABELS[activePreset.type]}</strong>
        </p>
      </div>

      <MaterialSlider
        id="material-metalness"
        label="Metallik"
        range={PBR_LIMITS.metalness}
        value={resolved.metalness}
        onChange={(value) => onMaterial({ metalness: value })}
      />
      <MaterialSlider
        id="material-roughness"
        label="Silliqlik/qo'pollik"
        range={PBR_LIMITS.roughness}
        value={resolved.roughness}
        onChange={(value) => onMaterial({ roughness: value })}
      />
      <MaterialSlider
        id="material-opacity"
        label="Shaffoflik (opacity)"
        range={PBR_LIMITS.opacity}
        value={resolved.opacity}
        onChange={(value) => onMaterial({ opacity: value })}
      />
      <MaterialSlider
        id="material-texture-scale"
        label="Tekstura masshtabi"
        range={PBR_LIMITS.textureScale}
        value={resolved.textureScale}
        onChange={(value) => onMaterial({ textureScale: value })}
      />
      <MaterialSlider
        id="material-normal-strength"
        label="Normal karta kuchi"
        range={PBR_LIMITS.normalStrength}
        value={resolved.normalStrength}
        onChange={(value) => onMaterial({ normalStrength: value })}
      />

      <button type="button" className="visual-reset" onClick={onReset}>
        Materialni tiklash
      </button>

      <p className="visual__hint">
        Asosiy rang (albedo) — «Stol parametrlari» bo&apos;limidagi rang boshqaruvi orqali.
        Tekstura va normal karta lokal (procedural) generatsiya qilinadi; tashqi
        assetlar ishlatilmaydi.
      </p>
    </section>
  );
}
