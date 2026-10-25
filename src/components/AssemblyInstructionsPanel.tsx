/**
 * C6 — the assembly-instructions section of the manufacturing panel.
 *
 * Presentational only: the plan is built by `assemblyInstructions` and the panel
 * that owns the model decides when to build it. What this component adds is the
 * distinction the module itself cannot make for the reader — a step whose
 * relationship is stored in the model reads differently from one that is only
 * generic positioning advice, and both read differently from an error.
 *
 * Fastening hardware is never shown, because the plan never contains any. The
 * limitations block is rendered on every path, including the empty one, so a
 * reader cannot mistake a short manual for a complete one.
 */
import {
  ASSEMBLY_RELATION_LABELS,
  ASSEMBLY_STATUS_LABELS,
  type AssemblyPlan,
  type AssemblyStep,
} from '../manufacturing/assemblyInstructions';

interface AssemblyInstructionsPanelProps {
  /** The plan currently shown, or null before one has been generated. */
  plan: AssemblyPlan | null;
  /** True when the model changed after this plan was built. */
  stale: boolean;
  /** Build (or rebuild) a plan from the current model. */
  onGenerate: () => void;
}

function partSummary(step: AssemblyStep): string[] {
  return step.parts.map((part) => {
    const size = part.sizeMm
      ? `${part.sizeMm.x}×${part.sizeMm.y}×${part.sizeMm.z} mm`
      : "o'lcham noaniq";
    return `${part.name} (${part.partId}) × ${part.quantity} — ${size}`;
  });
}

function StepItem({ step }: { step: AssemblyStep }) {
  return (
    <li className="assembly-step" data-testid={`assembly-step-${step.order}`}>
      <p className="assembly-step__title">
        {step.order}. {step.title}
        <span
          className={`assembly-step__source assembly-step__source--${step.relation}`}
          data-testid={`assembly-source-${step.order}`}
        >
          {ASSEMBLY_RELATION_LABELS[step.relation]}
        </span>
      </p>
      <p className="assembly-step__instruction">{step.instruction}</p>
      <ul className="assembly-step__parts">
        {partSummary(step).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {step.dependsOn.length > 0 && (
        <p className="assembly-step__depends">
          Avval bajarilishi kerak: {step.dependsOn.join(', ')}
        </p>
      )}
    </li>
  );
}

export function AssemblyInstructionsPanel({
  plan,
  stale,
  onGenerate,
}: AssemblyInstructionsPanelProps) {
  return (
    <div className="field assembly" data-testid="assembly-instructions">
      <span className="field__label">Montaj yo‘riqnomasi</span>

      <button
        type="button"
        className="visual-reset manufacturing__package-button"
        onClick={onGenerate}
        data-testid="assembly-generate"
      >
        {plan ? 'Montaj yo‘riqnomasini yangilash' : 'Montaj yo‘riqnomasini yaratish'}
      </button>

      {stale && (
        <p className="render__message render__message--error" role="alert" data-testid="assembly-stale">
          Model o‘zgargan — quyida eski reja ko‘rsatilmoqda. Yangilash tugmasini bosing.
        </p>
      )}

      {!plan && (
        <p className="visual__hint">
          Qadamlar modeldagi detallar va ularning rollari asosida tuziladi.
        </p>
      )}

      {plan && (
        <>
          <p className="visual__hint" data-testid="assembly-status">
            {plan.modelLabel} · {ASSEMBLY_STATUS_LABELS[plan.status]}
          </p>

          {plan.steps.length === 0 ? (
            <p className="render__message render__message--error" role="alert">
              {plan.issues.find((issue) => issue.level === 'error')?.message ??
                'Bu model uchun ishonchli qadamlar tuzilmadi.'}
            </p>
          ) : (
            <ol className="assembly__steps" data-testid="assembly-steps">
              {plan.steps.map((step) => (
                <StepItem key={step.id} step={step} />
              ))}
            </ol>
          )}

          {plan.issues.length > 0 && (
            <ul className="manufacturing__validation-list" data-testid="assembly-issues">
              {plan.issues.map((issue) => (
                <li
                  key={`${issue.code}-${issue.stepId ?? 'all'}-${issue.message}`}
                  className={`manufacturing__validation-item manufacturing__validation-item--${
                    issue.level === 'error' ? 'error' : 'warning'
                  }`}
                >
                  <strong>{issue.level === 'error' ? 'Xatolik' : 'Ogohlantirish'}</strong>
                  {issue.stepId ? ` · ${issue.stepId}` : ''} · {issue.code}: {issue.message}
                </li>
              ))}
            </ul>
          )}

          <ul className="image-ref__warnings" data-testid="assembly-limitations">
            {plan.limitations.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
