/**
 * Stage 3.1 — parameter metadata for the configurator.
 *
 * Everything here comes from the definition itself (`fields`, `defaults`); no
 * range, unit or dependency is inferred. The 13 built-in definitions currently
 * declare only `key`, `label`, `kind` and occasionally `integer`/`hint`, so their
 * numeric limits are enforced by the definition parser at edit time rather than
 * advertised here. `withoutRange` makes that gap explicit per definition instead
 * of filling it with invented numbers.
 */
import { getFurnitureDefinition } from '../../geometry/universal/registry';
import type { DefinitionFieldKind, NumericRange } from '../../geometry/universal/types';
import { normalizeSceneSpec, type SceneSpec, type SceneSpecValue } from '../types';
import type { FurnitureType } from '../../geometry/furniture/types';

export interface FurnitureParameterInfo {
  readonly key: string;
  readonly label: string;
  readonly kind: DefinitionFieldKind;
  readonly integer: boolean;
  /** Declared limits, when the definition provides them. */
  readonly range?: NumericRange;
  /** Definition-supplied helper text. */
  readonly hint?: string;
  /** Value from the definition's default spec. */
  readonly defaultValue: SceneSpecValue | undefined;
}

export interface FurnitureParameterSet {
  readonly definitionId: string;
  readonly label: string;
  readonly family: FurnitureType;
  readonly version: number;
  readonly parameters: readonly FurnitureParameterInfo[];
  /** Canonical default spec (a fresh, complete parameter set). */
  readonly defaults: SceneSpec;
  /** Numeric parameters with no declared min/max/step (metadata gap). */
  readonly withoutRange: readonly string[];
  /** Default spec channels that have no declared field (expected to be empty). */
  readonly undeclaredDefaults: readonly string[];
}

/** Returns the parameter metadata for a definition, or null when unknown. */
export function getFurnitureParameters(definitionId: string): FurnitureParameterSet | null {
  const definition = getFurnitureDefinition(definitionId.trim());
  if (!definition) {
    return null;
  }

  const defaults = normalizeSceneSpec(definition.defaults) ?? {};
  const parameters = definition.fields.map((field): FurnitureParameterInfo => ({
    key: field.key,
    label: field.label,
    kind: field.kind,
    integer: field.integer === true,
    defaultValue: defaults[field.key],
    ...(field.range ? { range: field.range } : {}),
    ...(field.hint ? { hint: field.hint } : {}),
  }));

  const fieldKeys = new Set(definition.fields.map((field) => field.key));
  return {
    definitionId: definition.id,
    label: definition.label,
    family: definition.family,
    version: definition.version,
    parameters,
    defaults,
    withoutRange: parameters
      .filter((parameter) => parameter.kind === 'number' && parameter.range === undefined)
      .map((parameter) => parameter.key),
    undeclaredDefaults: Object.keys(defaults).filter((key) => !fieldKeys.has(key)),
  };
}
