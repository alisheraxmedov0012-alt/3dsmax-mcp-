export type ExportStatus = 'idle' | 'exporting' | 'success' | 'error';

interface ExportControlsProps {
  status: ExportStatus;
  message: string;
  disabled: boolean;
  onExport: () => void;
}

export function ExportControls({ status, message, disabled, onExport }: ExportControlsProps) {
  const isExporting = status === 'exporting';

  return (
    <section className="export">
      <h2 className="export__title">Eksport</h2>
      <button
        type="button"
        className="export__button"
        onClick={onExport}
        disabled={disabled || isExporting}
      >
        {isExporting ? 'Eksport qilinmoqda…' : "Modelni eksport qilish (.glb)"}
      </button>
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
