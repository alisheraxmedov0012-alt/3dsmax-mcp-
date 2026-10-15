import { useState } from 'react';
import {
  LAYOUT_PRESETS,
  LAYOUT_PRESET_LABELS,
  type LayoutPresetId,
} from '../scene/layoutPresets';
import { WALL_LABELS, type WallId } from '../scene/placement';
import {
  ROOM_LIMITS,
  type OpeningKind,
  type RoomConfig,
  type RoomOpening,
} from '../scene/types';

type RoomDimension = 'widthCm' | 'lengthCm' | 'heightCm';
type RoomErrors = Partial<Record<RoomDimension, string>>;

interface RoomPanelProps {
  room: RoomConfig;
  isRoomSelected: boolean;
  layoutPreset: LayoutPresetId;
  onApply: (room: Partial<RoomConfig>) => void;
  onResetRoom: () => void;
  onSelectRoom: () => void;
  onToggleCeiling: (show: boolean) => void;
  onLayoutPresetChange: (preset: LayoutPresetId) => void;
  onApplyLayout: () => void;
  onAddOpening: (kind: OpeningKind, wall: WallId) => void;
  onRemoveOpening: (id: string) => void;
}

const FIELDS: ReadonlyArray<{ key: RoomDimension; label: string }> = [
  { key: 'widthCm', label: 'Xona kengligi (sm)' },
  { key: 'lengthCm', label: 'Xona uzunligi (sm)' },
  { key: 'heightCm', label: 'Xona balandligi (sm)' },
];

const WALLS: readonly WallId[] = ['north', 'east', 'south', 'west'];

const OPENING_LABELS: Record<OpeningKind, string> = { door: 'Eshik', window: 'Deraza' };

function toDraft(room: RoomConfig): Record<RoomDimension, string> {
  return {
    widthCm: String(room.widthCm),
    lengthCm: String(room.lengthCm),
    heightCm: String(room.heightCm),
  };
}

export function RoomPanel({
  room,
  isRoomSelected,
  layoutPreset,
  onApply,
  onResetRoom,
  onSelectRoom,
  onToggleCeiling,
  onLayoutPresetChange,
  onApplyLayout,
  onAddOpening,
  onRemoveOpening,
}: RoomPanelProps) {
  const [drafts, setDrafts] = useState(() => toDraft(room));
  const [lastRoom, setLastRoom] = useState(room);
  const [errors, setErrors] = useState<RoomErrors>({});
  const [openingWall, setOpeningWall] = useState<WallId>('north');

  // Re-sync the text inputs when the room changes externally (slider, reset, or
  // loading a saved project). Adjusting state during render (rather than in an
  // effect) is the React-recommended pattern for derived-from-props state.
  if (room !== lastRoom) {
    if (
      room.widthCm !== lastRoom.widthCm ||
      room.lengthCm !== lastRoom.lengthCm ||
      room.heightCm !== lastRoom.heightCm
    ) {
      setDrafts(toDraft(room));
    }
    setLastRoom(room);
  }

  const commit = (key: RoomDimension, raw: string) => {
    const range = ROOM_LIMITS[key];
    const trimmed = raw.trim();

    if (trimmed === '') {
      setErrors((prev) => ({ ...prev, [key]: 'Qiymat kiritilishi shart.' }));
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      setErrors((prev) => ({ ...prev, [key]: 'Faqat son kiriting.' }));
      return;
    }
    if (value < range.min || value > range.max) {
      setErrors((prev) => ({
        ...prev,
        [key]: `${range.min}–${range.max} sm oralig'ida bo'lishi kerak.`,
      }));
      return;
    }

    setErrors((prev) => ({ ...prev, [key]: undefined }));
    onApply({ [key]: value });
  };

  const openings = room.openings ?? [];

  return (
    <section className={isRoomSelected ? 'room room--selected' : 'room'}>
      <h2 className="room__title">Xona</h2>

      {FIELDS.map(({ key, label }) => {
        const range = ROOM_LIMITS[key];
        return (
          <div className="field" key={key}>
            <label className="field__label" htmlFor={`room-${key}`}>
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
              value={room[key]}
              aria-label={`${label} slayder`}
              onChange={(event) => onApply({ [key]: Number(event.target.value) })}
            />
            <input
              id={`room-${key}`}
              className={errors[key] ? 'field__input field__input--error' : 'field__input'}
              type="number"
              inputMode="decimal"
              min={range.min}
              max={range.max}
              step={range.step}
              value={drafts[key]}
              aria-invalid={Boolean(errors[key])}
              onChange={(event) => setDrafts((prev) => ({ ...prev, [key]: event.target.value }))}
              onBlur={(event) => commit(key, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commit(key, (event.target as HTMLInputElement).value);
                }
              }}
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
        <label className="toggle">
          <input
            type="checkbox"
            checked={Boolean(room.showCeiling)}
            aria-label="Shiftni ko'rsatish"
            onChange={(event) => onToggleCeiling(event.target.checked)}
          />
          Shiftni ko&apos;rsatish
        </label>
      </div>

      <div className="field">
        <span className="field__label">Layout preseti</span>
        <select
          className="field__input"
          value={layoutPreset}
          aria-label="Layout preseti"
          onChange={(event) => onLayoutPresetChange(event.target.value as LayoutPresetId)}
        >
          {LAYOUT_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {LAYOUT_PRESET_LABELS[preset]}
            </option>
          ))}
        </select>
        <button type="button" className="visual-reset" onClick={onApplyLayout}>
          Joylashuvni qo&apos;llash
        </button>
        <p className="visual__hint">
          Preset xonadagi mebellarni haqiqiy obyektlar sifatida qayta yaratadi (mavjud
          obyektlar almashtiriladi).
        </p>
      </div>

      <div className="field">
        <span className="field__label">Eshik/deraza joyi (belgi)</span>
        <div className="axis">
          <select
            className="field__input"
            value={openingWall}
            aria-label="Devor"
            onChange={(event) => setOpeningWall(event.target.value as WallId)}
          >
            {WALLS.map((wall) => (
              <option key={wall} value={wall}>
                {WALL_LABELS[wall]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="visual-reset"
            onClick={() => onAddOpening('door', openingWall)}
          >
            Eshik qo&apos;shish
          </button>
          <button
            type="button"
            className="visual-reset"
            onClick={() => onAddOpening('window', openingWall)}
          >
            Deraza qo&apos;shish
          </button>
        </div>
        {openings.length > 0 && (
          <ul className="hierarchy__list">
            {openings.map((opening: RoomOpening) => (
              <li key={opening.id} className="node">
                <span className="node__name">
                  {OPENING_LABELS[opening.kind]} — {WALL_LABELS[opening.wall]}
                </span>
                <button
                  type="button"
                  className="visual-reset"
                  aria-label={`${OPENING_LABELS[opening.kind]}ni o'chirish`}
                  onClick={() => onRemoveOpening(opening.id)}
                >
                  O&apos;chirish
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="visual__hint">
          Bu faqat joy belgisi; devor geometriyasi kesilmaydi (kelajakda real teshik).
        </p>
      </div>

      <div className="room__actions">
        <button type="button" className="room__select" onClick={onSelectRoom}>
          Xonani tanlash
        </button>
        <button type="button" className="room__reset" onClick={onResetRoom}>
          Xonani tiklash
        </button>
      </div>
    </section>
  );
}
