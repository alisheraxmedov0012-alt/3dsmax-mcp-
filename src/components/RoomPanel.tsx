import { useEffect, useState } from 'react';
import { ROOM_LIMITS, type RoomConfig } from '../scene/types';

interface RoomPanelProps {
  room: RoomConfig;
  isRoomSelected: boolean;
  onApply: (room: Partial<RoomConfig>) => void;
  onResetRoom: () => void;
  onSelectRoom: () => void;
}

type RoomField = keyof RoomConfig;
type RoomErrors = Partial<Record<RoomField, string>>;

const FIELDS: ReadonlyArray<{ key: RoomField; label: string }> = [
  { key: 'widthCm', label: 'Xona kengligi (sm)' },
  { key: 'lengthCm', label: 'Xona uzunligi (sm)' },
  { key: 'heightCm', label: 'Xona balandligi (sm)' },
];

function toDraft(room: RoomConfig): Record<RoomField, string> {
  return {
    widthCm: String(room.widthCm),
    lengthCm: String(room.lengthCm),
    heightCm: String(room.heightCm),
  };
}

export function RoomPanel({
  room,
  isRoomSelected,
  onApply,
  onResetRoom,
  onSelectRoom,
}: RoomPanelProps) {
  const [drafts, setDrafts] = useState(() => toDraft(room));
  const [errors, setErrors] = useState<RoomErrors>({});

  // Re-sync the text inputs when the room changes externally (slider, reset,
  // or loading a saved project).
  useEffect(() => {
    setDrafts(toDraft(room));
  }, [room.widthCm, room.lengthCm, room.heightCm]);

  const commit = (key: RoomField, raw: string) => {
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
