import { useRef, useState } from 'react';
import { getFurnitureParameters } from '../scene/configurator';
import { diffSpecs, type SpecPreview } from '../scene/preview';
import { usageWarningMessage } from '../ai/budget';
import { MAX_INTENT_PROMPT_LENGTH, generateFurnitureIntent, type IntentGeneration } from '../ai/intent';
import type { SceneObject, SceneSpec } from '../scene/types';

interface AiEditPanelProps {
  object: SceneObject | null;
  preview: SpecPreview | null;
  canUndo: boolean;
  canRedo: boolean;
  onPreview: (preview: SpecPreview) => void;
  onApply: (spec: SceneSpec) => void;
  onCancel: () => void;
  onUndo: () => void;
  onRedo: () => void;
  /** Injection point for tests; production uses the real service. */
  generate?: (options: {
    prompt: string;
    currentDefinitionId?: string;
    currentSpec?: SceneSpec;
  }) => Promise<IntentGeneration>;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'clarification'; question: string }
  | { kind: 'error'; message: string };

function formatValue(value: number | string | boolean | undefined): string {
  return value === undefined ? '—' : String(value);
}

/**
 * Stage 3.4 — natural-language editing of the selected universal object.
 *
 * A proposal only ever becomes a preview: the scene keeps its applied spec until
 * `Apply`, and the preview disappears when the object, its spec or the selection
 * changes.
 */
export function AiEditPanel({
  object,
  preview,
  canUndo,
  canRedo,
  onPreview,
  onApply,
  onCancel,
  onUndo,
  onRedo,
  generate = generateFurnitureIntent,
}: AiEditPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [lastPrompt, setLastPrompt] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [usageWarning, setUsageWarning] = useState<string | null>(null);
  const running = useRef(false);

  const previewApplicable =
    preview && object && preview.objectId === object.id && preview.baseSpec === object.spec
      ? preview
      : null;

  if (!object || object.definitionId === undefined || object.spec === undefined) {
    return null;
  }

  const definitionId = object.definitionId;
  const currentSpec = object.spec;
  const loading = status.kind === 'loading';
  const parameters = getFurnitureParameters(definitionId);
  const changes = previewApplicable ? diffSpecs(object.spec, previewApplicable.spec) : [];
  const labelFor = (key: string) =>
    parameters?.parameters.find((parameter) => parameter.key === key)?.label ?? key;

  const run = async (text: string) => {
    if (running.current || text.trim() === '') {
      return;
    }
    running.current = true;
    setStatus({ kind: 'loading' });
    setUsageWarning(null);
    try {
      const result = await generate({
        prompt: text,
        currentDefinitionId: definitionId,
        currentSpec,
      });
      if (result.kind === 'success') {
        onPreview({
          objectId: object.id,
          definitionId: result.intent.definitionId,
          baseSpec: currentSpec,
          spec: result.spec,
        });
        setLastPrompt(text);
        setUsageWarning(usageWarningMessage(result.usageError));
        setStatus({ kind: 'idle' });
      } else if (result.kind === 'clarification') {
        setStatus({ kind: 'clarification', question: result.question });
      } else {
        setStatus({ kind: 'error', message: result.message });
      }
    } catch {
      setStatus({ kind: 'error', message: 'AI xizmatida kutilmagan xatolik yuz berdi.' });
    } finally {
      running.current = false;
    }
  };

  return (
    <section className="ai-edit" aria-labelledby="ai-edit-title" aria-busy={loading}>
      <h2 className="ai-edit__title" id="ai-edit-title">
        AI bilan tahrirlash
      </h2>
      <p className="ai-edit__hint">
        Tanlangan: {parameters?.label ?? definitionId}. Masalan: „kengligini 180 sm qil“ yoki
        „balandligini 5 sm oshir“.
      </p>

      <form
        className="ai-edit__form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(prompt);
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="ai-edit-prompt">
            O‘zgartirish
          </label>
          <textarea
            id="ai-edit-prompt"
            className="field__input ai-edit__input"
            rows={2}
            maxLength={MAX_INTENT_PROMPT_LENGTH}
            value={prompt}
            disabled={loading}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </div>
        <div className="ai-edit__actions">
          <button
            type="submit"
            className="ai-edit__primary"
            disabled={loading || prompt.trim() === ''}
          >
            {loading ? 'Tayyorlanmoqda…' : 'Taklif qilish'}
          </button>
          <button
            type="button"
            className="ai-edit__secondary"
            disabled={loading || lastPrompt === ''}
            onClick={() => void run(lastPrompt)}
          >
            Qayta
          </button>
        </div>
      </form>

      {loading ? (
        <p className="ai-edit__status" role="status">
          O‘zgarish tayyorlanmoqda…
        </p>
      ) : null}

      {status.kind === 'error' ? (
        <p className="field__error" role="alert">
          {status.message}
        </p>
      ) : null}

      {status.kind === 'clarification' ? (
        <p className="ai-edit__question" role="status">
          {status.question}
        </p>
      ) : null}

      {usageWarning ? (
        <p className="usage-warning" role="status">
          {usageWarning}
        </p>
      ) : null}

      {previewApplicable ? (
        <div className="ai-edit__preview">
          <p className="ai-edit__preview-title">Taklif: {object.name}</p>
          {changes.length === 0 ? (
            <p className="ai-edit__status">O‘zgarish yo‘q.</p>
          ) : (
            <ul className="ai-edit__changes">
              {changes.map((change) => (
                <li key={change.key}>
                  <span>{labelFor(change.key)}</span>
                  <span className="ai-edit__change">
                    {formatValue(change.before)} → {formatValue(change.after)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="ai-edit__actions">
            <button
              type="button"
              className="ai-edit__primary"
              onClick={() => onApply(previewApplicable.spec)}
            >
              Apply
            </button>
            <button type="button" className="ai-edit__secondary" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="ai-edit__history">
        <button type="button" className="ai-edit__secondary" disabled={!canUndo} onClick={onUndo}>
          Undo
        </button>
        <button type="button" className="ai-edit__secondary" disabled={!canRedo} onClick={onRedo}>
          Redo
        </button>
      </div>
    </section>
  );
}
