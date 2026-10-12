import { useMemo, useState } from 'react';
import { ControlsPanel } from './components/ControlsPanel';
import { ViewerCanvas } from './components/ViewerCanvas';
import {
  DEFAULT_FIELD_VALUES,
  parseTableValues,
  type TableFieldValues,
} from './geometry/tableParams';
import './App.css';

export default function App() {
  const [values, setValues] = useState<TableFieldValues>(DEFAULT_FIELD_VALUES);

  const parsed = useMemo(() => parseTableValues(values), [values]);

  const handleChange = (field: keyof TableFieldValues, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleReset = () => {
    setValues(DEFAULT_FIELD_VALUES);
  };

  return (
    <div className="app">
      <ControlsPanel
        values={values}
        errors={parsed.errors}
        onChange={handleChange}
        onReset={handleReset}
      />

      <main className="stage">
        <ViewerCanvas params={parsed.params} />

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
