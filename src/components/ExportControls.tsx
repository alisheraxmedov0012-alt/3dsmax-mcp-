import {
  EXPORT_FORMATS,
  formatCapabilitySummary,
  type ExportFormatId,
} from '../export/exportFormats';
import { DATA_EXPORT_FORMATS } from '../export/sceneFileExport';
import { QUALITY_PROFILES } from '../export/quality/profiles';
import type {
  BudgetSeverity,
  QualityLimitsOverride,
  QualityPreflightResult,
  QualityProfile,
  QualityProfileId,
} from '../export/quality/types';

const PROFILE_LABELS: Record<QualityProfileId, string> = {
  draft: 'Qoralama',
  standard: 'Standart',
  high: 'Yuqori sifat',
  custom: 'Maxsus',
};

const MiB = 1024 * 1024;
const MP = 1_000_000;
const EMPTY_QUALITY_LIMITS: QualityLimitsOverride = {};

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
  qualityProfileId?: QualityProfileId;
  qualityProfile?: QualityProfile;
  qualityPreflight?: QualityPreflightResult | null;
  qualityPreflightStatus?: 'idle' | 'running' | 'error';
  qualityMessage?: string;
  customLimits?: QualityLimitsOverride;
  customBudgetSeverity?: BudgetSeverity;
  onQualityProfileChange?: (id: QualityProfileId) => void;
  onCustomLimitsChange?: (limits: QualityLimitsOverride) => void;
  onCustomBudgetSeverityChange?: (severity: BudgetSeverity) => void;
  onRunQualityPreflight?: () => void;
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
  qualityProfileId = 'standard',
  qualityProfile = QUALITY_PROFILES.standard,
  qualityPreflight = null,
  qualityPreflightStatus = 'idle',
  qualityMessage = '',
  customLimits = EMPTY_QUALITY_LIMITS,
  customBudgetSeverity = 'WARNING',
  onQualityProfileChange,
  onCustomLimitsChange,
  onCustomBudgetSeverityChange,
  onRunQualityPreflight,
}: ExportControlsProps) {
  const isExporting = status === 'exporting';
  const spec = EXPORT_FORMATS[format];
  const showQuality = Boolean(onQualityProfileChange);
  const blocking = qualityPreflight?.checks.filter((entry) => entry.status === 'BLOCK') ?? [];
  const warnings = qualityPreflight?.checks.filter((entry) => entry.status === 'WARNING') ?? [];

  const updateLimit = (section: keyof QualityLimitsOverride, key: string, value: number) => {
    if (!Number.isFinite(value) || value < 0) return;
    const current = customLimits[section] as Record<string, unknown> | undefined;
    onCustomLimitsChange?.({
      ...customLimits,
      [section]: { ...current, [key]: value },
    });
  };

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

      {showQuality && (
        <div className="field" data-testid="quality-profile">
          <span className="field__label">Sifat profili</span>
          <div className="preset-grid">
            {(Object.keys(PROFILE_LABELS) as QualityProfileId[]).map((id) => (
              <button
                key={id}
                type="button"
                className={id === qualityProfileId ? 'preset preset--active' : 'preset'}
                aria-pressed={id === qualityProfileId}
                onClick={() => onQualityProfileChange?.(id)}
              >
                {PROFILE_LABELS[id]}
              </button>
            ))}
          </div>
          <p className="visual__hint">{qualityProfile.description}</p>

          {qualityProfileId === 'custom' && (
            <details className="field" data-testid="quality-custom-limits">
              <summary className="field__label">Maxsus limitlar</summary>
              <div className="preset-grid">
                <label className="field">
                  <span className="field__label">Uchburchaklar</span>
                  <input
                    className="field__input"
                    type="number"
                    min={0}
                    value={qualityProfile.limits.geometry.maxTriangles}
                    onChange={(event) =>
                      updateLimit('geometry', 'maxTriangles', Number(event.target.value))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Vertexlar</span>
                  <input
                    className="field__input"
                    type="number"
                    min={0}
                    value={qualityProfile.limits.geometry.maxVertices}
                    onChange={(event) =>
                      updateLimit('geometry', 'maxVertices', Number(event.target.value))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Meshlar</span>
                  <input
                    className="field__input"
                    type="number"
                    min={0}
                    value={qualityProfile.limits.geometry.maxMeshes}
                    onChange={(event) =>
                      updateLimit('geometry', 'maxMeshes', Number(event.target.value))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Obyektlar</span>
                  <input
                    className="field__input"
                    type="number"
                    min={0}
                    value={qualityProfile.limits.geometry.maxObjects}
                    onChange={(event) =>
                      updateLimit('geometry', 'maxObjects', Number(event.target.value))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">GLB hajmi (MB)</span>
                  <input
                    className="field__input"
                    type="number"
                    min={1}
                    value={Math.round(qualityProfile.limits.fileSize.maxGlbBytes / MiB)}
                    onChange={(event) =>
                      updateLimit(
                        'fileSize',
                        'maxGlbBytes',
                        Math.max(1, Number(event.target.value)) * MiB,
                      )
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Tekstura payload (MB)</span>
                  <input
                    className="field__input"
                    type="number"
                    min={1}
                    value={Math.round(qualityProfile.limits.fileSize.maxTexturePayloadBytes / MiB)}
                    onChange={(event) =>
                      updateLimit(
                        'fileSize',
                        'maxTexturePayloadBytes',
                        Math.max(1, Number(event.target.value)) * MiB,
                      )
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Tekstura kengligi (px)</span>
                  <input
                    className="field__input"
                    type="number"
                    min={1}
                    value={qualityProfile.limits.textures.maxWidth}
                    onChange={(event) =>
                      updateLimit('textures', 'maxWidth', Number(event.target.value))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Tekstura balandligi (px)</span>
                  <input
                    className="field__input"
                    type="number"
                    min={1}
                    value={qualityProfile.limits.textures.maxHeight}
                    onChange={(event) =>
                      updateLimit('textures', 'maxHeight', Number(event.target.value))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Umumiy tekstura (MP)</span>
                  <input
                    className="field__input"
                    type="number"
                    min={1}
                    value={Math.round(qualityProfile.limits.textures.maxTotalPixels / MP)}
                    onChange={(event) =>
                      updateLimit(
                        'textures',
                        'maxTotalPixels',
                        Math.max(1, Number(event.target.value)) * MP,
                      )
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Bitta tekstura (MB)</span>
                  <input
                    className="field__input"
                    type="number"
                    min={1}
                    value={Math.round(qualityProfile.limits.textures.maxIndividualBytes / MiB)}
                    onChange={(event) =>
                      updateLimit(
                        'textures',
                        'maxIndividualBytes',
                        Math.max(1, Number(event.target.value)) * MiB,
                      )
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">UV absolyut limit</span>
                  <input
                    className="field__input"
                    type="number"
                    min={1}
                    value={qualityProfile.limits.uv.maxAbs}
                    onChange={(event) =>
                      updateLimit('uv', 'maxAbs', Number(event.target.value))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Budjet oshsa</span>
                  <select
                    className="field__input"
                    value={customBudgetSeverity}
                    onChange={(event) =>
                      onCustomBudgetSeverityChange?.(
                        event.target.value as BudgetSeverity,
                      )
                    }
                  >
                    <option value="WARNING">Ogohlantirish</option>
                    <option value="BLOCK">Bloklash</option>
                  </select>
                </label>
              </div>
            </details>
          )}

          {onRunQualityPreflight && (
            <button
              type="button"
              className="visual-reset"
              data-testid="quality-preflight-button"
              disabled={isExporting || qualityPreflightStatus === 'running'}
              onClick={onRunQualityPreflight}
            >
              {qualityPreflightStatus === 'running'
                ? 'Tekshirilmoqda…'
                : 'Sifatni tekshirish'}
            </button>
          )}

          {qualityMessage && (
            <p className="export__message export__message--error">{qualityMessage}</p>
          )}

          {qualityPreflight && (
            <div className="field" data-testid="quality-summary">
              <span className="field__label">
                {qualityPreflight.profile.label}: {qualityPreflight.status}
              </span>
              <p className="visual__hint">
                {qualityPreflight.summary.pass} PASS · {qualityPreflight.summary.warning}{' '}
                WARNING · {qualityPreflight.summary.block} BLOCK
                {qualityPreflight.estimated ? ' · hajm taxminiy' : ''}
              </p>
              <ul className="image-ref__notes">
                {[...blocking, ...warnings].slice(0, 6).map((entry) => (
                  <li key={entry.id}>
                    <strong>{entry.status}</strong> {entry.label} ({entry.certainty}):{' '}
                    {entry.message} {entry.remediation}
                  </li>
                ))}
                {blocking.length === 0 && warnings.length === 0 && (
                  <li>Barcha tekshiruvlar o&apos;tdi.</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

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
