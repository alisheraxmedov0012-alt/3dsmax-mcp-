/**
 * Stage 3.3 — strict reader for an untrusted intent payload.
 *
 * A provider's answer is data, not a scene object. This parser is the boundary:
 * unknown fields, unknown definitions, undeclared parameter keys, nested values
 * and non-finite numbers are rejected here, before the Configurator Core sees
 * anything.
 */
import { getFurnitureDefinition } from '../../geometry/universal/registry';
import { getFurnitureParameters } from '../../scene/configurator';
import {
  MAX_INTENT_PATCH_KEYS,
  MAX_INTENT_TEXT_LENGTH,
  type FurnitureIntent,
  type IntentIssue,
  type IntentLanguage,
  type IntentPatchValue,
  type IntentPayloadResult,
} from './types';

const ALLOWED_FIELDS = new Set([
  'definitionId',
  'patch',
  'language',
  'clarificationRequired',
  'clarificationQuestion',
]);

const LANGUAGES: ReadonlySet<string> = new Set(['uz', 'ru', 'en']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string, code: IntentIssue['code'] = 'invalid_payload'): IntentPayloadResult {
  return { ok: false, issues: [{ code, message }] };
}

export function parseFurnitureIntentPayload(value: unknown): IntentPayloadResult {
  if (!isRecord(value)) {
    return invalid('AI javobi obyekt bo‘lishi kerak.');
  }

  const unknownFields = Object.keys(value).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknownFields.length > 0) {
    return invalid(`AI javobida ruxsat etilmagan maydon: ${unknownFields.join(', ')}.`);
  }

  if (typeof value.definitionId !== 'string' || value.definitionId.trim() === '') {
    return invalid('AI javobida definitionId yo‘q.');
  }
  const definitionId = value.definitionId.trim();
  const definition = getFurnitureDefinition(definitionId);
  if (!definition) {
    return invalid(`Noma’lum definition: "${definitionId}".`, 'unknown_definition');
  }

  if (!isRecord(value.patch)) {
    return invalid('AI javobidagi patch obyekt bo‘lishi kerak.');
  }
  const patchKeys = Object.keys(value.patch);
  if (patchKeys.length > MAX_INTENT_PATCH_KEYS) {
    return invalid(`Patch ${MAX_INTENT_PATCH_KEYS} tadan ko‘p parametr qaytardi.`);
  }

  const parameters = getFurnitureParameters(definitionId);
  const declared = new Set((parameters?.parameters ?? []).map((parameter) => parameter.key));

  const patch: Record<string, IntentPatchValue> = {};
  for (const key of patchKeys) {
    if (key.trim() === '' || key.length > 64) {
      return invalid('Patch kaliti noto‘g‘ri.');
    }
    if (!declared.has(key)) {
      return {
        ok: false,
        issues: [
          {
            code: 'unknown_parameter',
            message: `"${definitionId}" definition’ida "${key}" parametri yo‘q.`,
            keys: [key],
          },
        ],
      };
    }

    const raw = value.patch[key];
    if (typeof raw === 'boolean') {
      patch[key] = raw;
      continue;
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      patch[key] = raw;
      continue;
    }
    if (typeof raw === 'string' && raw.length <= MAX_INTENT_TEXT_LENGTH) {
      patch[key] = raw;
      continue;
    }
    return {
      ok: false,
      issues: [
        {
          code: 'invalid_value',
          message: `"${key}" uchun qiymat faqat son, mantiqiy yoki qisqa matn bo‘lishi kerak.`,
          keys: [key],
        },
      ],
    };
  }

  if (typeof value.language !== 'string' || !LANGUAGES.has(value.language)) {
    return invalid('AI javobida til (language) noto‘g‘ri.');
  }
  const language = value.language as IntentLanguage;

  if (typeof value.clarificationRequired !== 'boolean') {
    return invalid('AI javobida clarificationRequired mantiqiy qiymat bo‘lishi kerak.');
  }

  const question = value.clarificationQuestion;
  if (question !== undefined) {
    if (typeof question !== 'string' || question.trim() === '' || question.length > 300) {
      return invalid('Aniqlashtirish savoli noto‘g‘ri.');
    }
  }
  if (value.clarificationRequired && question === undefined) {
    return invalid('Aniqlashtirish talab qilindi, lekin savol berilmadi.');
  }

  const intent: FurnitureIntent = {
    definitionId,
    patch,
    language,
    clarificationRequired: value.clarificationRequired,
    ...(question === undefined ? {} : { clarificationQuestion: question }),
  };

  return { ok: true, intent };
}
