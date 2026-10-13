import { useMemo, useState } from 'react';
import { AiPromptPanel } from './components/AiPromptPanel';
import { ControlsPanel } from './components/ControlsPanel';
import { ExportControls, type ExportStatus } from './components/ExportControls';
import { ViewerCanvas } from './components/ViewerCanvas';
import { downloadArrayBuffer } from './export/downloadFile';
import { exportTableToGlb, TABLE_EXPORT_FILENAME } from './export/tableExport';
import {
  DEFAULT_FIELD_VALUES,
  paramsToFieldValues,
  parseTableValues,
  type TableFieldValues,
  type TableParams,
} from './geometry/tableParams';
import './App.css';

export default function App() {
  const [values, setValues] = useState<TableFieldValues>(DEFAULT_FIELD_VALUES);
  const [resetToken, setResetToken] = useState(0);
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle');
  const [exportMessage, setExportMessage] = useState('');

  const parsed = useMemo(() => parseTableValues(values), [values]);

  const handleChange = (field: keyof TableFieldValues, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleReset = () => {
    setValues(DEFAULT_FIELD_VALUES);
  };

  const handleResetView = () => {
    setResetToken((token) => token + 1);
  };

  const handleApplyProposal = (params: TableParams) => {
    setValues(paramsToFieldValues(params));
  };

  const handleExport = async () => {
    if (!parsed.params || exportStatus === 'exporting') {
      return;
    }

    setExportStatus('exporting');
    setExportMessage('Eksport qilinmoqda…');

    try {
      const data = await exportTableToGlb(parsed.params);
      downloadArrayBuffer(data, TABLE_EXPORT_FILENAME);
      setExportStatus('success');
      setExportMessage('Model .glb fayl sifatida yuklab olindi.');
    } catch (error) {
      setExportStatus('error');
      setExportMessage("Eksport amalga oshmadi. Iltimos, qaytadan urinib ko'ring.");
      console.error('GLB eksport xatosi:', error);
    }
  };

  return (
    <div className="app">
      <ControlsPanel
        values={values}
        errors={parsed.errors}
        onChange={handleChange}
        onReset={handleReset}
      >
        <AiPromptPanel onApply={handleApplyProposal} />
        <ExportControls
          status={exportStatus}
          message={exportMessage}
          disabled={!parsed.valid}
          onExport={handleExport}
        />
      </ControlsPanel>

      <main className="stage">
        <ViewerCanvas params={parsed.params} resetToken={resetToken} />

        <div className="stage__toolbar">
          <button type="button" className="stage__button" onClick={handleResetView}>
            Ko'rinishni tiklash
          </button>
        </div>

        {parsed.valid && parsed.params ? (
          <div className="readout">
            {parsed.params.widthCm} × {parsed.params.depthCm} × {parsed.params.heightCm} sm
          </div>
        ) : (
          <div className="banner" role="alert">
            Ba'zi qiymatlar noto'g'ri — model oxirgi to'g'ri holatda ko'rsatilmoqda.
          </div>
        )}
      </main>
    </div>
  );
}
