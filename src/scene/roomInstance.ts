/**
 * Phase 9A.2.2 — opt-in parametric room instances.
 *
 * The legacy `SceneData.room`/`buildRoom` path is intentionally not touched.
 * This module validates and materialises the additive `SceneData.rooms` list:
 * RoomSpec -> RoomPlan -> the generic `buildPlanWithDefinition` pipeline.
 */
import * as THREE from 'three';
import { requireRoomDefinition, tryCreateRoomPlan } from '../geometry/interior/registry';
import type { RoomPlan } from '../geometry/interior/types';
import type { RoomSpec } from '../geometry/interior/types';
import { buildPlanWithDefinition } from '../geometry/universal/build';
import { MATERIAL_PRESET_IDS } from '../materials/presets';
import { PBR_LIMITS, type MaterialSettingsInput } from '../materials/types';
import { applyObjectTransform } from './buildSceneObject';
import {
  MAX_ROOMS_PER_SCENE,
  OBJECT_LIMITS,
  OBJECT_NAME_MAX_LENGTH,
  type RoomInstance,
  type RoomMaterialAssignments,
  type Vec3,
} from './types';

const MAX_ROOM_INSTANCE_ID_LENGTH = 64;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export type RoomInstanceIssueCode =
  | 'invalid_id'
  | 'unknown_definition'
  | 'invalid_spec'
  | 'invalid_plan'
  | 'invalid_geometry'
  | 'invalid_transform'
  | 'invalid_visibility'
  | 'invalid_material'
  | 'duplicate_id'
  | 'limit_exceeded'
  | 'invalid_rooms';

export interface RoomInstanceIssue {
  readonly code: RoomInstanceIssueCode;
  readonly message: string;
  readonly roomId?: string;
}

export type RoomInstanceValidationResult =
  | { readonly ok: true; readonly room: RoomInstance }
  | { readonly ok: false; readonly issues: readonly RoomInstanceIssue[] };

export interface RoomInstancesValidationResult {
  readonly rooms: RoomInstance[];
  readonly dropped: number;
  readonly issues: readonly RoomInstanceIssue[];
}

export type RoomInstanceErrorCode =
  | 'invalid_room_instance'
  | 'invalid_plan'
  | 'invalid_geometry';

export class RoomInstanceError extends Error {
  readonly code: RoomInstanceErrorCode;
  readonly issues: readonly RoomInstanceIssue[];

  constructor(
    code: RoomInstanceErrorCode,
    message: string,
    issues: readonly RoomInstanceIssue[] = [],
  ) {
    super(message);
    this.name = 'RoomInstanceError';
    this.code = code;
    this.issues = issues;
  }
}

export interface BuiltRoomInstance {
  readonly group: THREE.Group;
  readonly plan: RoomPlan;
  dispose: () => void;
}

export type RoomInstanceBuildResult =
  | { readonly ok: true; readonly built: BuiltRoomInstance }
  | { readonly ok: false; readonly issues: readonly RoomInstanceIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(
  code: RoomInstanceIssueCode,
  message: string,
  roomId?: string,
): RoomInstanceIssue {
  return { code, message, ...(roomId !== undefined ? { roomId } : {}) };
}

/**
 * Strict transform reader. Missing axes take their identity value; a present
 * non-finite or out-of-range axis rejects the room instead of being clamped
 * into a different placement than the author asked for.
 */
function readVec3(
  value: unknown,
  fallback: Vec3,
  range: { readonly min: number; readonly max: number },
  label: string,
  issues: RoomInstanceIssue[],
): Vec3 {
  if (value === undefined) {
    return { ...fallback };
  }
  if (!isRecord(value)) {
    issues.push(issue('invalid_transform', `${label}: obyekt bo'lishi kerak.`));
    return { ...fallback };
  }

  const readAxis = (axis: 'x' | 'y' | 'z'): number => {
    const raw = value[axis];
    if (raw === undefined) {
      return fallback[axis];
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      issues.push(issue('invalid_transform', `${label}.${axis}: chekli son bo'lishi kerak.`));
      return fallback[axis];
    }
    if (raw < range.min || raw > range.max) {
      issues.push(
        issue(
          'invalid_transform',
          `${label}.${axis}: ${range.min}–${range.max} oralig'ida bo'lishi kerak.`,
        ),
      );
      return fallback[axis];
    }
    return raw;
  };

  return { x: readAxis('x'), y: readAxis('y'), z: readAxis('z') };
}

function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return HEX_COLOR.test(trimmed) ? trimmed : undefined;
}

function clampNumber(
  value: unknown,
  range: { readonly min: number; readonly max: number },
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(Math.max(value, range.min), range.max);
}

/**
 * Keep only assignments whose slot id exists on the definition, and only the
 * material channels the existing `buildPlanWithDefinition` understands.
 * Malformed individual channels are dropped; a non-object assignment container
 * is rejected by the caller because it cannot be interpreted safely.
 */
function normalizeMaterialAssignments(
  value: unknown,
  slotIds: ReadonlySet<string>,
): { readonly ok: true; readonly assignments?: RoomMaterialAssignments } | {
  readonly ok: false;
  readonly message: string;
} {
  if (value === undefined) {
    return { ok: true };
  }
  if (!isRecord(value)) {
    return { ok: false, message: 'materialAssignments: obyekt bo‘lishi kerak.' };
  }

  const assignments: Record<string, MaterialSettingsInput> = {};
  for (const [slotId, raw] of Object.entries(value)) {
    if (!slotIds.has(slotId) || !isRecord(raw)) {
      continue;
    }
    const settings: MaterialSettingsInput = {};
    if (
      typeof raw.materialId === 'string' &&
      MATERIAL_PRESET_IDS.has(raw.materialId)
    ) {
      settings.materialId = raw.materialId;
    }
    const metalness = clampNumber(raw.metalness, PBR_LIMITS.metalness);
    if (metalness !== undefined) settings.metalness = metalness;
    const roughness = clampNumber(raw.roughness, PBR_LIMITS.roughness);
    if (roughness !== undefined) settings.roughness = roughness;
    const opacity = clampNumber(raw.opacity, PBR_LIMITS.opacity);
    if (opacity !== undefined) settings.opacity = opacity;
    const textureScale = clampNumber(raw.textureScale, PBR_LIMITS.textureScale);
    if (textureScale !== undefined) settings.textureScale = textureScale;
    const normalStrength = clampNumber(raw.normalStrength, PBR_LIMITS.normalStrength);
    if (normalStrength !== undefined) settings.normalStrength = normalStrength;
    const emissiveIntensity = clampNumber(
      raw.emissiveIntensity,
      PBR_LIMITS.emissiveIntensity,
    );
    if (emissiveIntensity !== undefined) settings.emissiveIntensity = emissiveIntensity;
    const aoIntensity = clampNumber(raw.aoIntensity, PBR_LIMITS.aoIntensity);
    if (aoIntensity !== undefined) settings.aoIntensity = aoIntensity;
    const baseColor = normalizeHexColor(raw.baseColor);
    if (baseColor !== undefined) settings.baseColor = baseColor;
    const emissiveColor = normalizeHexColor(raw.emissiveColor);
    if (emissiveColor !== undefined) settings.emissiveColor = emissiveColor;
    if (typeof raw.premiumTextures === 'boolean') {
      settings.premiumTextures = raw.premiumTextures;
    }
    if (Object.keys(settings).length > 0) {
      assignments[slotId] = settings;
    }
  }

  return {
    ok: true,
    ...(Object.keys(assignments).length > 0
      ? { assignments: Object.freeze(assignments) }
      : {}),
  };
}

/** Validate one untrusted room instance without creating geometry. */
export function validateRoomInstance(value: unknown): RoomInstanceValidationResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [issue('invalid_id', 'room: obyekt bo‘lishi kerak.')],
    };
  }

  const issues: RoomInstanceIssue[] = [];
  const rawId = value.id;
  let id = '';
  if (typeof rawId !== 'string' || rawId.trim() === '') {
    issues.push(issue('invalid_id', 'room.id: bo‘sh bo‘lmagan matn bo‘lishi kerak.'));
  } else {
    id = rawId.trim();
    if (id.length > MAX_ROOM_INSTANCE_ID_LENGTH) {
      issues.push(issue('invalid_id', 'room.id: juda uzun.'));
    }
  }

  const rawDefinitionId = value.definitionId;
  let definitionId = '';
  let definition: ReturnType<typeof requireRoomDefinition> | undefined;
  if (typeof rawDefinitionId === 'string' && rawDefinitionId.trim() !== '') {
    definitionId = rawDefinitionId.trim();
    definition = requireSafeRoomDefinition(definitionId);
  }
  if (!definition) {
    issues.push(
      issue('unknown_definition', 'room.definitionId: noma’lum yoki bo‘sh definition.'),
    );
  }

  let spec: RoomSpec | undefined;
  if (definition) {
    const rawSpec = value.spec;
    const parsed =
      rawSpec === undefined
        ? { ok: true as const, spec: definition.defaults }
        : definition.parseSpec(rawSpec);
    if (!parsed.ok) {
      for (const message of parsed.errors) {
        issues.push(issue('invalid_spec', message));
      }
    } else {
      spec = parsed.spec;
      const planResult = tryCreateRoomPlan(definitionId, spec);
      if (!planResult.ok) {
        for (const planIssue of planResult.issues) {
          issues.push(
            issue(
              planIssue.code === 'invalid_spec' ? 'invalid_spec' : 'invalid_plan',
              planIssue.message,
            ),
          );
        }
      }
    }
  }

  const position = readVec3(
    value.position,
    { x: 0, y: 0, z: 0 },
    OBJECT_LIMITS.position,
    'room.position',
    issues,
  );
  const rotation = readVec3(
    value.rotation,
    { x: 0, y: 0, z: 0 },
    OBJECT_LIMITS.rotation,
    'room.rotation',
    issues,
  );
  const scale = readVec3(
    value.scale,
    { x: 1, y: 1, z: 1 },
    OBJECT_LIMITS.scale,
    'room.scale',
    issues,
  );

  const rawVisible = value.visible;
  let visible = true;
  if (rawVisible !== undefined) {
    if (typeof rawVisible !== 'boolean') {
      issues.push(issue('invalid_visibility', 'room.visible: boolean bo‘lishi kerak.'));
    } else {
      visible = rawVisible;
    }
  }

  let name = definition?.label ?? 'Xona';
  if (typeof value.name === 'string') {
    const trimmed = value.name.trim();
    if (trimmed !== '') {
      name = trimmed.slice(0, OBJECT_NAME_MAX_LENGTH);
    }
  }

  let materialAssignments: RoomMaterialAssignments | undefined;
  if (definition) {
    const normalized = normalizeMaterialAssignments(
      value.materialAssignments,
      new Set(definition.slots.map((slot) => slot.id)),
    );
    if (!normalized.ok) {
      issues.push(issue('invalid_material', normalized.message));
    } else {
      materialAssignments = normalized.assignments;
    }
  }

  if (issues.length > 0 || !definition || !spec) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    room: {
      id,
      name,
      definitionId,
      spec,
      position,
      rotation,
      scale,
      visible,
      ...(materialAssignments ? { materialAssignments } : {}),
    },
  };
}

/**
 * `requireRoomDefinition` throws for an unknown id. Room-instance validation
 * wants a dropped instance plus a structured issue instead, so resolve it
 * through the registry's non-throwing lookup.
 */
function requireSafeRoomDefinition(id: string): ReturnType<typeof requireRoomDefinition> | undefined {
  try {
    return requireRoomDefinition(id);
  } catch {
    return undefined;
  }
}

/** Validate a room array, dropping invalid/duplicate/over-limit entries. */
export function validateRoomInstances(value: unknown): RoomInstancesValidationResult {
  if (!Array.isArray(value)) {
    return {
      rooms: [],
      dropped: 1,
      issues: [issue('invalid_rooms', 'rooms: ro‘yxat bo‘lishi kerak.')],
    };
  }

  const rooms: RoomInstance[] = [];
  const issues: RoomInstanceIssue[] = [];
  const seen = new Set<string>();
  let dropped = 0;

  for (const raw of value) {
    if (rooms.length >= MAX_ROOMS_PER_SCENE) {
      dropped += 1;
      issues.push(
        issue(
          'limit_exceeded',
          `rooms: ko‘pi bilan ${MAX_ROOMS_PER_SCENE} ta room bo‘lishi mumkin.`,
        ),
      );
      continue;
    }
    const result = validateRoomInstance(raw);
    if (!result.ok) {
      dropped += 1;
      issues.push(...result.issues);
      continue;
    }
    if (seen.has(result.room.id)) {
      dropped += 1;
      issues.push(issue('duplicate_id', `room.id: takroriy "${result.room.id}".`));
      continue;
    }
    seen.add(result.room.id);
    rooms.push(result.room);
  }

  return { rooms, dropped, issues };
}

export function createRoomInstance(
  definitionId: string,
  id: string,
  spec: unknown = undefined,
  overrides: Partial<Omit<RoomInstance, 'id' | 'definitionId' | 'spec'>> = {},
): RoomInstance {
  const definition = requireRoomDefinition(definitionId);
  const parsed = definition.parseSpec(spec === undefined ? definition.defaults : spec);
  if (!parsed.ok) {
    throw new RoomInstanceError('invalid_room_instance', parsed.errors.join(' '));
  }
  return {
    id,
    name: overrides.name ?? definition.label,
    definitionId,
    spec: parsed.spec,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    ...overrides,
  };
}

/** Materialise one validated room through the generic parametric builder. */
export function tryBuildRoomInstance(value: unknown): RoomInstanceBuildResult {
  const validation = validateRoomInstance(value);
  if (!validation.ok) {
    return { ok: false, issues: validation.issues };
  }

  const planResult = tryCreateRoomPlan(
    validation.room.definitionId,
    validation.room.spec,
  );
  if (!planResult.ok) {
    return {
      ok: false,
      issues: planResult.issues.map((roomIssue) =>
        issue(
          roomIssue.code === 'invalid_spec' ? 'invalid_spec' : 'invalid_plan',
          roomIssue.message,
        ),
      ),
    };
  }

  const definition = requireRoomDefinition(validation.room.definitionId);
  let built;
  try {
    built = buildPlanWithDefinition(
      planResult.plan.parametric,
      definition.parametric,
      validation.room.materialAssignments
        ? { materialOverrides: validation.room.materialAssignments }
        : {},
    );
  } catch (error) {
    return {
      ok: false,
      issues: [
        issue(
          'invalid_geometry',
          error instanceof Error ? error.message : 'Room geometry qurilmadi.',
        ),
      ],
    };
  }

  built.group.name = `room:${validation.room.id}`;
  built.group.userData.roomInstanceId = validation.room.id;
  built.group.userData.definitionId = validation.room.definitionId;
  applyObjectTransform(built.group, validation.room);

  return {
    ok: true,
    built: {
      group: built.group,
      plan: planResult.plan,
      dispose: built.dispose,
    },
  };
}

export function buildRoomInstance(value: unknown): BuiltRoomInstance {
  const result = tryBuildRoomInstance(value);
  if (!result.ok) {
    const code = result.issues.some((entry) => entry.code === 'invalid_geometry')
      ? 'invalid_geometry'
      : result.issues.some((entry) => entry.code === 'invalid_plan')
        ? 'invalid_plan'
        : 'invalid_room_instance';
    throw new RoomInstanceError(
      code,
      result.issues.map((entry) => entry.message).join(' '),
      result.issues,
    );
  }
  return result.built;
}
