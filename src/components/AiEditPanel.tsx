import { useRef, useState } from 'react';
import { applyDiff, type ApplyDiffErrorCode } from '../scene/applyDiff';
import { buildDiff } from '../scene/buildDiff';
import type { SceneEditChange, SceneEditDiff } from '../scene/sceneDiff';
import type { SceneObject, SceneState } from '../scene/types';
import { EditProviderError, mockEditProvider } from '../ai/mockEditProvider';

interface AiEditPanelProps {
  scene: SceneState;
  selectedObject: SceneObject | null;
  /**
   * Records an applied state as one undo step. Wired to
   * `useSceneHistory().applyEdit`, so the panel never owns scene state.
   */
  onApply: (state: SceneState) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

type PanelStatus = 'idle' | 'working' | 'preview' | 'applied' | 'error';

interface OpenProposal {
  diff: SceneEditDiff;
  /** The revision the proposal was built against. */
  revision: number;
  objectId: string;
  prompt: string;
  notes: string[];
}

const EXAMPLES = [
  'Shkafni 20 sm kengaytir',
  "Stol rangini oq rangga o'zgartir",
  'Stolni 10 sm chapga sur',
  'Shkaf nomini Kitob javoni deb o’zgartir',
].join(' · ');

/**
 * Maps the diff/apply error vocabulary to something a user can act on.
 * Raw codes never reach the DOM.
 */
export function describeApplyError(code: ApplyDiffErrorCode): string {
  switch (code) {
    case 'stale_version':
    case 'revision_mismatch':
      return "Taklif eskirgan: sahna shu orada o'zgargan. Iltimos, taklifni qaytadan yarating.";
    case 'stale_content':
      return "Sahna taklif tayyorlangandan keyin o'zgargan. Taklifni qaytadan yarating.";
    case 'unknown_object':
      return "Tanlangan obyekt sahnada topilmadi. Ro'yxatdan qaytadan tanlang.";
    case 'type_mismatch':
      return "Obyekt turi o'zgargan. Taklifni qaytadan yarating.";
    case 'room_not_editable':
      return "Xonani bu panel orqali tahrirlab bo'lmaydi. Mebel obyektini tanlang.";
    case 'assembly_not_editable':
      return "Assembly'ni AI orqali tahrirlash bu bosqichda mavjud emas.";
    case 'out_of_range':
      return "So'ralgan qiymat ruxsat etilgan oraliqdan tashqarida.";
    case 'relation_violation':
      return "O'lchamlar bir-biriga zid: masalan, o'rindiq balandligi umumiy balandlikdan kichik bo'lishi kerak.";
    case 'unknown_field':
      return "Bu obyekt turi uchun bunday parametr mavjud emas.";
    case 'invalid_value':
      return "Qiymat formati noto'g'ri.";
    case 'invalid_preset':
      return "Bunday material mavjud emas.";
    case 'duplicate_op':
    case 'duplicate_change':
      return "Bitta buyruq bir maydonni ikki marta o'zgartirmoqda. Buyruqni soddalashtiring.";
    case 'no_change':
      return "Buyruq sahnani o'zgartirmaydi.";
    case 'reducer_mismatch':
      return "O'zgarishni xavfsiz qo'llab bo'lmadi; sahna o'zgartirilmadi.";
    default:
      return "Taklifni qo'llab bo'lmadi. Sahna o'zgartirilmadi.";
  }
}

function formatValue(change: SceneEditChange, value: number | string | boolean | null): string {
  if (value === null) {
    return '—';
  }
  if (typeof value === 'boolean') {
    return value ? "ko'rinadi" : 'yashirilgan';
  }
  if (typeof value === 'number') {
    return change.unit === 'gradus' ? `${value}°` : change.unit === 'sm' ? `${value} sm` : String(value);
  }
  return value;
}

function isColor(change: SceneEditChange, value: number | string | boolean | null): value is string {
  return change.field === 'color' && typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

/**
 * W15.9 — natural-language editing of the selected object.
 *
 * The flow is propose → preview → confirm. Nothing reaches the scene until the
 * user presses "Qo'llash", and then it goes through `buildDiff` → `applyDiff`
 * → `applyEdit`, so every W15 protection still applies.
 */
export function AiEditPanel({
  scene,
  selectedObject,
  onApply,
  undo,
  redo,
  canUndo,
  canRedo,
}: AiEditPanelProps) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<PanelStatus>('idle');
  const [message, setMessage] = useState('');
  const [proposal, setProposal] = useState<OpenProposal | null>(null);
  const [generating, setGenerating] = useState(false);

  // A ref, not state: two clicks in the same tick would both see `applying`.
  const applyLock = useRef(false);
  const requestId = useRef(0);

  // A proposal belongs to the object it was built for and to the revision it
  // was built against. Both are derived during render rather than stored, so a
  // scene edit or a new selection cannot leave a clickable stale preview
  // behind.
  const selectedId = selectedObject?.id ?? null;
  const openProposal =
    proposal !== null && proposal.objectId === selectedId ? proposal : null;
  const stale = openProposal !== null && openProposal.revision !== scene.revision;
  const busy = generating || status === 'working';

  const reset = () => {
    setProposal(null);
    setStatus('idle');
    setMessage('');
  };

  const handlePropose = async () => {
    if (busy || selectedObject === null) {
      return;
    }
    const trimmed = text.trim();
    if (trimmed === '') {
      setStatus('error');
      setMessage('Buyruq matnini kiriting.');
      return;
    }

    const ticket = requestId.current + 1;
    requestId.current = ticket;

    setGenerating(true);
    setStatus('working');
    setMessage('Taklif tayyorlanmoqda…');
    setProposal(null);

    try {
      const result = await mockEditProvider.propose({ prompt: trimmed, object: selectedObject });

      // A newer request started while this one was in flight.
      if (requestId.current !== ticket) {
        return;
      }

      const built = buildDiff(scene.data, result.ops, { baseVersion: scene.revision });
      if (!built.ok) {
        setStatus('error');
        setMessage(describeBuildError(built.code, built.message));
        return;
      }

      setProposal({
        diff: built.diff,
        revision: scene.revision,
        objectId: built.diff.objectId,
        prompt: trimmed,
        notes: result.notes,
      });
      setStatus('preview');
      setMessage('');
    } catch (error) {
      if (requestId.current !== ticket) {
        return;
      }
      setStatus('error');
      setMessage(
        error instanceof EditProviderError
          ? error.message
          : "Taklif tayyorlanmadi. Iltimos, qaytadan urinib ko'ring.",
      );
    } finally {
      if (requestId.current === ticket) {
        setGenerating(false);
      }
    }
  };

  const handleApply = () => {
    if (openProposal === null || applyLock.current) {
      return;
    }
    if (stale) {
      setStatus('error');
      setMessage(describeApplyError('stale_version'));
      return;
    }

    applyLock.current = true;
    try {
      const result = applyDiff(scene, openProposal.diff, { currentVersion: scene.revision });

      if (!result.ok) {
        setStatus('error');
        setMessage(describeApplyError(result.code));
        // A stale/concurrent failure leaves the preview visible so the user can
        // see what was proposed, but it can no longer be applied.
        if (result.code === 'stale_version' || result.code === 'stale_content' || result.code === 'revision_mismatch') {
          setProposal({ ...openProposal });
        } else {
          setProposal(null);
        }
        return;
      }

      onApply(result.state);
      setProposal(null);
      setText('');
      setStatus('applied');
      setMessage(
        `Qo'llanildi: ${result.actions.length} ta amal. «Bekor qilish» bilan qaytarish mumkin.`,
      );
    } finally {
      applyLock.current = false;
    }
  };

  const handleReject = () => {
    if (applyLock.current) {
      return;
    }
    reset();
    setMessage('Taklif rad etildi. Sahna o‘zgarmadi.');
    setStatus('idle');
  };

  return (
    <section className="aiedit" aria-label="AI tahrirlash">
      <h2 className="aiedit__title">AI bilan tahrirlash</h2>

      <p className="aiedit__target" data-testid="aiedit-target">
        {selectedObject
          ? `Tanlangan: ${selectedObject.name} (${selectedObject.type})`
          : "Obyekt tanlanmagan. Tahrirlash uchun mebel obyektini tanlang."}
      </p>

      <textarea
        className="aiedit__input"
        rows={2}
        value={text}
        placeholder={EXAMPLES}
        aria-label="Tahrirlash buyrug'i"
        maxLength={200}
        disabled={busy}
        onChange={(event) => setText(event.target.value)}
      />

      <div className="aiedit__actions">
        <button
          type="button"
          className="aiedit__button"
          onClick={handlePropose}
          disabled={busy || selectedObject === null || text.trim() === ''}
          data-testid="aiedit-propose"
        >
          {busy ? 'Tayyorlanmoqda…' : 'Taklif yaratish'}
        </button>
      </div>

      {message && (
        <p
          className={
            status === 'error'
              ? 'aiedit__message aiedit__message--error'
              : status === 'applied'
                ? 'aiedit__message aiedit__message--ok'
                : 'aiedit__message'
          }
          role={status === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          data-testid="aiedit-message"
        >
          {message}
        </p>
      )}

      {stale && openProposal && (
        <p className="aiedit__message aiedit__message--error" role="alert" data-testid="aiedit-stale">
          Sahna bu taklifdan keyin o‘zgardi. Taklifni qaytadan yarating.
        </p>
      )}

      {openProposal && (
        <div className="aiedit__preview" data-testid="aiedit-preview">
          <h3 className="aiedit__preview-title">
            Taklif: {openProposal.diff.objectId}
          </h3>
          <table className="aiedit__table">
            <thead>
              <tr>
                <th scope="col">Xususiyat</th>
                <th scope="col">Hozir</th>
                <th scope="col">Keyin</th>
              </tr>
            </thead>
            <tbody>
              {openProposal.diff.changes.map((change) => (
                <tr key={`${change.kind}:${change.field}`} data-testid="aiedit-change">
                  <th scope="row">{change.label}</th>
                  <td>{renderValue(change, change.before)}</td>
                  <td>{renderValue(change, change.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {openProposal.notes.length > 0 && (
            <ul className="aiedit__notes">
              {openProposal.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}

          <div className="aiedit__actions">
            <button
              type="button"
              className="aiedit__button"
              onClick={handleApply}
              disabled={stale || busy}
              data-testid="aiedit-apply"
            >
              Qo‘llash
            </button>
            <button
              type="button"
              className="aiedit__button aiedit__button--ghost"
              onClick={handleReject}
              disabled={busy}
              data-testid="aiedit-reject"
            >
              Rad etish
            </button>
          </div>
        </div>
      )}

      <div className="aiedit__history">
        <button
          type="button"
          className="aiedit__button aiedit__button--ghost"
          onClick={undo}
          disabled={!canUndo}
          data-testid="aiedit-undo"
        >
          Bekor qilish
        </button>
        <button
          type="button"
          className="aiedit__button aiedit__button--ghost"
          onClick={redo}
          disabled={!canRedo}
          data-testid="aiedit-redo"
        >
          Qaytarish
        </button>
      </div>

      <p className="aiedit__hint">
        Haqiqiy LLM ishlatilmaydi: buyruq mahalliy deterministik qoidalar bilan tahlil
        qilinadi. Qo‘llangan o‘zgarish bitta «Bekor qilish» bilan qaytariladi.
      </p>
    </section>
  );
}

function renderValue(change: SceneEditChange, value: number | string | boolean | null) {
  if (isColor(change, value)) {
    return (
      <span className="aiedit__swatch-row">
        <span className="aiedit__swatch" style={{ background: value }} aria-hidden="true" />
        {value}
      </span>
    );
  }
  return formatValue(change, value);
}

/** Build failures happen before a preview exists, so they get their own text. */
function describeBuildError(code: string, fallback: string): string {
  switch (code) {
    case 'unsupported':
    case 'ambiguous':
      return fallback;
    case 'no_change':
      return "Buyruq sahnani o'zgartirmaydi (qiymat allaqachon shunday).";
    case 'unknown_field':
      return "Bu obyekt turi uchun bunday parametr mavjud emas.";
    case 'out_of_range':
      return "So'ralgan qiymat ruxsat etilgan oraliqdan tashqarida.";
    case 'relation_violation':
      return "O'lchamlar bir-biriga zid. Boshqa qiymat bilan urinib ko'ring.";
    case 'room_not_editable':
    case 'assembly_not_editable':
      return "Bu obyektni AI orqali tahrirlab bo'lmaydi.";
    case 'unknown_object':
      return "Obyekt sahnada topilmadi. Ro'yxatdan qaytadan tanlang.";
    default:
      return fallback;
  }
}
