/**
 * Phase 6.2.1 — GLB import.
 *
 * The panel is the confirmation step, not the pipeline: it reads the file, asks
 * `parseModelFile` to validate and parse it into a detached model, shows what was
 * measured, and only then hands the model to the app. Nothing reaches the scene
 * until the user confirms, and a rejected or cancelled import returns the model to
 * the parser for disposal.
 *
 * Two honesty rules shape the UI:
 *
 * 1. The summary describes the *parsed* geometry (the size is measured in
 *    centimetres after the unit conversion), not the name or the byte count.
 * 2. Imported models are session-only and the panel says so before the confirm
 *    button is reachable — the scene keeps their metadata but not their meshes.
 */
import { useEffect, useRef, useState } from 'react';
import { ImportError } from '../import/importErrors';
import { parseModelFile, type ParsedImport } from '../import/parseModel';
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

type Status = 'idle' | 'validating' | 'ready' | 'importing' | 'success' | 'error';

function describeFailure(error: unknown): string {
  if (error instanceof ImportError) {
    return error.message;
  }
  return "Modelni o'qib bo'lmadi: kutilmagan xato.";
}

/**
 * Reads the picked file into memory.
 *
 * `FileReader` rather than `Blob.arrayBuffer()`: the latter is missing from the
 * older Android WebViews this build still targets, and a single supported path is
 * also the one the tests exercise.
 */
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

function sizeLabel(meta: ImportedModelMeta): string {
  const { min, max } = meta.boundsCm;
  const axis = (from: number, to: number): string => (to - from).toFixed(1);
  return `${axis(min.x, max.x)} × ${axis(min.y, max.y)} × ${axis(min.z, max.z)} sm`;
}

function fileLabel(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImportPanel({ blockedReason, onImport }: ImportPanelProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [summary, setSummary] = useState<ImportedModelMeta | null>(null);

  // The parsed model outlives a single render, and it owns GPU memory, so it lives
  // in a ref that every exit path clears exactly once.
  const pending = useRef<ParsedImport | null>(null);
  const abort = useRef<AbortController | null>(null);

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
    setSummary(null);
  };

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file || blockedReason) {
      return;
    }
    abort.current?.abort();
    releasePending();

    const controller = new AbortController();
    abort.current = controller;
    setStatus('validating');
    setMessage('Fayl tekshirilmoqda…');

    try {
      const bytes = await readFileBytes(file);
      if (controller.signal.aborted) {
        return;
      }
      const parsed = await parseModelFile({ name: file.name, bytes }, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        parsed.dispose();
        return;
      }
      pending.current = parsed;
      setSummary(parsed.meta);
      setStatus('ready');
      setMessage("Fayl tekshiruvdan o'tdi. Sahnaga qo'shishdan oldin ma'lumotlarni ko'rib chiqing.");
    } catch (error) {
      if (error instanceof ImportError && error.code === 'aborted') {
        return;
      }
      if (!(error instanceof ImportError)) {
        console.error('Model import xatosi:', error);
      }
      setStatus('error');
      setMessage(describeFailure(error));
    }
  };

  const handleConfirm = (): void => {
    const parsed = pending.current;
    if (!parsed || blockedReason) {
      return;
    }
    setStatus('importing');
    try {
      onImport(parsed);
      pending.current = null;
      setSummary(null);
      setStatus('success');
      setMessage(`"${parsed.meta.fileName}" sahnaga qo'shildi.`);
    } catch (error) {
      // The model never reached the scene, so it is still ours to release.
      parsed.dispose();
      pending.current = null;
      setSummary(null);
      setStatus('error');
      setMessage(describeFailure(error));
    }
  };

  const handleCancel = (): void => {
    abort.current?.abort();
    releasePending();
    setStatus('idle');
    setMessage('');
  };

  const busy = status === 'validating' || status === 'importing';
  const disabled = busy || Boolean(blockedReason);

  return (
    <section className="export" data-testid="import-panel">
      <h2 className="export__title">Model import</h2>

      <p className="visual__hint">
        Faqat <code>.glb</code> (glTF 2.0, ichiga joylangan resurslar bilan). Tashqi fayllarga
        havola qiluvchi va Draco/meshopt/KTX2 siqilgan modellar qabul qilinmaydi.
      </p>

      <div className="field">
        <label className="field__label" htmlFor="import-glb-file">
          GLB faylni tanlash
        </label>
        <input
          id="import-glb-file"
          className="field__input"
          type="file"
          accept=".glb,model/gltf-binary"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset so choosing the same file twice still fires a change.
            event.target.value = '';
            void handleFile(file);
          }}
        />
        {blockedReason && (
          <p className="visual__hint" data-testid="import-blocked">
            {blockedReason}
          </p>
        )}
      </div>

      {summary && (
        <div className="field" data-testid="import-summary">
          <span className="field__label">Import xulosasi</span>
          <dl className="import__summary">
            <div>
              <dt>Fayl</dt>
              <dd>{summary.fileName}</dd>
            </div>
            <div>
              <dt>Hajm</dt>
              <dd>{fileLabel(summary.sourceBytes)}</dd>
            </div>
            <div>
              <dt>Mesh</dt>
              <dd>{summary.meshes}</dd>
            </div>
            <div>
              <dt>Uchburchak</dt>
              <dd>{summary.triangles}</dd>
            </div>
            <div>
              <dt>Material</dt>
              <dd>{summary.materials}</dd>
            </div>
            <div>
              <dt>Tekstura</dt>
              <dd>{summary.textures}</dd>
            </div>
            <div>
              <dt>O‘lcham</dt>
              <dd data-testid="import-size">{sizeLabel(summary)}</dd>
            </div>
          </dl>
        </div>
      )}

      <div className="product__actions">
        <button
          type="button"
          className="export__button"
          onClick={handleConfirm}
          disabled={disabled || status !== 'ready'}
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
