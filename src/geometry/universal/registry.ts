/**
 * Stage 2.1a — furniture definition registry.
 *
 * Registration is explicit and duplicate ids are rejected. Definitions keep
 * their typed `solve()`, while the registry stores a type-erased record whose
 * `solveSpec()` parses untrusted input first, so no caller can hand `solve()`
 * an unvalidated spec and no `any` cast is needed.
 */
import { isFurnitureType } from '../furniture/types';
import {
  FurniturePlanError,
  type FurnitureDefinition,
  type RegisteredFurnitureDefinition,
  type SpecParseResult,
  type SolvedFurniturePlan,
} from './types';

const DEFINITION_ID = /^[a-z][a-z0-9-]*(\.[a-z][A-Za-z0-9-]*)+$/;
const GROUP_NAME = /^[a-z0-9][a-z0-9-]*$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function invalid(message: string): never {
  throw new FurniturePlanError('invalid_definition', message);
}

function isNonEmptyString(value: string): boolean {
  return value.trim() !== '';
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    invalid(`${label}: musbat butun son bo'lishi kerak.`);
  }
}

function assertDefinition<S extends object>(definition: FurnitureDefinition<S>): void {
  if (!DEFINITION_ID.test(definition.id)) {
    invalid(`definition.id: "${definition.id}" formati noto'g'ri (family.variant kutilgan).`);
  }
  assertPositiveInteger(definition.version, 'definition.version');
  if (!isFurnitureType(definition.family)) {
    invalid(`definition.family: "${String(definition.family)}" noma'lum mebel turi.`);
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
export function defineFurniture<S extends object>(
  definition: FurnitureDefinition<S>,
): RegisteredFurnitureDefinition {
  assertDefinition(definition);
  const solveSpec = (input: unknown): SpecParseResult<SolvedFurniturePlan> => {
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

export class FurnitureDefinitionRegistry {
  private readonly definitions = new Map<string, RegisteredFurnitureDefinition>();

  register<S extends object>(definition: FurnitureDefinition<S>): void {
    const registered = defineFurniture(definition);
    if (this.definitions.has(registered.id)) {
      throw new FurniturePlanError(
        'duplicate_definition',
        `Definition "${registered.id}" allaqachon ro'yxatdan o'tgan.`,
      );
    }
    this.definitions.set(registered.id, registered);
  }

  get(id: string): RegisteredFurnitureDefinition | undefined {
    return this.definitions.get(id);
  }

  require(id: string): RegisteredFurnitureDefinition {
    const definition = this.definitions.get(id);
    if (!definition) {
      throw new FurniturePlanError('unknown_definition', `Definition "${id}" topilmadi.`);
    }
    return definition;
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }

  list(): readonly RegisteredFurnitureDefinition[] {
    return [...this.definitions.values()].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
  }
}

/** Application-wide registry. Built-in definitions register on import. */
export const furnitureDefinitions = new FurnitureDefinitionRegistry();

export function registerFurnitureDefinition<S extends object>(
  definition: FurnitureDefinition<S>,
): void {
  furnitureDefinitions.register(definition);
}

export function getFurnitureDefinition(id: string): RegisteredFurnitureDefinition | undefined {
  return furnitureDefinitions.get(id);
}

export function requireFurnitureDefinition(id: string): RegisteredFurnitureDefinition {
  return furnitureDefinitions.require(id);
}
