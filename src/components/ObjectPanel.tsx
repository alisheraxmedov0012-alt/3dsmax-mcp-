import { useState } from 'react';
import { OBJECT_LIMITS, type SceneObject, type Vec3 } from '../scene/types';

interface ObjectPanelProps {
  object: SceneObject | null;
  onTransform: (patch: {
    position?: Partial<Vec3>;
    rotation?: Partial<Vec3>;
    scale?: Partial<Vec3>;
  }) => void;
  onRename: (name: string) => void;
  onToggleVisibility: () => void;
  onDelete: () => void;
  onPlaceAgainstWall: () => void;
}

type Group = 'position' | 'rotation' | 'scale';
type Axis = 'x' | 'y' | 'z';
type Path = `${Group}.${Axis}`;

const AXES: Axis[] = ['x', 'y', 'z'];

const GROUPS: ReadonlyArray<{ group: Group; label: string; range: { min: number; max: number; step: number }; unit: string }> = [
  { group: 'position', label: 'Joylashuv', range: OBJECT_LIMITS.position, unit: 'sm' },
  { group: 'rotation', label: 'Burilish', range: OBJECT_LIMITS.rotation, unit: '°' },
  { group: 'scale', label: 'Masshtab', range: OBJECT_LIMITS.scale, unit: '×' },
];

function collectDrafts(object: SceneObject): Record<Path, string> {
  const drafts = {} as Record<Path, string>;
  GROUPS.forEach(({ group }) => {
    AXES.forEach((axis) => {
      drafts[`${group}.${axis}`] = String(object[group][axis]);
    });
  });
  return drafts;
}

function parseDraft(raw: string, range: { min: number; max: number }): number | 'invalid' {
  const trimmed = raw.trim();
  if (trimmed === '') return 'invalid';
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return 'invalid';
  if (value < range.min || value > range.max) return 'invalid';
  return value;
}

export function ObjectPanel({
  object,
  onTransform,
  onRename,
  onToggleVisibility,
  onDelete,
  onPlaceAgainstWall,
}: ObjectPanelProps) {
  const [drafts, setDrafts] = useState<Record<Path, string> | null>(() =>
    object ? collectDrafts(object) : null,
  );
  const [invalid, setInvalid] = useState<Partial<Record<Path, boolean>>>({});
  const [nameDraft, setNameDraft] = useState(object?.name ?? '');
  const [lastObject, setLastObject] = useState<SceneObject | null>(object);

  // Adjust derived state during render when the selected object changes (the
  // React-recommended pattern) instead of using an effect.
  if (object !== lastObject) {
    setLastObject(object);
    if (object) {
      setDrafts(collectDrafts(object));
      setNameDraft(object.name);
      setInvalid({});
    } else {
      setDrafts(null);
    }
  }

  if (!object || !drafts) {
    return (
      <section className="object">
        <h2 className="object__title">Obyekt</h2>
        <p className="object__empty">Obyekt tanlanmagan. Ro'yxatdan yoki 3D ko'rinishdan tanlang.</p>
      </section>
    );
  }

  const commit = (path: Path, raw: string, range: { min: number; max: number }) => {
    const parsed = parseDraft(raw, range);
    if (parsed === 'invalid') {
      setInvalid((prev) => ({ ...prev, [path]: true }));
      return;
    }
    setInvalid((prev) => ({ ...prev, [path]: false }));
    const [group, axis] = path.split('.') as [Group, Axis];
    onTransform({ [group]: { [axis]: parsed } });
  };

  return (
    <section className="object">
      <h2 className="object__title">Obyekt</h2>
      <p className="object__id">
        Turi: stol · ID: <code>{object.id.slice(0, 8)}</code>
      </p>

      <div className="field">
        <label className="field__label" htmlFor="object-name">
          Nomi
        </label>
        <input
          id="object-name"
          className="field__input"
          type="text"
          value={nameDraft}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={(event) => onRename(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onRename((event.target as HTMLInputElement).value);
          }}
        />
      </div>

      {GROUPS.map(({ group, label, range, unit }) => (
        <div className="object__group" key={group}>
          <span className="field__label">
            {label}
            <span className="field__range">
              {range.min}–{range.max} {unit}
            </span>
          </span>
          {AXES.map((axis) => {
            const path: Path = `${group}.${axis}`;
            return (
              <div className="axis" key={path}>
                <span className="axis__label">{axis.toUpperCase()}</span>
                <input
                  type="range"
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  value={Number(drafts[path]) || range.min}
                  aria-label={`${label} ${axis} slayder`}
                  onChange={(event) => {
                    setDrafts((prev) => (prev ? { ...prev, [path]: event.target.value } : prev));
                    const parsed = parseDraft(event.target.value, range);
                    if (parsed !== 'invalid') {
                      const [g, a] = path.split('.') as [Group, Axis];
                      onTransform({ [g]: { [a]: parsed } });
                    }
                  }}
                />
                <input
                  className={invalid[path] ? 'field__input field__input--error' : 'field__input'}
                  type="number"
                  inputMode="decimal"
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  value={drafts[path]}
                  aria-label={`${label} ${axis}`}
                  aria-invalid={Boolean(invalid[path])}
                  onChange={(event) =>
                    setDrafts((prev) => (prev ? { ...prev, [path]: event.target.value } : prev))
                  }
                  onBlur={(event) => commit(path, event.target.value, range)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commit(path, (event.target as HTMLInputElement).value, range);
                  }}
                />
              </div>
            );
          })}
        </div>
      ))}

      <div className="object__actions">
        <button type="button" className="visual-reset" onClick={onPlaceAgainstWall}>
          Devorga joylash
        </button>
        <button type="button" className="object__visibility" onClick={onToggleVisibility}>
          {object.visible ? 'Yashirish' : "Ko'rsatish"}
        </button>
        <button type="button" className="object__delete" onClick={onDelete}>
          O'chirish
        </button>
      </div>
    </section>
  );
}
