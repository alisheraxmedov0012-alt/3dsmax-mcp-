import { useState } from 'react';
import { ASSEMBLY_KINDS, type AssemblyKind, type SceneAssembly } from '../scene/types';
import { assembliesEnabled } from '../geometry/assemblies/flag';
import { assemblyDefaults, validateAssemblyParams } from '../geometry/assemblies/params';
import { buildAssembly } from '../geometry/assemblies';
import { AssemblyError, MAX_ASSEMBLIES_PER_SCENE } from '../geometry/assemblies/limits';

const KIND_LABELS: Record<AssemblyKind, string> = {
  'kitchen-base-run': 'Oshxona pastki moduli',
  'wall-cabinet': 'Osma oshxona shkafi',
  'wardrobe-section': 'Shkaf seksiyasi',
  'stair-straight': "To'g'ri zinapoya",
};

interface AssemblyPanelProps {
  assemblies: SceneAssembly[];
  onAdd: (assembly: SceneAssembly) => void;
  onDelete: (id: string) => void;
}

function newId(): string {
  return `asm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * W14 — minimal assembly panel, behind the assembly flag.
 *
 * Scope is deliberately small (approved OD-2): create from the kind defaults,
 * list what exists, delete. There is no editor yet and no AI generation — the
 * parameters are the defaults and can be changed later. Nothing here claims the
 * result is manufacturing-ready.
 *
 * The panel builds the assembly once on create to prove the parameters are
 * buildable; a failure is shown and nothing is added.
 */
export function AssemblyPanel({ assemblies, onAdd, onDelete }: AssemblyPanelProps) {
  const [kind, setKind] = useState<AssemblyKind>('wall-cabinet');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle');

  if (!assembliesEnabled()) {
    return null;
  }

  const atCap = assemblies.length >= MAX_ASSEMBLIES_PER_SCENE;

  const handleAdd = () => {
    if (atCap) {
      setStatus('error');
      setMessage(`Ko'pi bilan ${MAX_ASSEMBLIES_PER_SCENE} ta assembly qo'shish mumkin.`);
      return;
    }

    const params = validateAssemblyParams(kind, assemblyDefaults(kind));
    if (params === null) {
      setStatus('error');
      setMessage("Parametrlar tekshiruvdan o'tmadi.");
      return;
    }

    try {
      // Prove it builds before it enters the scene, so the list never contains a
      // construction that cannot be rendered.
      buildAssembly(kind, params).dispose();
    } catch (error) {
      setStatus('error');
      setMessage(
        error instanceof AssemblyError
          ? error.message
          : "Assembly'ni qurib bo'lmadi. Iltimos, qayta urinib ko'ring.",
      );
      return;
    }

    onAdd({ id: newId(), kind, params: params as unknown as Record<string, unknown> });
    setStatus('ok');
    setMessage(`${KIND_LABELS[kind]} qo'shildi.`);
  };

  const handleDelete = (assembly: SceneAssembly) => {
    onDelete(assembly.id);
    setStatus('ok');
    setMessage(`${KIND_LABELS[assembly.kind]} o'chirildi.`);
  };

  return (
    <section className="assembly-panel">
      <h2 className="assembly-panel__title">Assembly'lar (tajriba)</h2>

      <div className="field">
        <label className="field__label" htmlFor="assembly-kind">
          Tur
        </label>
        <select
          id="assembly-kind"
          className="field__input"
          value={kind}
          onChange={(event) => setKind(event.target.value as AssemblyKind)}
        >
          {ASSEMBLY_KINDS.map((entry) => (
            <option key={entry} value={entry}>
              {KIND_LABELS[entry]}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        className="assembly-panel__add"
        onClick={handleAdd}
        disabled={atCap}
      >
        {atCap ? 'Limitga yetildi' : "Assembly qo'shish"}
      </button>

      {message &&
        (status === 'error' ? (
          <p className="render__message render__message--error" role="alert">
            {message}
          </p>
        ) : (
          <p className="render__message" role="status" aria-live="polite">
            {message}
          </p>
        ))}

      {assemblies.length === 0 ? (
        <p className="visual__hint">Hozircha assembly yo'q.</p>
      ) : (
        <ul className="assembly-panel__list">
          {assemblies.map((assembly) => (
            <li key={assembly.id} className="assembly-row">
              <span className="assembly-row__name">{KIND_LABELS[assembly.kind]}</span>
              <button
                type="button"
                className="assembly-row__delete"
                onClick={() => handleDelete(assembly)}
                aria-label={`${KIND_LABELS[assembly.kind]} assembly o'chirish`}
              >
                O'chirish
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="visual__hint">
        Hozircha faqat standart parametrlar bilan yaratish mumkin. Assembly detallari
        ro'yxati hozircha «Ishlab chiqarish» bo'limida ko'rsatilmaydi, va bu
        ishlab chiqarishga tayyor hujjat emas.
      </p>
    </section>
  );
}
