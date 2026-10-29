import { useState, type FormEvent } from 'react';
import type { AssemblyStep } from '../manufacturing/assemblyInstructions';
import {
  buildHardwareBom,
  validateHardwareSteps,
  type HardwareItem,
  type HardwareKind,
  type HardwareUnit,
} from '../manufacturing/hardware';

const KIND_LABELS: Record<HardwareKind, string> = {
  screw: 'Vint / konfirmat',
  bolt: 'Murvat',
  dowel: 'Dowel / shponka',
  nail: 'Mix',
  glue: 'Yelim',
  bracket: "Kronshteyn / burchak",
  other: 'Boshqa',
  unspecified: "Ko'rsatilmagan",
};

const UNITS: HardwareUnit[] = ['pcs', 'set', 'ml', 'g'];

const NO_HARDWARE: readonly HardwareItem[] = [];

interface Draft {
  kind: HardwareKind;
  name: string;
  size: string;
  quantity: string;
  unit: HardwareUnit;
  note: string;
  stepIds: string[];
}

const EMPTY_DRAFT: Draft = {
  kind: 'screw',
  name: '',
  size: '',
  quantity: '',
  unit: 'pcs',
  note: '',
  stepIds: [],
};

interface HardwarePanelProps {
  hardware?: readonly HardwareItem[];
  steps: readonly AssemblyStep[];
  onChange: (hardware: HardwareItem[]) => void;
}

/**
 * C6 hardware editor.
 *
 * The form only records facts the user types. Quantity is explicitly a user
 * value, never an automatic calculation, and step links are references so a
 * shared item is counted once in the total.
 */
export function HardwarePanel({ hardware = NO_HARDWARE, steps, onChange }: HardwarePanelProps) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [error, setError] = useState('');
  const items = [...hardware];

  const updateDraft = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError('');
  };

  const toggleStep = (stepId: string) => {
    updateDraft({
      stepIds: draft.stepIds.includes(stepId)
        ? draft.stepIds.filter((id) => id !== stepId)
        : [...draft.stepIds, stepId],
    });
  };

  const resetForm = () => {
    setDraft(EMPTY_DRAFT);
    setEditingIndex(null);
    setError('');
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const name = draft.name.trim();
    if (name === '') {
      setError('Furnitura nomini kiriting.');
      return;
    }
    const quantityText = draft.quantity.trim();
    let quantity: number | null = null;
    let unit: HardwareUnit | null = null;
    if (quantityText !== '') {
      const parsed = Number(quantityText);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setError("Miqdor musbat son bo'lishi kerak (yoki bo'sh qoldiring).");
        return;
      }
      quantity = parsed;
      unit = draft.unit;
    }

    const item: HardwareItem = {
      kind: draft.kind,
      name,
      quantity,
      unit,
      size: draft.size.trim() === '' ? null : draft.size.trim(),
      note: draft.note.trim() === '' ? null : draft.note.trim(),
      stepIds: draft.stepIds,
    };
    const next = editingIndex === null ? [...items, item] : items.map((entry, index) => (index === editingIndex ? item : entry));
    const result = buildHardwareBom(next);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    const stepErrors = validateHardwareSteps(result.hardware, steps);
    if (stepErrors.length > 0) {
      setError(stepErrors.join(' '));
      return;
    }
    onChange(result.hardware.specified ? result.hardware.items : []);
    resetForm();
  };

  const startEdit = (index: number) => {
    const item = items[index];
    setEditingIndex(index);
    setDraft({
      kind: item.kind,
      name: item.name,
      size: item.size ?? '',
      quantity: item.quantity === null ? '' : String(item.quantity),
      unit: item.unit ?? 'pcs',
      note: item.note ?? '',
      stepIds: item.stepIds ?? [],
    });
    setError('');
  };

  const remove = (index: number) => {
    const next = items.filter((_, itemIndex) => itemIndex !== index);
    onChange(next);
    if (editingIndex === index) {
      resetForm();
    }
  };

  return (
    <section className="field" data-testid="hardware-panel">
      <span className="field__label">Mahkamlagichlar va furnitura</span>
      <p className="visual__hint">
        Miqdor — siz kiritgan qiymat, avtomatik hisob emas. Tur, o‘lcham va standart
        modeldan olinmaydi; ma’lumot bo‘lmasa “ko‘rsatilmagan” holati saqlanadi.
      </p>

      {items.length === 0 ? (
        <p className="visual__hint" data-testid="hardware-empty">
          Furnitura kiritilmagan — paketda “ko‘rsatilmagan” deb yoziladi.
        </p>
      ) : (
        <ul className="image-ref__notes" data-testid="hardware-list">
          {items.map((item, index) => {
            const linkedIds = item.stepIds ?? [];
            const stepLabels = linkedIds
              .map((id) => steps.find((step) => step.id === id))
              .filter((step): step is AssemblyStep => Boolean(step))
              .map((step) => `${step.order}. ${step.title}`);
            const unknownSteps = linkedIds.filter(
              (id) => !steps.some((step) => step.id === id),
            );
            return (
              <li key={`${item.kind}-${item.name}-${index}`} data-testid={`hardware-item-${index}`}>
                {item.name} · {KIND_LABELS[item.kind]}
                {item.size ? ` · ${item.size}` : ''} ·{' '}
                {item.quantity === null ? "miqdor ko'rsatilmagan" : `${item.quantity} ${item.unit}`}
                {stepLabels.length > 0 ? ` · qadamlar: ${stepLabels.join(', ')}` : ''}
                {unknownSteps.length > 0
                  ? ` · noma'lum qadam: ${unknownSteps.join(', ')} — qayta bog‘lang`
                  : ''}
                {item.note ? ` · ${item.note}` : ''}
                <button type="button" className="visual-reset" onClick={() => startEdit(index)}>
                  Tahrirlash
                </button>
                <button type="button" className="visual-reset" onClick={() => remove(index)}>
                  O‘chirish
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <form className="sheet-material" onSubmit={handleSubmit} noValidate>
        <label className="field__label" htmlFor="hardware-kind">
          Furnitura turi
        </label>
        <select
          id="hardware-kind"
          className="field__input"
          value={draft.kind}
          onChange={(event) => updateDraft({ kind: event.target.value as HardwareKind })}
        >
          {Object.entries(KIND_LABELS)
            .filter(([kind]) => kind !== 'unspecified')
            .map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
        </select>

        <label className="field__label" htmlFor="hardware-name">
          Nomi
        </label>
        <input
          id="hardware-name"
          className="field__input"
          value={draft.name}
          onChange={(event) => updateDraft({ name: event.target.value })}
          placeholder="Masalan: 4×40 konfirmat"
        />

        <label className="field__label" htmlFor="hardware-size">
          O‘lcham / model (ixtiyoriy)
        </label>
        <input
          id="hardware-size"
          className="field__input"
          value={draft.size}
          onChange={(event) => updateDraft({ size: event.target.value })}
          placeholder="Siz kiritgan qiymat"
        />

        <label className="field__label" htmlFor="hardware-quantity">
          Miqdor (ixtiyoriy)
        </label>
        <input
          id="hardware-quantity"
          className="field__input"
          type="number"
          min="0"
          step="any"
          value={draft.quantity}
          onChange={(event) => updateDraft({ quantity: event.target.value })}
          placeholder="Bo‘sh = ko‘rsatilmagan"
        />

        <label className="field__label" htmlFor="hardware-unit">
          Birlik
        </label>
        <select
          id="hardware-unit"
          className="field__input"
          value={draft.unit}
          disabled={draft.quantity.trim() === ''}
          onChange={(event) => updateDraft({ unit: event.target.value as HardwareUnit })}
        >
          {UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>

        <label className="field__label" htmlFor="hardware-note">
          Izoh (ixtiyoriy)
        </label>
        <input
          id="hardware-note"
          className="field__input"
          value={draft.note}
          onChange={(event) => updateDraft({ note: event.target.value })}
        />

        <span className="field__label">Montaj qadamiga bog‘lash</span>
        {steps.length === 0 ? (
          <p className="visual__hint">
            Montaj rejasi hali yo‘q. Qadamga bog‘lash uchun avval montaj rejasini yarating.
          </p>
        ) : (
          <ul className="image-ref__notes" data-testid="hardware-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={draft.stepIds.includes(step.id)}
                    onChange={() => toggleStep(step.id)}
                    aria-label={`${step.order}. ${step.title} qadamiga bog'lash`}
                  />{' '}
                  {step.order}. {step.title}
                </label>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="field__error" role="alert" data-testid="hardware-error">
            {error}
          </p>
        )}

        <button type="submit" className="visual-reset" data-testid="hardware-save">
          {editingIndex === null ? 'Furnitura qo‘shish' : 'O‘zgarishni saqlash'}
        </button>
        {editingIndex !== null && (
          <button type="button" className="visual-reset" onClick={resetForm}>
            Bekor qilish
          </button>
        )}
      </form>
    </section>
  );
}
