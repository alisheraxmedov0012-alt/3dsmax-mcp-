import { useMemo, useRef, useState, type ReactNode } from 'react';
import { TABLE_COLORS } from '../geometry/tableParams';
import {
  FURNITURE_FIELDS,
  FURNITURE_TYPES,
  FURNITURE_TYPE_LABELS,
  type FurnitureType,
} from '../geometry/furniture/types';
import type { FurnitureErrors } from '../geometry/furniture/params';
import { buildFurniture } from '../geometry/furniture/buildFurniture';
import { envelopeMm, measurePartBoxes } from '../manufacturing/partBoxes';
import type { SceneObject } from '../scene/types';

interface FurniturePanelProps {
  object: SceneObject | null;
  values: Record<string, string>;
  errors: FurnitureErrors;
  onChange: (field: string, value: string) => void;
  onReset: () => void;
  onAdd: (type: FurnitureType) => void;
  children?: ReactNode;
  /**
   * Enables the mobile section navigation. Child panels are wrapped by the
   * caller with `panel__section[data-section]`; every section stays mounted and
   * CSS selects the active one, so local input state survives tab switches.
   * Desktop ignores the nav and shows all children in their original order.
   */
  mobileSections?: boolean;
}

export type PanelSectionId = 'scene' | 'objects' | 'materials' | 'ai' | 'export' | 'other';

const MOBILE_SECTIONS: ReadonlyArray<{ id: PanelSectionId; label: string }> = [
  { id: 'scene', label: 'Sahna' },
  { id: 'objects', label: 'Obyektlar' },
  { id: 'materials', label: 'Materiallar' },
  { id: 'ai', label: 'AI' },
  { id: 'export', label: 'Eksport' },
  { id: 'other', label: 'Boshqa' },
];

function sliderValue(raw: string | undefined, min: number, max: number): number {
  const numeric = Number((raw ?? '').trim());
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.min(Math.max(numeric, min), max);
}

export function FurniturePanel({
  object,
  values,
  errors,
  onChange,
  onReset,
  onAdd,
  children,
  mobileSections = false,
}: FurniturePanelProps) {
  const [addType, setAddType] = useState<FurnitureType>('table');
  const [activeSection, setActiveSection] = useState<PanelSectionId>('objects');
  const panelRef = useRef<HTMLElement>(null);
  const colorIsValid = /^#[0-9a-fA-F]{6}$/.test(values.color ?? '');

  const selectSection = (section: PanelSectionId) => {
    setActiveSection(section);
    // The panel is the scroll container; without this a tab switch would open
    // somewhere in the middle of the newly selected section.
    if (panelRef.current) {
      panelRef.current.scrollTop = 0;
    }
  };

  /**
   * The finished piece's measured bounding box, derived from the *committed*
   * params — the same model the 3D view renders and the documents describe, not
   * the half-typed field values. Some parameters drive only part of the
   * construction (a bed's frame height, a dresser's carcass depth), so this is
   * the only value that answers "how big is it really?".
   */
  const overall = useMemo(() => {
    if (!object) {
      return null;
    }
    try {
      const built = buildFurniture(object.type, object.params);
      try {
        return envelopeMm(measurePartBoxes(built.group));
      } finally {
        built.dispose();
      }
    } catch (error) {
      console.error('Umumiy olchamni hisoblash xatosi:', error);
      return null;
    }
  }, [object]);

  return (
    <aside
      ref={panelRef}
      className="panel"
      data-mobile-section={mobileSections ? activeSection : undefined}
    >
      <header className="panel__header">
        <h1 className="panel__title">3D Studio AI</h1>
        <p className="panel__subtitle">W2 — parametrik mebel</p>
      </header>

      {mobileSections && (
        <nav className="panel__mobile-nav" aria-label="Mobil bo‘limlar">
          {MOBILE_SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={
                entry.id === activeSection
                  ? 'panel__mobile-tab panel__mobile-tab--active'
                  : 'panel__mobile-tab'
              }
              aria-pressed={entry.id === activeSection}
              onClick={() => selectSection(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      )}

      <div className="panel__section" data-section="objects">
        <section className="furniture-add">
          <h2 className="table-params__title">Mebel qo&apos;shish</h2>
          <div className="field">
            <label className="field__label" htmlFor="furniture-type">
              Mebel turi
            </label>
            <select
              id="furniture-type"
              className="field__input"
              value={addType}
              onChange={(event) => setAddType(event.target.value as FurnitureType)}
            >
              {FURNITURE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {FURNITURE_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            <button type="button" className="reset" onClick={() => onAdd(addType)}>
              {FURNITURE_TYPE_LABELS[addType]} qo&apos;shish
            </button>
          </div>
        </section>

        {object ? (
          <section className="table-params">
            <h2 className="table-params__title">
              {FURNITURE_TYPE_LABELS[object.type]} parametrlari
            </h2>

            {FURNITURE_FIELDS[object.type].map((spec) => {
              const { key, label, range } = spec;
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
                    value={values[key] ?? ''}
                    aria-invalid={Boolean(errors[key])}
                    onChange={(event) => onChange(key, event.target.value)}
                  />
                  {errors[key] && (
                    <span className="field__error" role="alert">
                      {errors[key]}
                    </span>
                  )}
                  {spec.hint && !errors[key] && (
                    <p className="visual__hint" data-testid={`${key}-hint`}>
                      {spec.hint}
                    </p>
                  )}
                </div>
              );
            })}

            {/* The measured envelope, not the parametric values above it. Shown
                because some parameters cover only part of the construction. */}
            {overall && (
              <div className="field" data-testid="furniture-overall">
                <span className="field__label">Umumiy tashqi o‘lcham</span>
                <p className="visual__hint" data-testid="furniture-overall-value">
                  W {overall.widthMm} × H {overall.heightMm} × D {overall.depthMm} mm — geometriyadan
                  o‘lchandi.
                </p>
              </div>
            )}

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
                value={colorIsValid ? (values.color ?? '#000000') : '#000000'}
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
              Boshlang&apos;ich holatga qaytarish
            </button>
          </section>
        ) : (
          <p className="panel__hint">
            Parametrlarni tahrirlash uchun mebelni tanlang (ro&apos;yxatdan yoki 3D ko&apos;rinishdan).
          </p>
        )}

        <p className="panel__hint">
          Model sichqoncha yoki sensorli ekran orqali aylantiriladi va kattalashtiriladi.
        </p>
      </div>

      {children}
    </aside>
  );
}
