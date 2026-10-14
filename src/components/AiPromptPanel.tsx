import { useState } from 'react';
import type { TableParams } from '../geometry/tableParams';
import { localTableAdapter } from '../ai/localTableAdapter';
import { generateDesignFromCloud } from '../ai/cloudDesignAdapter';
import { AiAdapterError, type ProposalConfidence } from '../ai/types';

interface AiPromptPanelProps {
  onApply: (params: TableParams) => void;
}

type PromptStatus = 'idle' | 'working' | 'done' | 'error';

const CONFIDENCE_LABEL: Record<ProposalConfidence, string> = {
  high: 'yuqori',
  medium: "o'rta",
  low: 'past',
};

const EXAMPLES = 'Masalan: "180x60x75 sm, yog\'och rangli stol"';

export function AiPromptPanel({ onApply }: AiPromptPanelProps) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<PromptStatus>('idle');
  const [message, setMessage] = useState('');
  const [details, setDetails] = useState<string[]>([]);

  const runLocalFallback = async (reason: string) => {
    const proposal = await localTableAdapter.generate({ text });
    onApply(proposal.params);
    setStatus('done');
    setMessage(
      `${reason} Mahalliy tahlil ishlatildi (ishonch: ${CONFIDENCE_LABEL[proposal.confidence]}).`,
    );
    setDetails([...proposal.notes, ...proposal.warnings]);
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
        onApply(outcome.params);
        setStatus('done');
        setMessage(
          `AI (${outcome.provider}) natijasi qo'llanildi (ishonch: ${CONFIDENCE_LABEL[outcome.confidence]}).`,
        );
        setDetails([...outcome.notes, ...outcome.warnings]);
        return;
      }

      if (outcome.kind === 'unsupported') {
        setStatus('error');
        setMessage(outcome.message);
        return;
      }

      // Cloud unavailable (not signed in, unconfigured, invalid output, network):
      // fall back to the offline analyzer with a clear message.
      await runLocalFallback(`Server AI xizmatidan foydalanib bo'lmadi (${outcome.reason}).`);
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
        Serverda AI provayderi sozlangan bo'lsa u ishlatiladi; aks holda (yoki
        tizimga kirmagan bo'lsangiz) matn tahlili mahalliy (oflayn) qoidaga
        asoslangan holda bajariladi.
      </p>
    </section>
  );
}
