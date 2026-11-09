/**
 * Phase 9A.2.1 — interior definition registry.
 *
 * Room definitions deliberately live in their own registry. The 9A.1 generic
 * registry remains the furniture view (13 definitions) and therefore keeps its
 * existing list/lookup behaviour untouched. A room id may not collide with a
 * furniture or generic definition id.
 */
import { tryCreateParametricPlanFromDefinition } from '../parametric/plan';
import { defineParametric, parametricDefinitions } from '../parametric/registry';
import type { RegisteredParametricDefinition } from '../parametric/types';
import { freezeRoomPlan } from './roomPlan';
import { roomStandardDefinition } from './roomDefinition';
import {
  INTERIOR_DOMAIN,
  InteriorError,
  ROOM_FAMILY,
  type RoomDefinition,
  type RoomPlan,
  type RoomPlanCreationResult,
  type RoomPlanIssue,
  type RegisteredRoomDefinition,
} from './types';

const DEFINITION_ID = /^[a-z][a-z0-9-]*(\.[a-z][A-Za-z0-9-]*)+$/;

function invalidDefinition(message: string): never {
  throw new InteriorError('invalid_definition', message);
}

function assertRoomDefinition(definition: RoomDefinition): void {
  if (!DEFINITION_ID.test(definition.id)) {
    invalidDefinition(
      `RoomDefinition.id: "${definition.id}" formati noto'g'ri (domain.family kutilgan).`,
    );
  }
  if (definition.domain !== INTERIOR_DOMAIN) {
    invalidDefinition(`RoomDefinition.domain: "${definition.domain}" interior bo'lishi kerak.`);
  }
  if (definition.family !== ROOM_FAMILY) {
    invalidDefinition(`RoomDefinition.family: "${definition.family}" room bo'lishi kerak.`);
  }
  if (definition.parametric.id !== definition.id) {
    invalidDefinition('RoomDefinition.parametric.id: definition id bilan mos emas.');
  }
  if (definition.parametric.domain !== INTERIOR_DOMAIN) {
    invalidDefinition('RoomDefinition.parametric.domain: interior bo\'lishi kerak.');
  }
  if (definition.parametric.family !== ROOM_FAMILY) {
    invalidDefinition('RoomDefinition.parametric.family: room bo\'lishi kerak.');
  }
}

function planIssuesFromParametric(
  issues: readonly { readonly code: string; readonly message: string; readonly partId?: string }[],
): RoomPlanIssue[] {
  return issues.map((issue) => ({
    code: 'invalid_plan',
    message: issue.message,
    ...(issue.partId !== undefined ? { partId: issue.partId } : {}),
  }));
}

function createPlanFromRegistered(
  definition: RoomDefinition,
  parametric: RegisteredParametricDefinition,
  input: unknown,
): RoomPlanCreationResult {
  const parsed = definition.parametric.parseSpec(input);
  if (!parsed.ok) {
    return {
      ok: false,
      issues: parsed.errors.map((message) => ({ code: 'invalid_spec', message })),
    };
  }

  const solved = tryCreateParametricPlanFromDefinition(parametric, parsed.spec);
  if (!solved.ok) {
    return { ok: false, issues: planIssuesFromParametric(solved.issues) };
  }

  let metadata;
  try {
    metadata = definition.solveRoom(parsed.spec);
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          code: 'invalid_boundary',
          message:
            error instanceof Error
              ? error.message
              : 'Room boundary yaratilmadi.',
        },
      ],
    };
  }

  const plan = freezeRoomPlan({
    definitionId: definition.id,
    domain: definition.domain,
    family: definition.family,
    spec: parsed.spec,
    ...metadata,
    parametric: solved.plan,
  });
  return { ok: true, plan };
}

export function defineRoomDefinition(definition: RoomDefinition): RegisteredRoomDefinition {
  assertRoomDefinition(definition);
  const parametric = defineParametric(definition.parametric);
  return {
    id: definition.id,
    domain: definition.domain,
    family: definition.family,
    label: definition.label,
    parametric,
    fields: definition.parametric.fields,
    defaults: definition.parametric.defaults,
    slots: definition.parametric.slots,
    limits: definition.parametric.limits,
    ...(parametric.groupName !== undefined ? { groupName: parametric.groupName } : {}),
    parseSpec: definition.parametric.parseSpec,
    createPlan: (input: unknown) => createPlanFromRegistered(definition, parametric, input),
  };
}

export class InteriorDefinitionRegistry {
  private readonly definitions = new Map<string, RegisteredRoomDefinition>();

  register(definition: RoomDefinition): void {
    const registered = defineRoomDefinition(definition);
    if (this.definitions.has(registered.id) || parametricDefinitions.has(registered.id)) {
      throw new InteriorError(
        'duplicate_definition',
        `Room definition "${registered.id}" allaqachon ro'yxatdan o'tgan.`,
      );
    }
    this.definitions.set(registered.id, registered);
  }

  get(id: string): RegisteredRoomDefinition | undefined {
    return this.definitions.get(id);
  }

  require(id: string): RegisteredRoomDefinition {
    const definition = this.definitions.get(id);
    if (!definition) {
      throw new InteriorError('unknown_definition', `Room definition "${id}" topilmadi.`);
    }
    return definition;
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }

  list(): readonly RegisteredRoomDefinition[] {
    return [...this.definitions.values()].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
  }
}

export const interiorDefinitions = new InteriorDefinitionRegistry();

export function registerInteriorDefinition(definition: RoomDefinition): void {
  interiorDefinitions.register(definition);
}

export function getRoomDefinition(id: string): RegisteredRoomDefinition | undefined {
  return interiorDefinitions.get(id);
}

export function requireRoomDefinition(id: string): RegisteredRoomDefinition {
  return interiorDefinitions.require(id);
}

export function listInteriorDefinitions(): readonly RegisteredRoomDefinition[] {
  return interiorDefinitions.list();
}

export function tryCreateRoomPlan(
  definitionId: string,
  input: unknown,
): RoomPlanCreationResult {
  const definition = interiorDefinitions.get(definitionId);
  if (!definition) {
    return {
      ok: false,
      issues: [
        {
          code: 'unknown_definition',
          message: `Room definition "${definitionId}" topilmadi.`,
        },
      ],
    };
  }
  return definition.createPlan(input);
}

export function createRoomPlan(definitionId: string, input: unknown): RoomPlan {
  const definition = interiorDefinitions.require(definitionId);
  const result = definition.createPlan(input);
  if (!result.ok) {
    const onlySpec = result.issues.every((issue) => issue.code === 'invalid_spec');
    const onlyBoundary = result.issues.every((issue) => issue.code === 'invalid_boundary');
    throw new InteriorError(
      onlySpec ? 'invalid_room_spec' : onlyBoundary ? 'invalid_boundary' : 'invalid_plan',
      result.issues.map((issue) => issue.message).join(' '),
      result.issues,
    );
  }
  return result.plan;
}

// The built-in room is available on import without touching the global generic
// registry, so 9A.1's list of 13 furniture definitions remains exact.
interiorDefinitions.register(roomStandardDefinition);
