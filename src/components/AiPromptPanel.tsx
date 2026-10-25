import { useState } from 'react';
import type { FurnitureParams, FurnitureType } from '../geometry/furniture';
import { localTableAdapter, unsupportedObjectsIn } from '../ai/localTableAdapter';
import { generateDesignFromCloud } from '../ai/cloudDesignAdapter';
import { AiAdapterError, type ProposalConfidence } from '../ai/types';

interface AiPromptPanelProps {
  /**
   * Called with the type and parameters of a validated result. The panel never
   * edits an existing object: the caller creates a new one.
   */
  onApply: (type: FurnitureType, params: FurnitureParams) => void;
}

type PromptStatus = 'idle' | 'working' | 'done' | 'error';

const CONFIDENCE_LABEL: Record<ProposalConfidence, string> = {
  high: 'yuqori',
  medium: "o'rta",
  low: 'past',
};

const EXAMPLES =
  'Masalan: "180x60x75 sm, yog\'och rangli stol" yoki "3 eshikli shkaf, 200 sm baland"';

export function AiPromptPanel({ onApply }: AiPromptPanelProps) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<PromptStatus>('idle');
  const [message, setMessage] = useState('');
  const [details, setDetails] = useState<string[]>([]);

  /**
   * Use the offline analyzer, but only when it can actually answer the prompt.
   *
   * It only builds tables. If the prompt names another furniture type, applying a
   * table anyway would report success for a request that was never understood, so
   * the fallback declines and the caller shows the reason instead.
   */
  const runLocalFallback = async (reason: string): Promise<boolean> => {
    const unsupported = unsupportedObjectsIn(text);
    if (unsupported.length > 0) {
      setStatus('error');
      setMessage(
        `${reason} Mahalliy tahlil faqat stolni quradi, shuning uchun "${unsupported[0]}" ` +
          "uchun natija yaratilmadi. Iltimos, qaytadan urinib ko'ring.",
      );
      setDetails([]);
      return false;
    }

    const proposal = await localTableAdapter.generate({ text });
    onApply('table', proposal.params);
    setStatus('done');
    setMessage(
      `${reason} Mahalliy tahlil ishlatildi (ishonch: ${CONFIDENCE_LABEL[proposal.confidence]}).`,
    );
    setDetails([...proposal.notes, ...proposal.warnings]);
    return true;
  };

  /** Turn a failure code into something the reader can act on. */
  const describeUnavailable = (code: string, reason: string): string => {
    if (code === 'timeout') {
      return "AI xizmati o'z vaqtida javob bermadi.";
    }
    if (code === 'busy' || code === 'too_many_parallel_jobs') {
      return "AI xizmati band. Birozdan so'ng qayta urinib ko'ring.";
    }
    if (code === 'ai_capacity_reached') {
      return "AI xizmati bugungi umumiy chegaraga yetdi.";
    }
    if (code === 'ai_unconfigured') {
      return 'Serverda AI provayderi sozlanmagan.';
    }
    if (code === 'ai_provider_error') {
      return 'AI provayderi javob bermadi.';
    }
    return reason;
  };

  const handleGenerate = async () => {
    if (status === 'working') {
      return;
    }

    setStatus('working');
    setMessage('Tahlil qilinmoqda…');
    setDetails([]);

    try {
      const outcome = await generateDesignFromCloud(text);

      if (outcome.kind === 'applied') {
        onApply(outcome.furniture as FurnitureType, outcome.params);
        setStatus('done');
        setMessage(
          `AI (${outcome.provider}) natijasi qo'llanildi: ${outcome.furniture} ` +
            `(ishonch: ${CONFIDENCE_LABEL[outcome.confidence]}).`,
        );
        setDetails([...outcome.notes, ...outcome.warnings]);
        return;
      }

      if (outcome.kind === 'unsupported') {
        setStatus('error');
        setMessage(outcome.message);
        return;
      }

      if (outcome.kind === 'rejected') {
        // The server refused this request on its own merits (allowance spent,
        // input invalid). Switching engines would hide what the reader must fix.
        setStatus('error');
        setMessage(outcome.message);
        setDetails([]);
        return;
      }

      // The service is unavailable right now (deadline, transport, throttle,
      // provider outage). The offline analyzer may stand in — if it can build this
      // prompt at all.
      await runLocalFallback(
        `${describeUnavailable(outcome.code, outcome.reason)} Server AI xizmatidan foydalanib bo'lmadi.`,
      );
    } catch (error) {
      setStatus('error');
      setMessage(
        error instanceof AiAdapterError
          ? error.message
          : "Kutilmagan xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.",
      );
      console.error('AI generatsiya xatosi:', error);
    }
  };

  const isWorking = status === 'working';

  return (
    <section className="ai">
      <h2 className="ai__title">AI orqali yaratish</h2>
      <textarea
        className="ai__input"
        rows={3}
        value={text}
        placeholder={EXAMPLES}
        aria-label="Stol tavsifi"
        onChange={(event) => setText(event.target.value)}
      />
      <button
        type="button"
        className="ai__button"
        onClick={handleGenerate}
        disabled={isWorking || text.trim() === ''}
      >
        {isWorking ? 'Yaratilmoqda…' : 'AI orqali yaratish'}
      </button>

      {message &&
        (status === 'error' ? (
          <p className="ai__message ai__message--error" role="alert">
            {message}
          </p>
        ) : (
          <p className="ai__message" role="status" aria-live="polite">
            {message}
          </p>
        ))}

      {details.length > 0 && (
        <ul className="ai__details">
          {details.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      <p className="ai__hint">
        Serverda AI provayderi sozlangan bo‘lsa u ishlatiladi. Provayder javob
        bermasa, matn tahlili mahalliy (oflayn) qoidaga asoslangan holda
        bajariladi — lekin u faqat stolni quradi. Boshqa mebel turi so‘ralsa,
        natija yaratilmaydi va sabab ko‘rsatiladi.
      </p>
    </section>
  );
}
