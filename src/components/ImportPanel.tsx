/**
 * Phase 6.2 — model import: GLB, glTF with companion files, OBJ + MTL.
 *
 * The panel is the confirmation step, not the pipeline. It reads the selected
 * files, asks `prepareImport` to validate and parse them into a detached model,
 * shows what was measured and what could not be resolved, and only then hands the
 * model to the app. Nothing reaches the scene until the user confirms, and every
 * exit path returns the model to the store for disposal.
 *
 * Three honesty rules shape the UI:
 *
 * 1. The summary describes the *parsed* geometry (size measured in centimetres
 *    after the unit conversion), not the file name or the byte count.
 * 2. A texture that could not be resolved is named, and the import cannot be
 *    confirmed until the user accepts the consequence.
 * 3. Imported models are session-only, and the panel says so before the confirm
 *    button is reachable.
 */
import { useEffect, useRef, useState } from 'react';
import { ImportError } from '../import/importErrors';
import {
  DEFAULT_OBJ_UNIT,
  OBJ_UNIT_TO_CM,
  type ObjUnit,
} from '../import/importLimits';
import {
  prepareImport,
  type ImportFile,
  type ImportReport,
  type ParsedImport,
} from '../import/parseModel';
import type { ImportedModelMeta } from '../scene/types';

export interface ImportPanelProps {
  /** Set while another operation owns the renderer; import is refused then. */
  blockedReason?: string;
  /**
   * Registers the model and adds it to the scene. Throws when the object could
   * not be added; the panel then disposes the model and reports the failure.
   */
  onImport: (parsed: ParsedImport) => void;
}

type Status = 'idle' | 'reading' | 'validating' | 'ready' | 'importing' | 'success' | 'error';

const FORMAT_LABELS: Record<ImportReport['format'], string> = {
  glb: 'GLB',
  gltf: 'glTF',
  obj: 'OBJ',
};

const UNIT_LABELS: Record<ObjUnit, string> = {
  mm: 'Millimetr (mm)',
  cm: 'Santimetr (sm)',
  m: 'Metr (m)',
};

/** FileReader rather than Blob.arrayBuffer: older Android WebViews lack the latter. */
function readFileBytes(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) {
        resolve(result);
        return;
      }
      reject(new ImportError('failed', "Faylni o'qib bo'lmadi."));
    });
    reader.addEventListener('error', () =>
      reject(new ImportError('failed', "Faylni o'qib bo'lmadi.")),
    );
    reader.readAsArrayBuffer(file);
  });
}

function describeFailure(error: unknown): string {
  if (error instanceof ImportError) {
    return error.message;
  }
  return "Modelni o'qib bo'lmadi: kutilmagan xato.";
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function boundsLabel(meta: ImportedModelMeta): string {
  const { min, max } = meta.boundsCm;
  const axis = (from: number, to: number): string => (to - from).toFixed(1);
  return `${axis(min.x, max.x)} × ${axis(min.y, max.y)} × ${axis(min.z, max.z)} sm`;
}

/** Relative path a directory picker reports, when the browser provides one. */
function relativePathOf(file: File): string | undefined {
  const value = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' ? undefined : trimmed;
}

export function ImportPanel({ blockedReason, onImport }: ImportPanelProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [stats, setStats] = useState<ImportedModelMeta | null>(null);
  const [selection, setSelection] = useState<readonly ImportFile[]>([]);
  const [unit, setUnit] = useState<ObjUnit>(DEFAULT_OBJ_UNIT);
  const [acknowledged, setAcknowledged] = useState(false);

  // The parsed model outlives a single render and owns GPU memory, so it lives in a
  // ref that every exit path clears exactly once.
  const pending = useRef<ParsedImport | null>(null);
  const abort = useRef<AbortController | null>(null);
  // Guards against an older `prepareImport` resolving after a newer one.
  const generation = useRef(0);

  useEffect(
    () => () => {
      abort.current?.abort();
      pending.current?.dispose();
      pending.current = null;
    },
    [],
  );

  const releasePending = (): void => {
    pending.current?.dispose();
    pending.current = null;
    setReport(null);
    setStats(null);
    setAcknowledged(false);
  };

  const prepare = async (
    files: readonly ImportFile[],
    nextUnit: ObjUnit,
    label: string,
  ): Promise<void> => {
    abort.current?.abort();
    releasePending();

    const controller = new AbortController();
    abort.current = controller;
    const token = generation.current + 1;
    generation.current = token;

    setStatus('validating');
    setMessage(label);

    try {
      const prepared = await prepareImport(files, {
        signal: controller.signal,
        objUnit: nextUnit,
      });
      // A superseded attempt must not publish its model or keep it alive.
      if (controller.signal.aborted || generation.current !== token) {
        prepared.parsed.dispose();
        return;
      }
      pending.current = prepared.parsed;
      setReport(prepared.report);
      setStats(prepared.parsed.meta);
      setAcknowledged(false);
      setStatus('ready');
      setMessage(
        prepared.report.requiresAcknowledgement
          ? "Model o'qildi, lekin ba'zi resurslar topilmadi — pastdagi ogohlantirishni o'qing."
          : "Fayl tekshiruvdan o'tdi. Sahnaga qo'shishdan oldin ma'lumotlarni ko'rib chiqing.",
      );
    } catch (error) {
      if (error instanceof ImportError && error.code === 'aborted') {
        return;
      }
      if (generation.current !== token) {
        return;
      }
      if (!(error instanceof ImportError)) {
        console.error('Model import xatosi:', error);
      }
      setStatus('error');
      setMessage(describeFailure(error));
    }
  };

  const handleFiles = async (fileList: FileList | null): Promise<void> => {
    if (!fileList || fileList.length === 0 || blockedReason) {
      return;
    }

    abort.current?.abort();
    releasePending();
    setStatus('reading');
    setMessage(`Fayllar o'qilmoqda… (${fileList.length})`);

    try {
      // The selection is bounded by the resource-map limits, and every file's
      // bytes are kept anyway, so reading them together costs nothing extra.
      const files: ImportFile[] = await Promise.all(
        Array.from(fileList).map(async (file) => {
          const bytes = await readFileBytes(file);
          const path = relativePathOf(file);
          return path === undefined ? { name: file.name, bytes } : { name: file.name, path, bytes };
        }),
      );
      setSelection(files);
      await prepare(files, unit, 'Model tekshirilmoqda…');
    } catch (error) {
      setStatus('error');
      setMessage(describeFailure(error));
    }
  };

  const handleUnitChange = (nextUnit: ObjUnit): void => {
    setUnit(nextUnit);
    if (selection.length > 0) {
      void prepare(selection, nextUnit, "O'lchov birligi qayta hisoblanmoqda…");
    }
  };

  const handleConfirm = (): void => {
    const parsed = pending.current;
    if (!parsed || blockedReason) {
      return;
    }
    if (report?.requiresAcknowledgement && !acknowledged) {
      return;
    }
    setStatus('importing');
    try {
      onImport(parsed);
      pending.current = null;
      setReport(null);
      setStats(null);
      setStatus('success');
      setMessage(`"${parsed.meta.fileName}" sahnaga qo'shildi.`);
    } catch (error) {
      // The model never reached the scene, so it is still ours to release.
      parsed.dispose();
      pending.current = null;
      setReport(null);
      setStats(null);
      setStatus('error');
      setMessage(describeFailure(error));
    }
  };

  const handleCancel = (): void => {
    abort.current?.abort();
    generation.current += 1;
    releasePending();
    setSelection([]);
    setStatus('idle');
    setMessage('');
  };

  const busy = status === 'reading' || status === 'validating' || status === 'importing';
  const disabled = busy || Boolean(blockedReason);
  const needsAcknowledgement = Boolean(report?.requiresAcknowledgement) && !acknowledged;

  return (
    <section className="export" data-testid="import-panel">
      <h2 className="export__title">Model import</h2>

      <p className="visual__hint">
        <code>.glb</code> — o‘zi yetarli fayl. <code>.gltf</code> — <code>.bin</code> va
        teksturalar bilan birga tanlang. <code>.obj</code> — ixtiyoriy <code>.mtl</code> va
        teksturalar bilan. Tashqi havolalar va Draco/meshopt/KTX2 siqilgan modellar qabul
        qilinmaydi.
      </p>

      <div className="field">
        <label className="field__label" htmlFor="import-model-files">
          Model fayllarini tanlash
        </label>
        <input
          id="import-model-files"
          className="field__input"
          type="file"
          multiple
          accept=".glb,.gltf,.obj,.mtl,.bin,.png,.jpg,.jpeg"
          disabled={disabled}
          onChange={(event) => {
            const files = event.target.files;
            // Reset so choosing the same set twice still fires a change.
            event.target.value = '';
            void handleFiles(files);
          }}
        />
        {blockedReason && (
          <p className="visual__hint" data-testid="import-blocked">
            {blockedReason}
          </p>
        )}
      </div>

      {selection.length > 0 && (
        <div className="field" data-testid="import-file-list">
          <span className="field__label">Tanlangan fayllar ({selection.length})</span>
          <ul className="import__files">
            {selection.map((file) => (
              <li key={file.path ?? file.name}>
                {file.path ?? file.name} · {sizeLabel(file.bytes.byteLength)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report?.format === 'obj' && (
        <div className="field">
          <label className="field__label" htmlFor="import-obj-unit">
            OBJ o‘lchov birligi
          </label>
          <select
            id="import-obj-unit"
            className="field__input"
            value={unit}
            disabled={disabled}
            onChange={(event) => handleUnitChange(event.target.value as ObjUnit)}
          >
            {(Object.keys(OBJ_UNIT_TO_CM) as ObjUnit[]).map((id) => (
              <option key={id} value={id}>
                {UNIT_LABELS[id]}
              </option>
            ))}
          </select>
          <p className="visual__hint">
            OBJ faylida birlik ko‘rsatilmaydi. Standart — santimetr: model faylda yozilgan
            o‘lchamda keladi. Boshqa birlikni tanlasangiz, o‘lcham shu birlikda deb hisoblanadi.
          </p>
        </div>
      )}

      {report && (
        <div className="field" data-testid="import-summary">
          <span className="field__label">Import xulosasi</span>
          <dl className="import__summary">
            <div>
              <dt>Format</dt>
              <dd>{FORMAT_LABELS[report.format]}</dd>
            </div>
            <div>
              <dt>Asosiy fayl</dt>
              <dd>{report.mainFile}</dd>
            </div>
            <div>
              <dt>Fayllar</dt>
              <dd>
                {report.totalFiles} · {sizeLabel(report.totalBytes)}
              </dd>
            </div>
            {report.references.total > 0 && (
              <div>
                <dt>Resurslar</dt>
                <dd data-testid="import-references">
                  {report.references.resolved} / {report.references.total} topildi
                </dd>
              </div>
            )}
            <div>
              <dt>Mesh</dt>
              <dd data-testid="import-meshes">{stats ? stats.meshes : '—'}</dd>
            </div>
            <div>
              <dt>Uchburchak</dt>
              <dd data-testid="import-triangles">{stats ? stats.triangles : '—'}</dd>
            </div>
            <div>
              <dt>Material</dt>
              <dd data-testid="import-materials">{stats ? stats.materials : '—'}</dd>
            </div>
            <div>
              <dt>Tekstura</dt>
              <dd data-testid="import-textures">{stats ? stats.textures : '—'}</dd>
            </div>
            <div>
              <dt>O‘lcham</dt>
              <dd data-testid="import-size">{stats ? boundsLabel(stats) : '—'}</dd>
            </div>
          </dl>
        </div>
      )}

      {report && report.warnings.length > 0 && (
        <div className="field" data-testid="import-warnings">
          <span className="field__label">Ogohlantirishlar</span>
          <ul className="import__warnings">
            {report.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {(report?.format === 'obj') && (
        <p className="visual__hint" data-testid="import-fidelity-note">
          OBJ/MTL materiallari soddalashtiriladi: Kd — rang, d/Tr — shaffoflik, Ns — g‘adir-budurlik
          taxmini, Ks — metallik taxmini, map_Kd — rang xaritasi, map_Bump — normal xarita. MTL
          metallik/AO/emissiv xaritalarini to‘liq ifodalay olmaydi.
        </p>
      )}

      {report?.requiresAcknowledgement && (
        <label className="field" data-testid="import-acknowledge">
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={busy}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span className="visual__hint">
            Ba’zi resurslar topilmadi. Model ularsiz (rangsiz yoki material qismisiz) import
            qilinishini tushundim.
          </span>
        </label>
      )}

      <div className="product__actions">
        <button
          type="button"
          className="export__button"
          onClick={handleConfirm}
          disabled={disabled || status !== 'ready' || needsAcknowledgement}
        >
          {status === 'importing' ? 'Qo‘shilmoqda…' : 'Import qilish'}
        </button>
        <button
          type="button"
          className="reset"
          onClick={handleCancel}
          disabled={busy || (status !== 'ready' && status !== 'error')}
        >
          Bekor qilish
        </button>
      </div>

      <p className="visual__hint" data-testid="import-session-note">
        Import qilingan model faqat shu sessiyada ishlaydi: uning to‘ri sahna bilan saqlanmaydi va
        sahifa yangilanganda yo‘qoladi. Mebel va AI funksiyalari o‘zgarishsiz ishlaydi.
      </p>

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
