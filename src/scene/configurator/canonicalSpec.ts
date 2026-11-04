/**
 * Stage 3.1 — light canonicalisation, without geometry.
 *
 * Structural normalisation plus the definition parser: it fills defaults and
 * rejects unknown or mistyped channels, but it never creates a plan and never
 * touches Three.js. That is what makes it safe for the reducer, which must stay a
 * pure state transition; full buildability (plan + geometry budgets) lives in
 * `updateFurnitureSpec`.
 */
import { getFurnitureDefinition } from '../../geometry/universal/registry';
import { normalizeSceneSpec, type SceneSpec } from '../types';
import type { SpecUpdateIssue } from './updateSpec';

export type CanonicalSpecResult =
  | { readonly ok: true; readonly definitionId: string; readonly spec: SceneSpec }
  | { readonly ok: false; readonly issues: readonly SpecUpdateIssue[] };

/**
 * Definition parsers prefix their messages with the offending channel
 * (`width: ...`), so the key can be recovered without re-implementing their
 * validation rules.
 */
export function keysFromMessages(
  messages: readonly string[],
  known: ReadonlySet<string>,
): string[] {
  const found = new Set<string>();
  for (const message of messages) {
    for (const key of known) {
      if (message.startsWith(`${key}:`)) {
        found.add(key);
        break;
      }
    }
  }
  return [...found];
}

/**
 * Returns the canonical (defaults-filled) spec for a definition, or the parser's
 * issues. No plan is created, so this is cheap enough for a state transition.
 */
export function canonicalizeFurnitureSpec(
  definitionId: string,
  spec: unknown,
): CanonicalSpecResult {
  const definition = getFurnitureDefinition(definitionId.trim());
  if (!definition) {
    return {
      ok: false,
      issues: [{ code: 'unknown_definition', message: `Definition "${definitionId}" topilmadi.` }],
    };
  }

  const normalized = normalizeSceneSpec(spec);
  if (!normalized) {
    return {
      ok: false,
      issues: [
        {
          code: 'invalid_spec',
          message: "Spec obyekt bo'lishi va faqat JSON scalar qiymatlardan iborat bo'lishi kerak.",
        },
      ],
    };
  }

  const parsed = definition.parseSpec(normalized);
  if (!parsed.ok) {
    const known = new Set(definition.fields.map((field) => field.key));
    return {
      ok: false,
      issues: parsed.errors.map((message) => {
        const keys = keysFromMessages([message], known);
        return keys.length > 0
          ? { code: 'invalid_spec' as const, message, keys }
          : { code: 'invalid_spec' as const, message };
      }),
    };
  }

  const canonical = normalizeSceneSpec(parsed.spec);
  if (!canonical) {
    return {
      ok: false,
      issues: [{ code: 'invalid_spec', message: 'Spec canonical shaklga keltirilmadi.' }],
    };
  }

  return { ok: true, definitionId: definition.id, spec: canonical };
}
