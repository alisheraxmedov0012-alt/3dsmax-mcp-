import { useState } from 'react';
import type { FurnitureParams, FurnitureType } from '../geometry/furniture';
import { generateDesign, type GeneratedDesign } from '../ai/generateDesign';
import type { MaterialPresetId } from '../materials/types';
import { AiAdapterError, type ProposalConfidence } from '../ai/types';

interface AiPromptPanelProps {
  /**
   * Called with the type, parameters and — when the AI named one — the PBR
   * material preset of a validated result. The panel never edits an existing
   * object: the caller creates a new one.
   */
  onApply: (
    type: FurnitureType,
    params: FurnitureParams,
    materialPresetId: MaterialPresetId | null,
  ) => void;
  /**
   * False in a frontend-only build, where no server AI can exist. The cloud
   * request is then skipped instead of failing first, and the panel says so.
   * Defaults to true so the panel keeps its normal cloud path when embedded
   * without the app-level flag.
   */
  backendConfigured?: boolean;
}

type PromptStatus = 'idle' | 'working' | 'done' | 'error';

const CONFIDENCE_LABEL: Record<ProposalConfidence, string> = {
  high: 'yuqori',
  medium: "o'rta",
  low: 'past',
};

const EXAMPLES =
  'Masalan: "180x60x75 sm, yog\'och rangli stol" yoki "3 eshikli shkaf, 200 sm baland"';

export function AiPromptPanel({ onApply, backendConfigured = true }: AiPromptPanelProps) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<PromptStatus>('idle');
  const [message, setMessage] = useState('');
  const [details, setDetails] = useState<string[]>([]);

  /**
   * Prefix for an offline result: why the cloud was not used.
   *
   * The offline analyzer now builds all eight types, so the only remaining reason
   * to refuse is a prompt that names no buildable type — and the orchestrator
   * reports that as `unsupported` instead of applying something.
   */
  const fallbackPrefix = (design: GeneratedDesign): string => {
    if (design.fallbackCode === 'backend_missing') {
      return `${design.fallbackReason ?? ''} `;
    }
    const reason = design.fallbackReason ?? '';
    const description =
      design.fallbackCode !== undefined
        ? describeUnavailable(design.fallbackCode, reason)
        : reason;
    return `${description} Server AI xizmatidan foydalanib bo'lmadi.`;
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
      const result = await generateDesign(text, { backendConfigured });

      if (result.kind === 'applied') {
        const { design } = result;
        onApply(design.furniture, design.params, design.materialPresetId);
        setStatus('done');
        setDetails([...design.notes, ...design.warnings]);
        setMessage(
          design.source === 'cloud'
            ? `AI (${design.provider}) natijasi qo'llanildi: ${design.furniture} ` +
                `(ishonch: ${CONFIDENCE_LABEL[design.confidence]}).`
            : `${fallbackPrefix(design)} AI ishlatilmadi — natija mahalliy qoidalar asosida ` +
                `yaratildi (ishonch: ${CONFIDENCE_LABEL[design.confidence]}).`,
        );
        return;
      }

      // `unsupported` and `rejected` are both refusals: nothing was applied and the
      // reason must be shown as-is instead of being papered over by another engine.
      setStatus('error');
      setMessage(result.message);
      setDetails([]);
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
        aria-label="Mebel tavsifi"
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

      {backendConfigured ? (
        <p className="ai__hint">
          Serverda AI provayderi sozlangan bo‘lsa u ishlatiladi. Provayder javob
          bermasa, matn tahlili mahalliy (oflayn) qoidaga asoslangan holda
          bajariladi va barcha qo‘llab-quvvatlanadigan mebel turlarini quradi.
          Tanish bo‘lmagan tur so‘ralsa, natija yaratilmaydi va sabab ko‘rsatiladi.
        </p>
      ) : (
        <p className="ai__hint" data-testid="ai-backend-unavailable">
          Bu versiyada server AI ulanmagan. So‘rov mahalliy qoidalar asosida
          tahlil qilinadi va barcha qo‘llab-quvvatlanadigan mebel turlarini
          yaratadi. Tanish bo‘lmagan tur so‘ralsa, natija yaratilmaydi va sabab
          ko‘rsatiladi.
        </p>
      )}
    </section>
  );
}
