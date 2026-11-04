import { useMemo, useState } from 'react';
import { FURNITURE_TYPE_LABELS } from '../geometry/furniture/types';
import {
  getFurnitureParameters,
  updateFurnitureSpec,
  type FurnitureParameterInfo,
  type FurnitureParameterSet,
} from '../scene/configurator';
import {
  applyDesignPreset,
  findMatchingPreset,
  getDesignPresets,
} from '../scene/configurator/presets';
import type { SceneObject, SceneSpec, SceneSpecValue } from '../scene/types';

interface ConfiguratorPanelProps {
  object: SceneObject | null;
  /** Receives the validated canonical spec; the caller dispatches UPDATE_SPEC. */
  onApplySpec: (spec: SceneSpec) => void;
}

interface ConfiguratorFormProps {
  objectId: string;
  definitionId: string;
  spec: SceneSpec;
  onApplySpec: (spec: SceneSpec) => void;
}

function createDrafts(
  parameters: FurnitureParameterSet,
  spec: SceneSpec,
): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const parameter of parameters.parameters) {
    const value = spec[parameter.key] ?? parameter.defaultValue ?? '';
    drafts[parameter.key] = String(value);
  }
  return drafts;
}

function withoutKey(record: Record<string, string>, key: string): Record<string, string> {
  const next = { ...record };
  delete next[key];
  return next;
}

function numberError(parameter: FurnitureParameterInfo, raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return 'Qiymat kiriting.';
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return 'Son kiriting.';
  }
  if (parameter.integer && !Number.isInteger(value)) {
    return 'Butun son kiriting.';
  }
  if (parameter.range && (value < parameter.range.min || value > parameter.range.max)) {
    return `Qiymat ${parameter.range.min}–${parameter.range.max} oralig‘ida bo‘lishi kerak.`;
  }
  return null;
}

/**
 * Stage 3.2 — universal furniture configurator.
 *
 * The panel never builds geometry: every edit goes through
 * `updateFurnitureSpec()` (parse + solve + plan validation) and only the returned
 * canonical spec is handed to the caller. A rejected edit leaves the scene
 * untouched and shows the parser's message next to the field, so the last valid
 * model stays on screen.
 */
export function ConfiguratorPanel({ object, onApplySpec }: ConfiguratorPanelProps) {
  if (!object || object.definitionId === undefined || object.spec === undefined) {
    return null;
  }

  return (
    <ConfiguratorForm
      key={`${object.id}:${object.definitionId}`}
      objectId={object.id}
      definitionId={object.definitionId}
      spec={object.spec}
      onApplySpec={onApplySpec}
    />
  );
}

function ConfiguratorForm({
  objectId,
  definitionId,
  spec,
  onApplySpec,
}: ConfiguratorFormProps) {
  const parameters = useMemo(() => getFurnitureParameters(definitionId), [definitionId]);
  const presets = useMemo(() => getDesignPresets(definitionId), [definitionId]);
  const activePreset = useMemo(() => findMatchingPreset(definitionId, spec), [definitionId, spec]);

  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    parameters ? createDrafts(parameters, spec) : {},
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [presetError, setPresetError] = useState<string | null>(null);
  const [lastSpec, setLastSpec] = useState<SceneSpec>(spec);

  // A committed edit or an applied preset comes back as a new spec, so the inputs
  // follow it. React's "adjust state during render" pattern keeps this free of an
  // extra effect pass.
  if (spec !== lastSpec) {
    setLastSpec(spec);
    setDrafts(parameters ? createDrafts(parameters, spec) : {});
    setErrors({});
  }

  if (!parameters) {
    return null;
  }

  const inputId = (key: string) => `spec-${objectId}-${key}`;

  const applyPatch = (patch: Readonly<Record<string, SceneSpecValue>>, key: string) => {
    if (spec[key] === patch[key]) {
      setErrors((previous) => withoutKey(previous, key));
      return;
    }

    const result = updateFurnitureSpec(definitionId, spec, patch);
    if (!result.ok) {
      const issue =
        result.issues.find((entry) => entry.keys?.includes(key)) ?? result.issues[0];
      setErrors((previous) => ({
        ...previous,
        [key]: issue?.message ?? 'Qiymat qabul qilinmadi.',
      }));
      return;
    }

    setErrors((previous) => withoutKey(previous, key));
    onApplySpec(result.spec);
  };

  const commitNumber = (parameter: FurnitureParameterInfo, raw: string) => {
    const message = numberError(parameter, raw);
    if (message) {
      setErrors((previous) => ({ ...previous, [parameter.key]: message }));
      return;
    }
    applyPatch({ [parameter.key]: Number(raw.trim()) }, parameter.key);
  };

  const commitText = (parameter: FurnitureParameterInfo, raw: string) => {
    applyPatch({ [parameter.key]: raw }, parameter.key);
  };

  const applyPreset = (presetId: string) => {
    const result = applyDesignPreset(definitionId, presetId);
    if (!result.ok) {
      setPresetError(result.issues[0]?.message ?? 'Preset qo‘llanmadi.');
      return;
    }
    setPresetError(null);
    onApplySpec(result.spec);
  };

  const numeric = parameters.parameters.filter((parameter) => parameter.kind === 'number');
  const text = parameters.parameters.filter((parameter) => parameter.kind === 'string');
  const toggles = parameters.parameters.filter((parameter) => parameter.kind === 'boolean');

  const renderNumber = (parameter: FurnitureParameterInfo) => {
    const error = errors[parameter.key];
    return (
      <div className="field configurator__field" key={parameter.key}>
        <label className="field__label" htmlFor={inputId(parameter.key)}>
          {parameter.label}
          {parameter.range ? (
            <span className="field__range">
              {parameter.range.min}–{parameter.range.max}
            </span>
          ) : null}
        </label>
        <input
          id={inputId(parameter.key)}
          className={error ? 'field__input field__input--error' : 'field__input'}
          type="number"
          inputMode={parameter.integer ? 'numeric' : 'decimal'}
          step={parameter.range?.step ?? (parameter.integer ? 1 : 'any')}
          {...(parameter.range
            ? { min: parameter.range.min, max: parameter.range.max }
            : {})}
          value={drafts[parameter.key] ?? ''}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId(parameter.key)}-error` : undefined}
          onChange={(event) => {
            const value = event.target.value;
            setDrafts((previous) => ({ ...previous, [parameter.key]: value }));
          }}
          onBlur={(event) => commitNumber(parameter, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitNumber(parameter, (event.target as HTMLInputElement).value);
            }
          }}
        />
        {parameter.hint ? <p className="configurator__hint">{parameter.hint}</p> : null}
        {error ? (
          <p className="field__error" id={`${inputId(parameter.key)}-error`} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  };

  const renderText = (parameter: FurnitureParameterInfo) => {
    const error = errors[parameter.key];
    return (
      <div className="field configurator__field" key={parameter.key}>
        <label className="field__label" htmlFor={inputId(parameter.key)}>
          {parameter.label}
        </label>
        <input
          id={inputId(parameter.key)}
          className={error ? 'field__input field__input--error' : 'field__input'}
          type="text"
          value={drafts[parameter.key] ?? ''}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId(parameter.key)}-error` : undefined}
          onChange={(event) => {
            const value = event.target.value;
            setDrafts((previous) => ({ ...previous, [parameter.key]: value }));
          }}
          onBlur={(event) => commitText(parameter, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitText(parameter, (event.target as HTMLInputElement).value);
            }
          }}
        />
        {error ? (
          <p className="field__error" id={`${inputId(parameter.key)}-error`} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <section className="configurator" aria-labelledby="configurator-title">
      <h2 className="configurator__title" id="configurator-title">
        Konfigurator
      </h2>
      <p className="configurator__meta">
        {parameters.label} · {FURNITURE_TYPE_LABELS[parameters.family]} ·{' '}
        {parameters.parameters.length} parametr
      </p>

      <div className="configurator__presets" role="group" aria-label="Dizayn presetlari">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={
              activePreset?.id === preset.id
                ? 'configurator__preset configurator__preset--active'
                : 'configurator__preset'
            }
            aria-pressed={activePreset?.id === preset.id}
            onClick={() => applyPreset(preset.id)}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          className={
            activePreset
              ? 'configurator__preset'
              : 'configurator__preset configurator__preset--active'
          }
          aria-pressed={activePreset === null}
          onClick={() => setPresetError(null)}
        >
          Custom
        </button>
      </div>
      {presetError ? (
        <p className="field__error" role="alert">
          {presetError}
        </p>
      ) : null}

      <div className="configurator__grid">
        {numeric.map(renderNumber)}
        {text.map(renderText)}
      </div>

      {toggles.length > 0 ? (
        <fieldset className="configurator__toggles">
          <legend className="field__label">Variantlar</legend>
          {toggles.map((parameter) => (
            <label className="configurator__toggle" key={parameter.key}>
              <input
                type="checkbox"
                checked={Boolean(spec[parameter.key])}
                onChange={(event) =>
                  applyPatch({ [parameter.key]: event.target.checked }, parameter.key)
                }
              />
              <span>{parameter.label}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
    </section>
  );
}
