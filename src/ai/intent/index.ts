export { detectLanguage, parseFurniturePrompt, localIntentProvider } from './localProvider';
export { parseFurnitureIntentPayload } from './schema';
export { generateFurnitureIntent, type GenerateIntentOptions } from './service';
export {
  INTENT_DEFINITIONS,
  DIMENSION_KEYWORDS,
  matchDefinition,
  type IntentDefinitionMeta,
} from './catalog';
export { CM_PER_UNIT, parseLengthUnit, toCentimetres, type LengthUnit } from './units';
export {
  MAX_INTENT_PROMPT_LENGTH,
  type FurnitureIntent,
  type IntentFailureCode,
  type IntentGeneration,
  type IntentIssue,
  type IntentLanguage,
  type IntentProvider,
  type IntentProviderResult,
} from './types';
