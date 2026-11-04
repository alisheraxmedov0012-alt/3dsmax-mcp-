import { useRef, useState } from 'react';
import { getFurnitureParameters } from '../scene/configurator';
import { usageWarningMessage } from '../ai/budget';
import {
  MAX_INTENT_PROMPT_LENGTH,
  generateFurnitureIntent,
  type IntentGeneration,
} from '../ai/intent';
import type { SceneSpec } from '../scene/types';

interface AiFurniturePanelProps {
  /** Receives a validated canonical spec; the caller adds the object. */
  onCreate: (definitionId: string, spec: SceneSpec) => void;
  /** Injection point for tests; production uses the real service. */
  generate?: (options: { prompt: string }) => Promise<IntentGeneration>;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'clarification'; question: string }
  | { kind: 'error'; message: string }
  | { kind: 'success'; label: string; warning: string | null };

/**
 * Stage 3.3 — text-to-furniture prompt.
 *
 * The panel only displays states: typing, waiting, a clarification question, an
 * error, or success. It never creates an object itself — the validated canonical
 * spec goes to `onCreate`, which dispatches `ADD_UNIVERSAL_FURNITURE`.
 */
export function AiFurniturePanel({ onCreate, generate = generateFurnitureIntent }: AiFurniturePanelProps) {
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const running = useRef(false);

  const loading = status.kind === 'loading';

  const run = async (text: string) => {
    if (running.current) {
      return;
    }
    running.current = true;
    setStatus({ kind: 'loading' });
    try {
      const result = await generate({ prompt: text });
      if (result.kind === 'success') {
        onCreate(result.intent.definitionId, result.spec);
        const label =
          getFurnitureParameters(result.intent.definitionId)?.label ?? result.intent.definitionId;
        setStatus({
          kind: 'success',
          label,
          warning: usageWarningMessage(result.usageError),
        });
        setPrompt('');
        setAnswer('');
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
    <section className="ai-furniture" aria-labelledby="ai-furniture-title" aria-busy={loading}>
      <h2 className="ai-furniture__title" id="ai-furniture-title">
        AI bilan mebel yaratish
      </h2>
      <p className="ai-furniture__hint">
        O‘zbek, rus yoki ingliz tilida yozing. Masalan: „160 sm kenglikdagi kompyuter stoli“.
      </p>

      <form
        className="ai-furniture__form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(prompt);
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="ai-furniture-prompt">
            Tavsif
          </label>
          <textarea
            id="ai-furniture-prompt"
            className="field__input ai-furniture__input"
            rows={3}
            maxLength={MAX_INTENT_PROMPT_LENGTH}
            value={prompt}
            disabled={loading}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </div>
        <button
          type="submit"
          className="ai-furniture__submit"
          disabled={loading || prompt.trim() === ''}
        >
          {loading ? 'Yaratilmoqda…' : 'Yaratish'}
        </button>
      </form>

      {loading ? (
        <p className="ai-furniture__status" role="status">
          Tavsif tahlil qilinmoqda…
        </p>
      ) : null}

      {status.kind === 'error' ? (
        <p className="field__error" role="alert">
          {status.message}
        </p>
      ) : null}

      {status.kind === 'clarification' ? (
        <div className="ai-furniture__clarify">
          <p className="ai-furniture__question" role="status">
            {status.question}
          </p>
          <div className="field">
            <label className="field__label" htmlFor="ai-furniture-answer">
              Javob
            </label>
            <input
              id="ai-furniture-answer"
              className="field__input"
              type="text"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="ai-furniture__submit"
            disabled={answer.trim() === ''}
            onClick={() => void run(`${prompt} ${answer}`.trim())}
          >
            Yuborish
          </button>
        </div>
      ) : null}

      {status.kind === 'success' ? (
        <>
          <p className="ai-furniture__success" role="status">
            {status.label} sahnaga qo‘shildi.
          </p>
          {status.warning ? (
            <p className="usage-warning" role="status">
              {status.warning}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
