/**
 * C3.1 — assign a manufacturing material to one part.
 *
 * Deliberately separate from `MaterialPanel`, which edits `object.material` (the
 * PBR *appearance* of the whole piece). This panel edits `object.sheetMaterials`:
 * which board each part is cut from and the nominal thickness bought for it. The
 * two never touch each other.
 *
 * The part list is the BOM, so a user can only assign to a part the current model
 * actually generates, and the id shown is the same stable `partId` the BOM, cut
 * list, validation and PDF already use. An assignment whose part no longer exists
 * is listed rather than hidden, so it can be removed instead of lingering.
 *
 * There are no effects here on purpose: the displayed draft is *derived* from the
 * stored assignment plus the current selection, so it can never lag behind a
 * state update or fight one.
 */
import { useState, type FormEvent } from 'react';
import {
  SHEET_MATERIALS,
  SHEET_THICKNESS_LIMITS,
  validateSheetThickness,
  type SheetMaterialId,
} from '../manufacturing/sheetMaterial';
import type { SceneObject } from '../scene/types';

export interface SheetMaterialPart {
  /** Stable id from the BOM, e.g. `wardrobe-door`. */
  partId: string;
  /** Human-readable name, e.g. "Eshik". */
  name: string;
}

interface SheetMaterialPanelProps {
  object: SceneObject | null;
  /** Parts the current model generates, in BOM order. */
  parts: SheetMaterialPart[];
  onAssign: (partId: string, materialId: SheetMaterialId, thicknessMm: number) => void;
  onRemove: (partId: string) => void;
}

/** A staged edit, tagged with the part it belongs to so it can be discarded. */
interface Draft {
  forPart: string;
  materialId: SheetMaterialId | '';
  thickness: string;
}

const EMPTY_DRAFT: Draft = { forPart: '', materialId: '', thickness: '' };

function materialName(id: string): string {
  return SHEET_MATERIALS.find((entry) => entry.id === id)?.name ?? id;
}

export function SheetMaterialPanel({ object, parts, onAssign, onRemove }: SheetMaterialPanelProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (!object) {
    return null;
  }

  if (parts.length === 0) {
    return (
      <div className="field" data-testid="sheet-material">
        <span className="field__label">Ishlab chiqarish materiali</span>
        <p className="visual__hint">
          Bu mebel uchun detal topilmadi — material biriktirish uchun detal kerak.
        </p>
      </div>
    );
  }

  const assignments = object.sheetMaterials ?? [];
  // Derive the effective selection: a part that still exists, else the first one.
  const partId = selected !== null && parts.some((part) => part.partId === selected)
    ? selected
    : parts[0].partId;
  const current = assignments.find((entry) => entry.partId === partId);
  const stale = assignments.filter((entry) => !parts.some((part) => part.partId === entry.partId));
  const assignedIds = new Set(assignments.map((entry) => entry.partId));

  // A draft only applies to the part it was started for; otherwise the stored
  // values show through. This is why selecting another part discards the edit.
  const active = draft.forPart === partId ? draft : null;
  const materialValue = active ? active.materialId : (current?.materialId ?? '');
  const thicknessValue = active ? active.thickness : current ? String(current.thicknessMm) : '';

  const edit = (patch: Partial<Omit<Draft, 'forPart'>>) => {
    setDraft({ forPart: partId, materialId: materialValue, thickness: thicknessValue, ...patch });
    setError('');
    setNotice('');
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setNotice('');

    if (materialValue === '') {
      setError('Material tanlanmagan.');
      return;
    }
    if (thicknessValue.trim() === '') {
      // No default is applied on purpose: the thickness is the user's fact, not
      // something to infer from the material name.
      setError('Qalinlikni kiriting (mm).');
      return;
    }
    const parsed = Number(thicknessValue.trim());
    const check = validateSheetThickness(parsed);
    if (!check.ok) {
      setError(check.reason);
      return;
    }

    onAssign(partId, materialValue, check.thicknessMm);
    setDraft(EMPTY_DRAFT);
    setError('');
    setNotice(`${parts.find((part) => part.partId === partId)?.name ?? partId}: material saqlandi.`);
  };

  const handleCancel = () => {
    setDraft(EMPTY_DRAFT);
    setError('');
    setNotice('');
  };

  const handleRemove = () => {
    onRemove(partId);
    setDraft(EMPTY_DRAFT);
    setError('');
    setNotice(
      `${parts.find((part) => part.partId === partId)?.name ?? partId}: material olib tashlandi.`,
    );
  };

  return (
    <div className="field" data-testid="sheet-material">
      <span className="field__label">Ishlab chiqarish materiali (detal bo‘yicha)</span>
      <p className="visual__hint">
        Ko‘rinish (PBR) materialidan alohida: bu detal qaysi taxtadan kesilishi va nominal
        qalinligi. Nominal qalinlik model geometriyasini avtomatik o‘zgartirmaydi; geometriya
        qalinligi mebel parametrlarida alohida beriladi. Ikkalasi mos kelmasa, tekshiruv
        ogohlantiradi va tayyorlikni bloklaydi.
      </p>

      {/* noValidate: the browser's own constraint bubble would replace the
          app's message and differ between browsers. min/max/step stay on the
          input for steppers and mobile keyboards; validateSheetThickness is the
          single authority on whether a value is acceptable. */}
      <form className="sheet-material" onSubmit={handleSubmit} noValidate>
        <label className="field__label" htmlFor="sheet-material-part">
          Detal
        </label>
        <select
          id="sheet-material-part"
          className="field__input"
          value={partId}
          onChange={(event) => {
            setSelected(event.target.value);
            setDraft(EMPTY_DRAFT);
            setError('');
            setNotice('');
          }}
        >
          {parts.map((part) => (
            <option key={part.partId} value={part.partId}>
              {part.name} — {part.partId}
              {assignedIds.has(part.partId) ? ' (material bor)' : ''}
            </option>
          ))}
        </select>

        <p className="visual__hint" data-testid="sheet-material-current">
          {current
            ? `Joriy: ${materialName(current.materialId)}, nominal ${current.thicknessMm} mm.`
            : 'Joriy: material biriktirilmagan.'}
        </p>

        <label className="field__label" htmlFor="sheet-material-type">
          Material
        </label>
        <select
          id="sheet-material-type"
          className="field__input"
          value={materialValue}
          onChange={(event) => edit({ materialId: event.target.value as SheetMaterialId | '' })}
        >
          <option value="">— tanlang —</option>
          {SHEET_MATERIALS.map((material) => (
            <option key={material.id} value={material.id}>
              {material.name}
            </option>
          ))}
        </select>

        <label className="field__label" htmlFor="sheet-material-thickness">
          Nominal qalinlik (mm)
        </label>
        <input
          id="sheet-material-thickness"
          className={error ? 'field__input field__input--error' : 'field__input'}
          type="number"
          inputMode="decimal"
          min={0}
          max={SHEET_THICKNESS_LIMITS.maxInclusiveMm}
          step="0.5"
          value={thicknessValue}
          onChange={(event) => edit({ thickness: event.target.value })}
          aria-describedby="sheet-material-thickness-hint"
          aria-invalid={error !== ''}
        />
        <p className="visual__hint" id="sheet-material-thickness-hint">
          {`0 dan ${SHEET_THICKNESS_LIMITS.maxInclusiveMm} mm gacha. Geometriyadan o‘lchangan qalinlik o‘zgarmaydi.`}
        </p>

        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="render__message" role="status" aria-live="polite">
            {notice}
          </p>
        )}

        <div className="preset-grid">
          <button type="submit" className="visual-reset">
            {current ? 'Yangilash' : 'Saqlash'}
          </button>
          <button type="button" className="visual-reset" onClick={handleCancel}>
            Bekor qilish
          </button>
          <button type="button" className="visual-reset" onClick={handleRemove} disabled={!current}>
            Olib tashlash
          </button>
        </div>
      </form>

      {stale.length > 0 && (
        <div className="field" data-testid="sheet-material-stale">
          <p className="field__error" role="alert">
            Modelda topilmagan detallarga material biriktirilgan:{' '}
            {stale.map((entry) => entry.partId).join(', ')}. Parametr o‘zgargan bo‘lishi mumkin —
            ularni olib tashlang.
          </p>
          {stale.map((entry) => (
            <button
              key={entry.partId}
              type="button"
              className="visual-reset"
              onClick={() => onRemove(entry.partId)}
            >
              {entry.partId} — olib tashlash
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
