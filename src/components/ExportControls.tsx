import {
  EXPORT_FORMATS,
  formatCapabilitySummary,
  type ExportFormatId,
} from '../export/exportFormats';
import { DATA_EXPORT_FORMATS } from '../export/sceneFileExport';

export type ExportStatus = 'idle' | 'exporting' | 'success' | 'error';

interface ExportControlsProps {
  format: ExportFormatId;
  includeRoom: boolean;
  status: ExportStatus;
  message: string;
  disabled: boolean;
  onFormatChange: (format: ExportFormatId) => void;
  onIncludeRoomChange: (include: boolean) => void;
  onExport: () => void;
  onImportFile: (file: File) => void;
}

export function ExportControls({
  format,
  includeRoom,
  status,
  message,
  disabled,
  onFormatChange,
  onIncludeRoomChange,
  onExport,
  onImportFile,
}: ExportControlsProps) {
  const isExporting = status === 'exporting';
  const spec = EXPORT_FORMATS[format];

  return (
    <section className="export">
      <h2 className="export__title">Eksport</h2>

      <div className="field">
        <span className="field__label">Format</span>
        <div className="preset-grid">
          {DATA_EXPORT_FORMATS.map((id) => (
            <button
              key={id}
              type="button"
              className={id === format ? 'preset preset--active' : 'preset'}
              aria-pressed={id === format}
              onClick={() => onFormatChange(id)}
            >
              {EXPORT_FORMATS[id].label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field__label">
          Qo&apos;llab-quvvatlanadi: {formatCapabilitySummary(spec)}
        </span>
        <ul className="image-ref__notes">
          {spec.notes.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <label className="toggle">
        <input
          type="checkbox"
          checked={includeRoom}
          aria-label="Interyerni qo'shish"
          onChange={(event) => onIncludeRoomChange(event.target.checked)}
        />
        Interyerni (xona) qo&apos;shish
      </label>

      <button
        type="button"
        className="export__button"
        onClick={onExport}
        disabled={disabled || isExporting}
      >
        {isExporting ? 'Eksport qilinmoqda…' : `Eksport qilish (.${spec.extension})`}
      </button>

      <div className="field">
        <span className="field__label">JSON loyihani import qilish</span>
        <input
          className="field__input"
          type="file"
          accept="application/json,.json"
          aria-label="JSON loyihani import qilish"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              onImportFile(file);
            }
            event.target.value = '';
          }}
        />
        <p className="visual__hint">
          Import joriy sahna ustidan faqat tasdiqlangandan keyin yoziladi; xato bo&apos;lsa
          mavjud loyiha o&apos;zgarmaydi.
        </p>
      </div>

      {message &&
        (status === 'error' ? (
          <p className="export__message export__message--error" role="alert">
            {message}
          </p>
        ) : (
          <p className="export__message" role="status" aria-live="polite">
            {message}
          </p>
        ))}
    </section>
  );
}
