/**
 * Phase 9A.1 — category-neutral definition registry.
 *
 * The registry stores generic definitions and lazily adapts every definition
 * already registered in the furniture registry. That keeps the furniture layer
 * untouched and gives it a second, category-neutral view: callers of the
 * generic contract see 13 furniture definitions plus anything registered here,
 * while the furniture registry remains the source of truth for furniture.
 *
 * Registration is explicit and duplicate ids are rejected across both views, so
 * a generic definition can never shadow a built-in furniture id.
 */
import { isFurnitureType } from '../furniture/types';
import '../universal/definitions';
import { furnitureDefinitions } from '../universal/registry';
import type {
  RegisteredFurnitureDefinition,
  SpecParseResult,
} from '../universal/types';
import {
  FURNITURE_DOMAIN,
  PARAMETRIC_DOMAIN_ID,
  ParametricPlanError,
  type ParametricDefinition,
  type RegisteredParametricDefinition,
  type SolvedParametricPlan,
} from './types';

const DEFINITION_ID = /^[a-z][a-z0-9-]*(\.[a-z][A-Za-z0-9-]*)+$/;
const GROUP_NAME = /^[a-z0-9][a-z0-9-]*$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function invalid(message: string): never {
  throw new ParametricPlanError('invalid_definition', message);
}

function isNonEmptyString(value: string): boolean {
  return value.trim() !== '';
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    invalid(`${label}: musbat butun son bo'lishi kerak.`);
  }
}

function assertDefinition<S extends object>(definition: ParametricDefinition<S>): void {
  if (!DEFINITION_ID.test(definition.id)) {
    invalid(`definition.id: "${definition.id}" formati noto'g'ri (domain.family kutilgan).`);
  }
  assertPositiveInteger(definition.version, 'definition.version');
  if (!PARAMETRIC_DOMAIN_ID.test(definition.domain)) {
    invalid(`definition.domain: "${String(definition.domain)}" formati noto'g'ri.`);
  }
  if (!isNonEmptyString(definition.family)) {
    invalid('definition.family: bo‘sh bo‘lmasligi kerak.');
  }
  // A definition may not call itself furniture unless its family really is one:
  // the scene layer and every furniture panel key off this value.
  if (definition.domain === FURNITURE_DOMAIN && !isFurnitureType(definition.family)) {
    invalid(`definition.family: "${definition.family}" mebel turi emas.`);
  }
  if (!isNonEmptyString(definition.label)) {
    invalid('definition.label: bo‘sh bo‘lmasligi kerak.');
  }
  if (typeof definition.defaults !== 'object' || definition.defaults === null) {
    invalid('definition.defaults: obyekt bo‘lishi kerak.');
  }

  const fieldKeys = new Set<string>();
  for (const field of definition.fields) {
    if (!isNonEmptyString(field.key) || !isNonEmptyString(field.label)) {
      invalid('definition.fields: key va label bo‘sh bo‘lmasligi kerak.');
    }
    if (fieldKeys.has(field.key)) {
      invalid(`definition.fields: takroriy key "${field.key}".`);
    }
    fieldKeys.add(field.key);
    if (field.kind === 'number' && field.range) {
      if (
        !Number.isFinite(field.range.min) ||
        !Number.isFinite(field.range.max) ||
        !Number.isFinite(field.range.step) ||
        field.range.min > field.range.max ||
        field.range.step <= 0
      ) {
        invalid(`definition.fields.${field.key}: range noto‘g‘ri.`);
      }
    }
  }

  if (definition.slots.length === 0) {
    invalid('definition.slots: kamida bitta slot kerak.');
  }
  const slotIds = new Set<string>();
  const groupNames = new Set<string>();
  for (const slot of definition.slots) {
    if (!isNonEmptyString(slot.id)) {
      invalid('definition.slots: id bo‘sh bo‘lmasligi kerak.');
    }
    if (slotIds.has(slot.id)) {
      invalid(`definition.slots: takroriy id "${slot.id}".`);
    }
    slotIds.add(slot.id);
    if (!GROUP_NAME.test(slot.groupName)) {
      invalid(`definition.slots.${slot.id}: groupName "${slot.groupName}" formati noto‘g‘ri.`);
    }
    if (groupNames.has(slot.groupName)) {
      invalid(`definition.slots: takroriy groupName "${slot.groupName}".`);
    }
    groupNames.add(slot.groupName);
    if (!HEX_COLOR.test(slot.color)) {
      invalid(`definition.slots.${slot.id}: color #RRGGBB bo‘lishi kerak.`);
    }
    if (!isNonEmptyString(slot.materialId)) {
      invalid(`definition.slots.${slot.id}: materialId bo‘sh bo‘lmasligi kerak.`);
    }
    if (!isNonEmptyString(slot.label)) {
      invalid(`definition.slots.${slot.id}: label bo‘sh bo‘lmasligi kerak.`);
    }
  }

  const limits = definition.limits;
  assertPositiveInteger(limits.maxParts, 'definition.limits.maxParts');
  assertPositiveInteger(limits.maxPartVertices, 'definition.limits.maxPartVertices');
  assertPositiveInteger(limits.maxPartTriangles, 'definition.limits.maxPartTriangles');
  assertPositiveInteger(limits.maxTotalVertices, 'definition.limits.maxTotalVertices');
  if (limits.maxTotalVertices < limits.maxPartVertices) {
    invalid('definition.limits.maxTotalVertices: maxPartVertices dan kichik bo‘lmasligi kerak.');
  }

  if (definition.groupName !== undefined && !GROUP_NAME.test(definition.groupName)) {
    invalid(`definition.groupName: "${definition.groupName}" formati noto‘g‘ri.`);
  }
}

/** Erase the spec type while keeping every runtime check intact. */
export function defineParametric<S extends object>(
  definition: ParametricDefinition<S>,
): RegisteredParametricDefinition {
  assertDefinition(definition);
  const solveSpec = (input: unknown): SpecParseResult<SolvedParametricPlan> => {
    const parsed = definition.parseSpec(input);
    if (!parsed.ok) {
      return parsed;
    }
    return {
      ok: true,
      spec: { spec: parsed.spec, draft: definition.solve(parsed.spec) },
    };
  };
  return {
    id: definition.id,
    version: definition.version,
    domain: definition.domain,
    family: definition.family,
    label: definition.label,
    fields: definition.fields,
    defaults: definition.defaults,
    slots: definition.slots,
    limits: definition.limits,
    ...(definition.groupName !== undefined ? { groupName: definition.groupName } : {}),
    parseSpec: definition.parseSpec,
    solveSpec,
  };
}

/**
 * Presents a furniture definition through the generic contract.
 *
 * No solver or slot is copied: the adapter keeps the original functions and
 * only relabels `family` as the `furniture` domain. Solving therefore stays on
 * the exact code path the furniture registry uses.
 */
export function adaptFurnitureDefinition(
  definition: RegisteredFurnitureDefinition,
): RegisteredParametricDefinition {
  return {
    id: definition.id,
    version: definition.version,
    domain: FURNITURE_DOMAIN,
    family: definition.family,
    label: definition.label,
    fields: definition.fields,
    defaults: definition.defaults,
    slots: definition.slots,
    limits: definition.limits,
    ...(definition.groupName !== undefined ? { groupName: definition.groupName } : {}),
    parseSpec: definition.parseSpec,
    solveSpec: (input: unknown): SpecParseResult<SolvedParametricPlan> => {
      const solved = definition.solveSpec(input);
      if (!solved.ok) {
        return solved;
      }
      return {
        ok: true,
        spec: { spec: solved.spec.spec, draft: solved.spec.draft },
      };
    },
  };
}

export class ParametricDefinitionRegistry {
  private readonly definitions = new Map<string, RegisteredParametricDefinition>();
  private readonly furnitureAdapters = new Map<string, RegisteredParametricDefinition>();

  register<S extends object>(definition: ParametricDefinition<S>): void {
    const registered = defineParametric(definition);
    if (
      this.definitions.has(registered.id) ||
      this.furnitureAdapters.has(registered.id) ||
      furnitureDefinitions.has(registered.id)
    ) {
      throw new ParametricPlanError(
        'duplicate_definition',
        `Definition "${registered.id}" allaqachon ro'yxatdan o'tgan.`,
      );
    }
    this.definitions.set(registered.id, registered);
  }

  get(id: string): RegisteredParametricDefinition | undefined {
    const own = this.definitions.get(id);
    if (own) {
      return own;
    }
    const cached = this.furnitureAdapters.get(id);
    if (cached) {
      return cached;
    }
    const furniture = furnitureDefinitions.get(id);
    if (!furniture) {
      return undefined;
    }
    const adapted = adaptFurnitureDefinition(furniture);
    this.furnitureAdapters.set(id, adapted);
    return adapted;
  }

  require(id: string): RegisteredParametricDefinition {
    const definition = this.get(id);
    if (!definition) {
      throw new ParametricPlanError('unknown_definition', `Definition "${id}" topilmadi.`);
    }
    return definition;
  }

  has(id: string): boolean {
    return this.get(id) !== undefined;
  }

  list(): readonly RegisteredParametricDefinition[] {
    const merged = new Map<string, RegisteredParametricDefinition>();
    for (const definition of furnitureDefinitions.list()) {
      merged.set(definition.id, adaptFurnitureDefinition(definition));
    }
    for (const [id, definition] of this.definitions) {
      merged.set(id, definition);
    }
    return [...merged.values()].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
  }
}

/** Application-wide registry. Furniture definitions are adapted on demand. */
export const parametricDefinitions = new ParametricDefinitionRegistry();

export function registerParametricDefinition<S extends object>(
  definition: ParametricDefinition<S>,
): void {
  parametricDefinitions.register(definition);
}

export function getParametricDefinition(id: string): RegisteredParametricDefinition | undefined {
  return parametricDefinitions.get(id);
}

export function requireParametricDefinition(id: string): RegisteredParametricDefinition {
  return parametricDefinitions.require(id);
}

export function listParametricDefinitions(): readonly RegisteredParametricDefinition[] {
  return parametricDefinitions.list();
}
