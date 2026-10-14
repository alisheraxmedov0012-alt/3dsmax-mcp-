import { MATERIAL_LIMITS, type SceneObject } from '../scene/types';

interface MaterialPanelProps {
  object: SceneObject | null;
  onMaterial: (patch: { metalness?: number; roughness?: number }) => void;
  onReset: () => void;
}

const METALNESS = MATERIAL_LIMITS.metalness;
const ROUGHNESS = MATERIAL_LIMITS.roughness;

export function MaterialPanel({ object, onMaterial, onReset }: MaterialPanelProps) {
  if (!object) {
    return (
      <section className="material">
        <h2 className="material__title">Material</h2>
        <p className="material__empty">Materialni sozlash uchun stolni tanlang.</p>
      </section>
    );
  }

  return (
    <section className="material">
      <h2 className="material__title">Material</h2>

      <div className="field">
        <label className="field__label" htmlFor="material-metalness">
          Metallik
          <span className="field__range">
            {METALNESS.min}–{METALNESS.max}
          </span>
        </label>
        <input
          id="material-metalness"
          type="range"
          min={METALNESS.min}
          max={METALNESS.max}
          step={METALNESS.step}
          value={object.material.metalness}
          onChange={(event) => onMaterial({ metalness: Number(event.target.value) })}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="material-roughness">
          Silliqlik/qo'pollik
          <span className="field__range">
            {ROUGHNESS.min}–{ROUGHNESS.max}
          </span>
        </label>
        <input
          id="material-roughness"
          type="range"
          min={ROUGHNESS.min}
          max={ROUGHNESS.max}
          step={ROUGHNESS.step}
          value={object.material.roughness}
          onChange={(event) => onMaterial({ roughness: Number(event.target.value) })}
        />
      </div>

      <button type="button" className="visual-reset" onClick={onReset}>
        Materialni tiklash
      </button>

      <p className="visual__hint">
        Asosiy rang — «Stol parametrlari» bo'limidagi rang boshqaruvi orqali.
      </p>
    </section>
  );
}
