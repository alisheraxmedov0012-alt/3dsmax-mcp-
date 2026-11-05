import { useMemo, useState } from 'react';
import { TexturePicker } from './TexturePicker';
import { TextureMapsPicker } from './TextureMapsPicker';
import {
  filterMaterialCatalog,
  getMaterialCatalogEntry,
  listMaterialCatalog,
  listMaterialCategories,
} from '../materials/library';
import { resolvePresetSettings } from '../materials/presets';
import type { TextureAssetRef, TextureMapRole } from '../materials/asset';
import {
  MATERIAL_CATEGORY_LABELS,
  PBR_LIMITS,
  type MaterialCategory,
  type NumericRange,
} from '../materials/types';
import type { ObjectMaterial, SceneObject } from '../scene/types';

interface MaterialPanelProps {
  object: SceneObject | null;
  onMaterial: (patch: Partial<ObjectMaterial>) => void;
  onApplyPreset: (presetId: string) => void;
  onMaterialMap: (role: TextureMapRole, ref: TextureAssetRef | null) => void;
  /** Legacy objects keep `params.color` as the single source of truth. */
  onBaseColor?: (color: string) => void;
  onReset: () => void;
  /** Test override; production reads the build-time backend flag. */
  textureBackendConfigured?: boolean;
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

type CategoryFilter = MaterialCategory | 'all';

const CATALOG_SIZE = listMaterialCatalog().length;

const CATEGORY_OPTIONS: ReadonlyArray<{
  id: CategoryFilter;
  label: string;
  count: number;
}> = [
  { id: 'all', label: 'Barchasi', count: CATALOG_SIZE },
  ...listMaterialCategories().map((category) => ({
    id: category.id as CategoryFilter,
    label: category.label,
    count: category.count,
  })),
];

export function MaterialPanel({
  object,
  onMaterial,
  onApplyPreset,
  onMaterialMap,
  onBaseColor,
  onReset,
  textureBackendConfigured,
}: MaterialPanelProps) {
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');

  const entries = useMemo(
    () =>
      filterMaterialCatalog({
        ...(category === 'all' ? {} : { category }),
        query,
      }),
    [category, query],
  );

  // Always derived from the selected object: the panel never keeps its own idea
  // of the active material, so switching objects cannot leave a stale highlight.
  const resolved = resolvePresetSettings(object?.material);
  const activeEntry = getMaterialCatalogEntry(resolved.materialId);

  if (!object) {
    return (
      <section className="material" data-testid="material-panel">
        <h2 className="material__title">Material kutubxonasi</h2>
        <p className="material__empty" data-testid="material-empty">
          Materialni sozlash uchun mebelni tanlang.
        </p>
      </section>
    );
  }

  return (
    <section className="material" data-testid="material-panel">
      <h2 className="material__title">Material kutubxonasi</h2>

      <p className="material__active" data-testid="material-current">
        Joriy material: <strong>{activeEntry?.label ?? 'Standart'}</strong>
        {activeEntry ? (
          <span className="material__chip">{MATERIAL_CATEGORY_LABELS[activeEntry.category]}</span>
        ) : null}
      </p>

      <h3 className="material__subtitle">Asosiy</h3>

      <div className="field">
        <label className="field__label" htmlFor="material-base-color">
          Base Color (albedo)
        </label>
        <input
          id="material-base-color"
          className="field__input material__color"
          type="color"
          value={object.material.baseColor ?? object.params.color}
          onChange={(event) =>
            onBaseColor
              ? onBaseColor(event.target.value)
              : onMaterial({ baseColor: event.target.value })
          }
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="material-search">
          Qidirish
        </label>
        <input
          id="material-search"
          className="field__input"
          type="search"
          value={query}
          placeholder="Nom bo'yicha, masalan: yong'oq"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="material-categories" role="group" aria-label="Material kategoriyalari">
        {CATEGORY_OPTIONS.map((option) => {
          const active = category === option.id;
          return (
            <button
              key={option.id}
              type="button"
              className={`material-category${active ? ' material-category--active' : ''}`}
              aria-pressed={active}
              onClick={() => setCategory(option.id)}
            >
              {option.label}
              <span className="material-category__count">{option.count}</span>
            </button>
          );
        })}
      </div>

      <p className="material-library__count" data-testid="material-result-count">
        {entries.length} material
      </p>

      {entries.length === 0 ? (
        <p className="material__empty" data-testid="material-no-results">
          Hech narsa topilmadi. Qidiruvni o&apos;zgartiring yoki boshqa kategoriyani tanlang.
        </p>
      ) : (
        <div className="material-grid" data-testid="material-grid">
          {entries.map((entry) => {
            const active = activeEntry?.id === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                className={`material-card${active ? ' material-card--active' : ''}`}
                aria-pressed={active}
                data-material-id={entry.id}
                data-testid={`material-card-${entry.id}`}
                title={`${entry.label} — ${MATERIAL_CATEGORY_LABELS[entry.category]}`}
                onClick={() => onApplyPreset(entry.id)}
              >
                <span
                  className="material-card__swatch"
                  style={{ backgroundColor: entry.previewColor }}
                  aria-hidden="true"
                />
                <span className="material-card__text">
                  <span className="material-card__label">{entry.label}</span>
                  <span className="material-card__meta">
                    {MATERIAL_CATEGORY_LABELS[entry.category]} ·{' '}
                    {entry.detail === 'procedural' ? 'protsedural' : 'teksturasiz'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <h3 className="material__subtitle">Advanced</h3>

      <div className="field">
        <label className="field__label" htmlFor="material-emissive-color">
          Emissive rang
        </label>
        <input
          id="material-emissive-color"
          className="field__input material__color"
          type="color"
          value={object.material.emissiveColor ?? '#ffffff'}
          onChange={(event) => onMaterial({ emissiveColor: event.target.value })}
        />
      </div>

      <TexturePicker
        objectId={object.id}
        currentRef={object.material.maps?.baseColor ?? null}
        onApply={(ref) => onMaterialMap('baseColor', ref)}
        onRemove={() => onMaterialMap('baseColor', null)}
        backendConfigured={textureBackendConfigured}
      />

      <TextureMapsPicker
        objectId={object.id}
        maps={object.material.maps}
        onMapChange={onMaterialMap}
        backendConfigured={textureBackendConfigured}
      />

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
        label="Normal karta kuchi (normalScale)"
        range={PBR_LIMITS.normalStrength}
        value={resolved.normalStrength}
        onChange={(value) => onMaterial({ normalStrength: value })}
      />
      <MaterialSlider
        id="material-ao-intensity"
        label="AO kuchi"
        range={PBR_LIMITS.aoIntensity}
        value={resolved.aoIntensity}
        onChange={(value) => onMaterial({ aoIntensity: value })}
      />
      <MaterialSlider
        id="material-emissive-intensity"
        label="Emissive kuchi"
        range={PBR_LIMITS.emissiveIntensity}
        value={resolved.emissiveIntensity}
        onChange={(value) => onMaterial({ emissiveIntensity: value })}
      />

      <button type="button" className="visual-reset" onClick={onReset}>
        Materialni tiklash
      </button>

      <p className="visual__hint">
        Asosiy rang (albedo) — «Mebel parametrlari» bo&apos;limidagi rang boshqaruvi orqali.
        Protsedural materiallar lokal generatsiya qilinadi; yuklangan PNG, JPEG yoki WebP
        teksturalar serverda saqlanadi va faqat havola (id + versiya) sifatida saqlanadi.
        Materialni tiklash barcha biriktirilgan kartalarni olib tashlaydi.
      </p>
    </section>
  );
}
