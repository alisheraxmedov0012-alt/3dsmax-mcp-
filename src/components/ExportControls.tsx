import {
  EXPORT_FORMATS,
  formatCapabilitySummary,
  type ExportFormatId,
} from '../export/exportFormats';
import { DATA_EXPORT_FORMATS } from '../export/sceneFileExport';

export type ExportStatus = 'idle' | 'exporting' | 'success' | 'error';

export interface ExportControlsProps {
  format: ExportFormatId;
  includeRoom: boolean;
  status: ExportStatus;
  message: string;
  disabled: boolean;
  /** GLB texture resolution; 128 keeps the historical default. */
  textureSize?: 128 | 512;
  /** Print formats: export only the selected object instead of every visible piece. */
  printScopeSelected?: boolean;
  /** Name shown in the print-scope control; null when nothing is selected. */
  selectedObjectName?: string | null;
  onPrintScopeChange?: (selectedOnly: boolean) => void;
  onFormatChange: (format: ExportFormatId) => void;
  onIncludeRoomChange: (include: boolean) => void;
  onTextureSizeChange?: (size: 128 | 512) => void;
  onExport: () => void;
  onImportFile: (file: File) => void;
}

export function ExportControls({
  format,
  includeRoom,
  status,
  message,
  disabled,
  textureSize = 128,
  printScopeSelected = true,
  selectedObjectName = null,
  onPrintScopeChange,
  onFormatChange,
  onIncludeRoomChange,
  onTextureSizeChange,
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

      {(format === 'glb' || format === 'obj') && (
        <label className="toggle">
          <input
            type="checkbox"
            checked={includeRoom}
            aria-label="Interyerni qo'shish"
            onChange={(event) => onIncludeRoomChange(event.target.checked)}
          />
          Interyerni (xona) qo&apos;shish
        </label>
      )}

      {(format === 'stl' || format === '3mf') && (
        <div className="field" data-testid="print-export-scope">
          <span className="field__label">Print eksport doirasi</span>
          {selectedObjectName ? (
            <label className="toggle">
              <input
                type="checkbox"
                checked={printScopeSelected}
                aria-label="Faqat tanlangan obyektni eksport qilish"
                onChange={(event) => onPrintScopeChange?.(event.target.checked)}
              />
              Faqat tanlangan obyekt: {selectedObjectName}
            </label>
          ) : (
            <p className="visual__hint">
              Obyekt tanlanmagan — barcha ko&apos;rinadigan mebel (xona emas) eksport qilinadi.
            </p>
          )}
          <p className="visual__hint">
            Xona STL/3MF print eksportiga qo&apos;shilmaydi. Boshqa mebel faqat yuqoridagi
            belgi olib tashlansa qo&apos;shiladi.
          </p>
        </div>
      )}

      {format === 'glb' && onTextureSizeChange && (
        <label className="toggle">
          <input
            type="checkbox"
            checked={textureSize === 512}
            aria-label="Yuqori sifatli teksturalar (512)"
            onChange={(event) => onTextureSizeChange(event.target.checked ? 512 : 128)}
          />
          Yuqori sifatli teksturalar (512×512) — fayl kattaroq
        </label>
      )}

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
