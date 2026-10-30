/**
 * C7 — material usage and cutting section of the manufacturing panel.
 *
 * Presentational: the layout is produced by `cuttingPlan`, this component only
 * collects the sheet settings and draws what the algorithm returned. The SVG
 * preview uses the sheet's millimetre coordinates as its own coordinate system,
 * so a rectangle in the picture is exactly a placement in the plan — it is a
 * diagram of the result, not a decorative illustration.
 *
 * Results are only shown after an explicit calculate, so the reader always knows
 * whether what they are looking at matches the settings currently entered.
 */
import { useState } from 'react';
import type { BomResult } from '../manufacturing/bom';
import { createCuttingPlanSvg } from '../manufacturing/cuttingPlanSvg';
import { downloadBlob } from '../export/downloadFile';
import type { CutListResult } from '../manufacturing/cutList';
import {
  CUTTING_STATUS_LABELS,
  UNPLACED_REASON_LABELS,
  buildCuttingPlan,
  type CuttingPlan,
  type CuttingSheet,
  type SheetSettingsInput,
} from '../manufacturing/cuttingPlan';

interface CuttingPlanPanelProps {
  cutList: CutListResult;
  /** Optional BOM, used to name solid parts the cut list excludes. */
  bom?: BomResult;
  /**
   * Receives the plan that should be exported, or null when there is nothing
   * current to export. The panel owns the settings, so the parent cannot derive
   * this itself; reporting only a *current* plan keeps a stale result out of the
   * PDF.
   */
  onPlanChange?: (plan: CuttingPlan | null) => void;
}

interface SettingsDraft {
  sheetLength: string;
  sheetWidth: string;
  kerf: string;
  edgeMargin: string;
  maxSheets: string;
  allowRotation: boolean;
}

const DEFAULT_DRAFT: SettingsDraft = {
  sheetLength: '2440',
  sheetWidth: '1220',
  kerf: '4',
  edgeMargin: '',
  maxSheets: '',
  allowRotation: true,
};


const num = (value: string): number => (value.trim() === '' ? Number.NaN : Number(value));

function draftToInput(draft: SettingsDraft): SheetSettingsInput {
  const input: SheetSettingsInput = {
    sheetLengthMm: num(draft.sheetLength),
    sheetWidthMm: num(draft.sheetWidth),
    kerfMm: num(draft.kerf),
    allowRotation: draft.allowRotation,
  };
  if (draft.edgeMargin.trim() !== '') {
    input.edgeMarginMm = num(draft.edgeMargin);
  }
  if (draft.maxSheets.trim() !== '') {
    input.maxSheets = num(draft.maxSheets);
  }
  return input;
}

function settingsKey(draft: SettingsDraft): string {
  return [
    draft.sheetLength.trim(),
    draft.sheetWidth.trim(),
    draft.kerf.trim(),
    draft.edgeMargin.trim(),
    draft.maxSheets.trim(),
    draft.allowRotation ? '1' : '0',
  ].join('|');
}

function SheetPreview({ sheet }: { sheet: CuttingSheet }) {
  const { sheetLengthMm: length, sheetWidthMm: width } = sheet;
  // Type size follows the board so labels stay legible at any sheet size, and a
  // piece smaller than the label simply goes unlabelled rather than overlapping
  // its neighbour.
  const fontMm = Math.max(length, width) / 42;
  const strokeMm = Math.max(length, width) / 400;

  return (
    <svg
      className="cutting-preview"
      viewBox={`0 0 ${length} ${width}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`List ${sheet.index}: ${sheet.materialName} ${sheet.thicknessMm} mm`}
      data-testid={`cutting-preview-${sheet.index}`}
    >
      <rect
        x={0}
        y={0}
        width={length}
        height={width}
        fill="#f4f1ea"
        stroke="#8a8578"
        strokeWidth={strokeMm}
      />
      {sheet.placements.map((piece) => {
        const label = `${piece.partId} #${piece.instance}`;
        const fitsLabel = piece.widthMm > fontMm * 6 && piece.heightMm > fontMm * 2;
        return (
          <g key={`${piece.partId}-${piece.instance}`}>
            <rect
              x={piece.xMm}
              y={piece.yMm}
              width={piece.widthMm}
              height={piece.heightMm}
              fill={piece.rotated ? '#d9e6f2' : '#e6ded0'}
              stroke="#4a463c"
              strokeWidth={strokeMm}
            />
            {fitsLabel && (
              <text
                x={piece.xMm + fontMm * 0.4}
                y={piece.yMm + fontMm * 1.3}
                fontSize={fontMm}
                fill="#2c2a24"
              >
                {label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Field({
  id,
  label,
  value,
  hint,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  hint: string;
  onChange: (next: string) => void;
}) {
  return (
    <>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field__input"
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={`${id}-hint`}
      />
      <p className="visual__hint" id={`${id}-hint`}>
        {hint}
      </p>
    </>
  );
}

export function CuttingPlanPanel({ cutList, bom, onPlanChange }: CuttingPlanPanelProps) {
  const [draft, setDraft] = useState<SettingsDraft>(DEFAULT_DRAFT);
  /**
   * The last calculation, tagged with the cut list and the settings it came from.
   * Tagging during render — rather than resetting from an effect — means a plan
   * for another model is simply not displayed, with no cascading render.
   */
  const [result, setResult] = useState<{
    plan: CuttingPlan;
    key: string;
    cutList: CutListResult;
  } | null>(null);
  const [error, setError] = useState('');

  const sameCutList = result !== null && result.cutList === cutList;
  const plan = sameCutList ? result.plan : null;
  const stale = sameCutList && result.key !== settingsKey(draft);

  const edit = (patch: Partial<SettingsDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    // A setting change invalidates the plan on screen, so the parent must not
    // keep exporting it until the reader recalculates.
    if (result && result.cutList === cutList && result.key !== settingsKey(next)) {
      onPlanChange?.(null);
    }
  };

  const handleCalculate = () => {
    const outcome = buildCuttingPlan({
      cutList,
      bom,
      settings: draftToInput(draft),
    });
    if (!outcome.ok) {
      setResult(null);
      setError(outcome.reason);
      onPlanChange?.(null);
      return;
    }
    setError('');
    const entry = { plan: outcome.plan, key: settingsKey(draft), cutList };
    setResult(entry);
    // The parent exports this plan; a later settings change tells it to stop.
    onPlanChange?.(entry.plan);
  };

  return (
    <div className="field cutting" data-testid="cutting-plan">
      <span className="field__label">Material sarfi va kesish rejasi</span>
      <p className="visual__hint">
        List o‘lchamlari, arra eni va chekka chegara kiritiladi. Detallar materiali va nominal
        qalinligi bo‘yicha alohida listlarga joylashtiriladi.
      </p>

      <div className="cutting__settings" data-testid="cutting-settings">
        <Field
          id="cutting-sheet-length"
          label="List uzunligi (mm)"
          value={draft.sheetLength}
          hint="Noldan katta bo‘lishi kerak."
          onChange={(sheetLength) => edit({ sheetLength })}
        />
        <Field
          id="cutting-sheet-width"
          label="List kengligi (mm)"
          value={draft.sheetWidth}
          hint="Noldan katta bo‘lishi kerak."
          onChange={(sheetWidth) => edit({ sheetWidth })}
        />
        <Field
          id="cutting-kerf"
          label="Arra kesish eni — kerf (mm)"
          value={draft.kerf}
          hint="0 mm — kerf hisobga olinmaydi (ogohlantirish bilan)."
          onChange={(kerf) => edit({ kerf })}
        />
        <Field
          id="cutting-edge-margin"
          label="Chekka chegara (mm, ixtiyoriy)"
          value={draft.edgeMargin}
          hint="Bo‘sh qoldirilsa 0 mm — ruxsat qo‘llanmaydi."
          onChange={(edgeMargin) => edit({ edgeMargin })}
        />
        <Field
          id="cutting-max-sheets"
          label="Listlar soni chegarasi (ixtiyoriy)"
          value={draft.maxSheets}
          hint="Bo‘sh qoldirilsa cheklov yo‘q."
          onChange={(maxSheets) => edit({ maxSheets })}
        />

        <label className="cutting__checkbox" htmlFor="cutting-rotate">
          <input
            id="cutting-rotate"
            type="checkbox"
            checked={draft.allowRotation}
            onChange={(event) => edit({ allowRotation: event.target.checked })}
          />
          Detallarni 90° aylantirishga ruxsat
        </label>
      </div>

      <button
        type="button"
        className="visual-reset manufacturing__package-button"
        onClick={handleCalculate}
        data-testid="cutting-generate"
      >
        {plan ? 'Kesish rejasini qayta hisoblash' : 'Kesish rejasini hisoblash'}
      </button>

      {error && (
        <p className="field__error" role="alert" data-testid="cutting-error">
          {error}
        </p>
      )}

      {stale && (
        <p className="render__message render__message--error" role="alert" data-testid="cutting-stale">
          Sozlamalar o‘zgargan — quyida eski hisob natijasi ko‘rsatilmoqda. Qayta hisoblang.
        </p>
      )}

      {!plan && !error && (
        <p className="visual__hint">
          Natija hisoblash tugmasidan keyin ko‘rsatiladi. Algoritm evristik: optimal kesim
          kafolatlanmaydi.
        </p>
      )}

      {plan && (
        <>
          <p className="visual__hint" data-testid="cutting-status">
            {CUTTING_STATUS_LABELS[plan.status]} · {plan.summary.sheetCount} list ·{' '}
            {plan.summary.placedCount}/{plan.summary.pieceCount} detal · chiqindi{' '}
            {plan.summary.wastePercent}%
          </p>

          <button
            type="button"
            className="visual-reset"
            data-testid="cutting-svg"
            onClick={() =>
              downloadBlob(
                new Blob([createCuttingPlanSvg(plan)], { type: 'image/svg+xml' }),
                'kesish-rejasi.svg',
              )
            }
          >
            Kesish sxemasi (SVG) yuklab olish
          </button>

          <ul className="manufacturing__list" data-testid="cutting-summary">
            <li>
              Foydalanilgan yuza: {plan.summary.usedAreaM2} m² · Mavjud yuza:{' '}
              {plan.summary.availableAreaM2} m²
            </li>
            <li>
              Kerf maydoni: {plan.summary.kerfAreaM2} m² · Chiqindi (qoldiq):{' '}
              {plan.summary.wasteAreaM2} m² ({plan.summary.wastePercent}%)
            </li>
            <li>
              Materiallar: {plan.summary.materialCount} tur · List o‘lchami:{' '}
              {plan.settings.sheetLengthMm}×{plan.settings.sheetWidthMm} mm · Kerf{' '}
              {plan.settings.kerfMm} mm · Chekka {plan.settings.edgeMarginMm} mm
            </li>
          </ul>

          {plan.groups.map((group) => (
            <div
              className="cutting__group"
              key={`${group.materialId}-${group.thicknessMm}`}
              data-testid={`cutting-group-${group.materialId}-${group.thicknessMm}`}
            >
              <p className="cutting__group-title">
                {group.name} · {group.thicknessMm} mm — {group.sheets.length} list ·{' '}
                {group.pieceCount} detal · chiqindi {group.wastePercent}%
              </p>
              {group.sheets.map((sheet) => (
                <div className="cutting__sheet" key={sheet.index} data-testid="cutting-sheet">
                  <p className="visual__hint">
                    List {sheet.index} · {sheet.materialName} {sheet.thicknessMm} mm ·{' '}
                    {sheet.sheetLengthMm}×{sheet.sheetWidthMm} mm · chiqindi {sheet.wastePercent}%
                  </p>
                  <SheetPreview sheet={sheet} />
                  <ul className="manufacturing__list cutting__pieces">
                    {sheet.placements.map((piece) => (
                      <li key={`${piece.partId}-${piece.instance}`}>
                        {piece.name} ({piece.partId}) #{piece.instance} — {piece.widthMm}×
                        {piece.heightMm} mm @ ({piece.xMm}, {piece.yMm}) mm
                        {piece.rotated ? ' · aylantirilgan' : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}

          {plan.unplaced.length > 0 && (
            <div data-testid="cutting-unplaced">
              <p className="field__error" role="alert">
                Joylashtirilmagan detallar: {plan.summary.unplacedCount} dona.
              </p>
              <ul className="manufacturing__validation-list">
                {plan.unplaced.map((piece) => (
                  <li
                    className="manufacturing__validation-item manufacturing__validation-item--warning"
                    key={`${piece.partId}-${piece.reason}`}
                  >
                    <strong>{UNPLACED_REASON_LABELS[piece.reason]}</strong> · {piece.name} (
                    {piece.partId}) × {piece.quantity} — {piece.lengthMm}×{piece.widthMm} mm
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan.excluded.length > 0 && (
            <p className="visual__hint" data-testid="cutting-excluded">
              Panel bo‘lmagan detallar (listga kirmaydi):{' '}
              {plan.excluded
                .map((piece) => `${piece.name} (${piece.partId}) × ${piece.quantity}`)
                .join(', ')}
            </p>
          )}

          {plan.issues.filter((issue) => issue.level !== 'info').length > 0 && (
            <ul className="manufacturing__validation-list" data-testid="cutting-issues">
              {plan.issues
                .filter((issue) => issue.level !== 'info')
                .map((issue) => (
                  <li
                    className={`manufacturing__validation-item manufacturing__validation-item--${
                      issue.level === 'error' ? 'error' : 'warning'
                    }`}
                    key={`${issue.code}-${issue.partId ?? 'all'}`}
                  >
                    <strong>{issue.level === 'error' ? 'Xatolik' : 'Ogohlantirish'}</strong>
                    {issue.partId ? ` · ${issue.partId}` : ''}: {issue.message}
                  </li>
                ))}
            </ul>
          )}

          <ul className="image-ref__warnings" data-testid="cutting-limitations">
            {plan.limitations.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
