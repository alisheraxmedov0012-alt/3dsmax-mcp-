import type { ReactNode } from 'react';
import {
  TABLE_COLORS,
  TABLE_LIMITS,
  type TableDimensionField,
  type TableErrors,
  type TableFieldValues,
} from '../geometry/tableParams';

interface ControlsPanelProps {
  values: TableFieldValues;
  errors: TableErrors;
  onChange: (field: keyof TableFieldValues, value: string) => void;
  onReset: () => void;
  tableSelected?: boolean;
  children?: ReactNode;
}

const DIMENSION_FIELDS: ReadonlyArray<{ key: TableDimensionField; label: string }> = [
  { key: 'widthCm', label: 'Kenglik (sm)' },
  { key: 'heightCm', label: 'Balandlik (sm)' },
  { key: 'depthCm', label: 'Chuqurlik (sm)' },
];

function sliderValue(raw: string, min: number, max: number): number {
  const numeric = Number(raw.trim());
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.min(Math.max(numeric, min), max);
}

export function ControlsPanel({
  values,
  errors,
  onChange,
  onReset,
  tableSelected = true,
  children,
}: ControlsPanelProps) {
  const colorIsValid = /^#[0-9a-fA-F]{6}$/.test(values.color);

  return (
    <aside className="panel">
      <header className="panel__header">
        <h1 className="panel__title">3D Studio AI</h1>
        <p className="panel__subtitle">5-bosqich — arxitektura va interyer</p>
      </header>

      {tableSelected ? (
        <section className="table-params">
          <h2 className="table-params__title">Stol parametrlari</h2>

          {DIMENSION_FIELDS.map(({ key, label }) => {
            const range = TABLE_LIMITS[key];
            return (
              <div className="field" key={key}>
                <label className="field__label" htmlFor={`${key}-number`}>
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
                  value={sliderValue(values[key], range.min, range.max)}
                  aria-label={`${label} slayder`}
                  onChange={(event) => onChange(key, event.target.value)}
                />
                <input
                  id={`${key}-number`}
                  className={errors[key] ? 'field__input field__input--error' : 'field__input'}
                  type="number"
                  inputMode="decimal"
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  value={values[key]}
                  aria-invalid={Boolean(errors[key])}
                  onChange={(event) => onChange(key, event.target.value)}
                />
                {errors[key] && (
                  <span className="field__error" role="alert">
                    {errors[key]}
                  </span>
                )}
              </div>
            );
          })}

          <div className="field">
            <span className="field__label">Rang</span>
            <div className="swatches">
              {TABLE_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={color === values.color ? 'swatch swatch--active' : 'swatch'}
                  style={{ backgroundColor: color }}
                  aria-label={`Rang ${color}`}
                  aria-pressed={color === values.color}
                  onClick={() => onChange('color', color)}
                />
              ))}
            </div>
            <input
              className={errors.color ? 'field__input field__input--error' : 'field__input'}
              type="color"
              value={colorIsValid ? values.color : '#000000'}
              aria-label="Rang tanlash"
              onChange={(event) => onChange('color', event.target.value)}
            />
            {errors.color && (
              <span className="field__error" role="alert">
                {errors.color}
              </span>
            )}
          </div>

          <button type="button" className="reset" onClick={onReset}>
            Stolni boshlang'ich holatga qaytarish
          </button>
        </section>
      ) : (
        <p className="panel__hint">
          Stol parametrlari uchun stolni tanlang (ro'yxatdan yoki 3D ko'rinishdan).
        </p>
      )}

      <p className="panel__hint">
        Model sichqoncha yoki sensorli ekran orqali aylantiriladi va kattalashtiriladi.
      </p>

      {children}
    </aside>
  );
}
