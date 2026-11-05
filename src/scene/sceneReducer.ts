import {
  validateFurnitureParams,
  type FurnitureParams,
  type FurnitureType,
} from '../geometry/furniture';
import { getMaterialPreset, MATERIAL_PRESET_IDS } from '../materials/presets';
import {
  validateMaterialAssetMaps,
  type TextureAssetRef,
  type TextureMapRole,
} from '../materials/asset';
import {
  isKnownSheetMaterial,
  validateSheetThickness,
  type SheetMaterialEntry,
} from '../manufacturing/sheetMaterial';
import { buildHardwareBom, type HardwareItem } from '../manufacturing/hardware';
import { MAX_SHEET_MATERIALS_PER_OBJECT } from './types';
import { PBR_LIMITS, type MaterialPresetId, type NumericRange } from '../materials/types';
import { validateRoomConfig, validateSceneObject } from './sceneValidation';
import { canonicalizeFurnitureSpec } from './configurator/canonicalSpec';
import {
  nearestWall,
  placeAgainstWall,
  type WallId,
} from './placement';
import { createDefaultSettings, validateColor, validateSceneSettings, CAMERA_PRESETS, type LightSettings, type CameraPreset, type SceneSettings } from './sceneSettings';
import {
  LIGHTING_PRESET_CONFIGS,
  isLightingPresetId,
  isQualityPresetId,
  isToneMappingMode,
  validateExposure,
  type LightingPresetId,
  type QualityPresetId,
  type ToneMappingMode,
} from '../render/renderPresets';
import {
  MATERIAL_DEFAULTS,
  MATERIAL_LIMITS,
  MAX_ASSEMBLIES_PER_SCENE,
  MAX_SPEC_HISTORY,
  OBJECT_NAME_MAX_LENGTH,
  OBJECT_LIMITS,
  ROOM_OBJECT_ID,
  SCENE_SCHEMA_VERSION,
  createTableSceneObject,
  createFurnitureSceneObject,
  type ObjectMaterial,
  type RoomConfig,
  type RoomOpening,
  type SceneAssembly,
  type SceneData,
  type SceneObject,
  type SceneSpec,
  type SpecHistory,
  type SpecHistoryEntry,
  createUniversalSceneObject,
  type SceneState,
  type Vec3,
} from './types';

export type SceneAction =
  | { type: 'SET_ROOM'; room: Partial<RoomConfig> }
  | { type: 'SET_LAYOUT'; room: RoomConfig; objects: SceneObject[] }
  | { type: 'PLACE_AGAINST_WALL'; id: string; wall?: WallId }
  | { type: 'SET_ROOM_CEILING'; showCeiling: boolean }
  | { type: 'ADD_ROOM_OPENING'; opening: RoomOpening }
  | { type: 'REMOVE_ROOM_OPENING'; id: string }
  | { type: 'ADD_TABLE'; id: string }
  | {
      type: 'ADD_FURNITURE';
      furnitureType: FurnitureType;
      id: string;
      params?: FurnitureParams;
      /**
       * PBR preset applied as part of creation (A3.4 F3), so the object is never
       * briefly rendered with the wrong material. Unknown ids are ignored.
       */
      materialPresetId?: MaterialPresetId | null;
    }
  | { type: 'UNDO_SPEC' }
  | { type: 'REDO_SPEC' }
  | { type: 'SELECT'; id: string | null }
  | {
      type: 'UPDATE_TRANSFORM';
      id: string;
      position?: Partial<Vec3>;
      rotation?: Partial<Vec3>;
      scale?: Partial<Vec3>;
    }
  | { type: 'RENAME_OBJECT'; id: string; name: string }
  | {
      type: 'ADD_UNIVERSAL_FURNITURE';
      id: string;
      definitionId: string;
      /** Canonical spec produced by `updateFurnitureSpec`. */
      spec: SceneSpec;
    }
  | {
      type: 'UPDATE_SPEC';
      id: string;
      /**
       * Canonical spec produced by `updateFurnitureSpec()`. The caller runs the
       * full plan validation; the reducer never materialises geometry, so it only
       * re-checks the structure and the definition parser here.
       */
      spec: SceneSpec;
    }
  | { type: 'UPDATE_PARAMS'; id: string; params: FurnitureParams }
  | { type: 'UPDATE_MATERIAL'; id: string; material: Partial<ObjectMaterial> }
  | {
      type: 'SET_MATERIAL_MAP';
      id: string;
      role: TextureMapRole;
      ref: TextureAssetRef | null;
    }
  | {
      type: 'SET_SHEET_MATERIAL';
      id: string;
      assignment: {
        partId: string;
        materialId: SheetMaterialEntry['materialId'];
        thicknessMm: number;
      };
    }
  | { type: 'REMOVE_SHEET_MATERIAL'; id: string; partId: string }
  | { type: 'SET_HARDWARE'; id: string; hardware: readonly HardwareItem[] }
  | { type: 'APPLY_MATERIAL_PRESET'; id: string; presetId: string }
  | { type: 'RESET_MATERIAL'; id: string }
  | { type: 'TOGGLE_VISIBILITY'; id: string }
  | { type: 'DELETE_OBJECT'; id: string }
  | { type: 'SET_BACKGROUND'; color: string }
  | { type: 'UPDATE_LIGHTS'; lights: Partial<LightSettings> }
  | { type: 'RESET_LIGHTS' }
  | { type: 'APPLY_LIGHTING_PRESET'; preset: LightingPresetId }
  | { type: 'UPDATE_ROOM_MATERIALS'; floorColor?: string; wallColor?: string; ceilingColor?: string }
  | { type: 'SET_CAMERA_PRESET'; preset: CameraPreset }
  | { type: 'SET_RENDER_QUALITY'; quality: QualityPresetId }
  | { type: 'SET_EXPOSURE'; exposure: number }
  | { type: 'SET_TONE_MAPPING'; toneMapping: ToneMappingMode }
  | { type: 'LOAD_SCENE'; scene: SceneData }
  | { type: 'ADD_ASSEMBLY'; assembly: SceneAssembly }
  | { type: 'DELETE_ASSEMBLY'; id: string }
  | { type: 'NEW_SCENE'; id: string };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function mergeVec3(base: Vec3, patch: Partial<Vec3> | undefined, min: number, max: number): Vec3 {
  const apply = (current: number, next: number | undefined): number => {
    const value = typeof next === 'number' && Number.isFinite(next) ? next : current;
    return clamp(value, min, max);
  };
  return {
    x: apply(base.x, patch?.x),
    y: apply(base.y, patch?.y),
    z: apply(base.z, patch?.z),
  };
}

function replaceObject(
  state: SceneState,
  id: string,
  updater: (object: SceneObject) => SceneObject,
): SceneState {
  let changed = false;
  const objects = state.data.objects.map((object) => {
    if (object.id !== id) {
      return object;
    }
    changed = true;
    return updater(object);
  });

  if (!changed) {
    return state;
  }

  return { ...state, data: { ...state.data, objects } };
}

function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(trimmed) ? trimmed : undefined;
}

/**
 * Merges a material patch into the current material, clamping numeric values
 * into their supported ranges. The W4 channels are optional and are only added
 * to the result when they are present on the base or the patch, so scenes that
 * never used them stay byte-for-byte identical.
 */
function mergeMaterial(base: ObjectMaterial, patch: Partial<ObjectMaterial>): ObjectMaterial {
  const clampUnit = (value: number | undefined, current: number): number => {
    const next = typeof value === 'number' && Number.isFinite(value) ? value : current;
    return clamp(next, MATERIAL_LIMITS.metalness.min, MATERIAL_LIMITS.metalness.max);
  };
  const merged: ObjectMaterial = {
    metalness: clampUnit(patch.metalness, base.metalness),
    roughness: clampUnit(patch.roughness, base.roughness),
  };

  const optionalChannel = (
    raw: unknown,
    current: number | undefined,
    range: NumericRange,
  ): number | undefined => {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return clamp(raw, range.min, range.max);
    }
    return current;
  };

  const materialId = patch.materialId ?? base.materialId;
  if (materialId !== undefined) {
    merged.materialId = MATERIAL_PRESET_IDS.has(materialId) ? materialId : base.materialId;
  }
  const opacity = optionalChannel(patch.opacity, base.opacity, PBR_LIMITS.opacity);
  if (opacity !== undefined) merged.opacity = opacity;
  const textureScale = optionalChannel(
    patch.textureScale,
    base.textureScale,
    PBR_LIMITS.textureScale,
  );
  if (textureScale !== undefined) merged.textureScale = textureScale;
  const normalStrength = optionalChannel(
    patch.normalStrength,
    base.normalStrength,
    PBR_LIMITS.normalStrength,
  );
  if (normalStrength !== undefined) merged.normalStrength = normalStrength;
  const emissiveIntensity = optionalChannel(
    patch.emissiveIntensity,
    base.emissiveIntensity,
    PBR_LIMITS.emissiveIntensity,
  );
  if (emissiveIntensity !== undefined) merged.emissiveIntensity = emissiveIntensity;
  const aoIntensity = optionalChannel(
    patch.aoIntensity,
    base.aoIntensity,
    PBR_LIMITS.aoIntensity,
  );
  if (aoIntensity !== undefined) merged.aoIntensity = aoIntensity;

  const baseColor = normalizeHexColor(patch.baseColor) ?? base.baseColor;
  if (baseColor !== undefined) merged.baseColor = baseColor;
  const emissiveColor = normalizeHexColor(patch.emissiveColor) ?? base.emissiveColor;
  if (emissiveColor !== undefined) merged.emissiveColor = emissiveColor;

  // Bitmap references are edited only through SET_MATERIAL_MAP; a scalar slider
  // must never silently drop an assigned texture.
  if (base.maps) {
    merged.maps = base.maps;
  }

  return merged;
}

function withSettings(state: SceneState, settings: SceneSettings): SceneState {
  return { ...state, data: { ...state.data, schemaVersion: SCENE_SCHEMA_VERSION, settings } };
}

function pushHistory(history: SpecHistory | undefined, entry: SpecHistoryEntry): SpecHistory {
  const past = [...(history?.past ?? []), entry];
  return { past: past.slice(-MAX_SPEC_HISTORY), future: [] };
}

/**
 * Pure scene reducer. Every transform/parameter change is scoped to a single
 * object id, so editing one object can never modify another.
 */
export function sceneReducer(state: SceneState, action: SceneAction): SceneState {
  switch (action.type) {
    case 'SET_ROOM': {
      const room = validateRoomConfig({ ...state.data.room, ...action.room });
      return {
        ...state,
        data: { ...state.data, room },
      };
    }

    case 'SET_LAYOUT': {
      // Replace the room and its objects with a generated layout. Objects are
      // validated/deduplicated exactly like a loaded scene, so a bad preset can
      // never inject an invalid object.
      const room = validateRoomConfig(action.room);
      const objects: SceneObject[] = [];
      const seen = new Set<string>();
      for (const candidate of action.objects) {
        const object = validateSceneObject(candidate);
        if (object && !seen.has(object.id)) {
          seen.add(object.id);
          objects.push(object);
        }
      }
      return {
        data: {
          ...state.data,
          schemaVersion: SCENE_SCHEMA_VERSION,
          room,
          objects,
        },
        selectedId: objects[0]?.id ?? ROOM_OBJECT_ID,
      };
    }

    case 'PLACE_AGAINST_WALL':
      return replaceObject(state, action.id, (object) => {
        const wall = action.wall ?? nearestWall(object, state.data.room);
        const placed = placeAgainstWall(object, state.data.room, wall);
        return { ...object, position: placed.position, rotation: placed.rotation };
      });

    case 'SET_ROOM_CEILING': {
      const room = validateRoomConfig({ ...state.data.room, showCeiling: action.showCeiling });
      return { ...state, data: { ...state.data, room } };
    }

    case 'ADD_ROOM_OPENING': {
      const opening = action.opening;
      const current = state.data.room.openings ?? [];
      const next = [...current.filter((entry) => entry.id !== opening.id), opening];
      const room = validateRoomConfig({ ...state.data.room, openings: next });
      return { ...state, data: { ...state.data, room } };
    }

    case 'REMOVE_ROOM_OPENING': {
      const current = state.data.room.openings ?? [];
      const next = current.filter((entry) => entry.id !== action.id);
      const room = validateRoomConfig({ ...state.data.room, openings: next });
      // `validateRoomConfig` omits an empty openings array; drop the key so a
      // room with no openings matches the Stage 6 shape.
      return { ...state, data: { ...state.data, room } };
    }

    case 'ADD_TABLE': {
      const object = createTableSceneObject(action.id);
      return {
        data: {
          ...state.data,
          schemaVersion: SCENE_SCHEMA_VERSION,
          objects: [...state.data.objects, object],
          settings: state.data.settings,
        },
        selectedId: object.id,
      };
    }

    case 'ADD_FURNITURE': {
      const object = createFurnitureSceneObject(action.furnitureType, action.id);
      // Optional explicit parameters (e.g. from the W7 image reference flow) are
      // validated against the object's own type before they are applied.
      if (action.params) {
        const validated = validateFurnitureParams(action.furnitureType, action.params);
        if (validated) {
          object.params = validated;
        }
      }
      // A3.4 F3: the preset is part of creation, not a second step. Only the PBR
      // channels come from the preset; the base colour stays whatever the caller
      // supplied (the AI's colour or the type default), because adopting a
      // preset's colour remains an explicit APPLY_MATERIAL_PRESET action.
      if (action.materialPresetId && MATERIAL_PRESET_IDS.has(action.materialPresetId)) {
        const preset = getMaterialPreset(action.materialPresetId);
        object.material = {
          materialId: preset.id,
          metalness: preset.metalness,
          roughness: preset.roughness,
          opacity: preset.opacity,
          textureScale: preset.textureScale,
          normalStrength: preset.normalStrength,
        };
      }
      return {
        data: {
          ...state.data,
          schemaVersion: SCENE_SCHEMA_VERSION,
          objects: [...state.data.objects, object],
          settings: state.data.settings,
        },
        selectedId: object.id,
      };
    }

    case 'SELECT':
      return { ...state, selectedId: action.id };

    case 'UPDATE_TRANSFORM':
      return replaceObject(state, action.id, (object) => ({
        ...object,
        position: mergeVec3(
          object.position,
          action.position,
          OBJECT_LIMITS.position.min,
          OBJECT_LIMITS.position.max,
        ),
        rotation: mergeVec3(
          object.rotation,
          action.rotation,
          OBJECT_LIMITS.rotation.min,
          OBJECT_LIMITS.rotation.max,
        ),
        scale: mergeVec3(
          object.scale,
          action.scale,
          OBJECT_LIMITS.scale.min,
          OBJECT_LIMITS.scale.max,
        ),
      }));

    case 'RENAME_OBJECT':
      return replaceObject(state, action.id, (object) => {
        const trimmed = action.name.trim();
        return {
          ...object,
          name: trimmed === '' ? object.name : trimmed.slice(0, OBJECT_NAME_MAX_LENGTH),
        };
      });

    case 'ADD_UNIVERSAL_FURNITURE': {
      if (state.data.objects.some((object) => object.id === action.id)) {
        return state;
      }

      // Structure + parser only: the caller already ran the plan validation, and a
      // reducer must not materialise geometry.
      const canonical = canonicalizeFurnitureSpec(action.definitionId, action.spec);
      if (!canonical.ok) {
        return state;
      }

      const object = createUniversalSceneObject(
        canonical.definitionId,
        action.id,
        canonical.spec,
      );
      return {
        data: {
          ...state.data,
          schemaVersion: SCENE_SCHEMA_VERSION,
          objects: [...state.data.objects, object],
          settings: state.data.settings,
        },
        selectedId: object.id,
      };
    }

    case 'UPDATE_SPEC': {
      const object = findSceneObject(state, action.id);
      // Only universal objects are spec-driven; legacy objects use UPDATE_PARAMS.
      if (!object || object.definitionId === undefined || object.spec === undefined) {
        return state;
      }

      // Light, geometry-free gate. The caller has already run the plan/budget
      // validation in `updateFurnitureSpec()`; repeating it here would materialise
      // geometry inside a state transition.
      const canonical = canonicalizeFurnitureSpec(object.definitionId, action.spec);
      if (!canonical.ok) {
        return state;
      }
      if (JSON.stringify(canonical.spec) === JSON.stringify(object.spec)) {
        return state;
      }

      const entry: SpecHistoryEntry = {
        objectId: action.id,
        before: object.spec,
        after: canonical.spec,
      };
      return {
        ...replaceObject(state, action.id, (current) => ({ ...current, spec: canonical.spec })),
        history: pushHistory(state.history, entry),
      };
    }

    case 'UNDO_SPEC': {
      const past = state.history?.past ?? [];
      if (past.length === 0) {
        return state;
      }

      const entry = past[past.length - 1];
      const object = state.data.objects.find((item) => item.id === entry.objectId);
      if (!object) {
        // The object is gone; keep the stack valid instead of resurrecting it.
        return {
          ...state,
          history: { past: past.slice(0, -1), future: state.history?.future ?? [] },
        };
      }

      return {
        ...state,
        data: {
          ...state.data,
          objects: state.data.objects.map((item) =>
            item.id === entry.objectId ? { ...item, spec: entry.before } : item,
          ),
        },
        history: {
          past: past.slice(0, -1),
          future: [entry, ...(state.history?.future ?? [])].slice(0, MAX_SPEC_HISTORY),
        },
      };
    }

    case 'REDO_SPEC': {
      const future = state.history?.future ?? [];
      if (future.length === 0) {
        return state;
      }

      const [entry, ...rest] = future;
      const object = state.data.objects.find((item) => item.id === entry.objectId);
      if (!object) {
        return { ...state, history: { past: state.history?.past ?? [], future: rest } };
      }

      const past = [...(state.history?.past ?? []), entry].slice(-MAX_SPEC_HISTORY);
      return {
        ...state,
        data: {
          ...state.data,
          objects: state.data.objects.map((item) =>
            item.id === entry.objectId ? { ...item, spec: entry.after } : item,
          ),
        },
        history: { past, future: rest },
      };
    }

    case 'UPDATE_PARAMS':
      return replaceObject(state, action.id, (object) => {
        // Universal objects are edited through UPDATE_SPEC: legacy params never
        // drive their geometry, so accepting the write here would show a change
        // the viewer never applies.
        if (object.definitionId !== undefined) {
          return object;
        }
        // Re-validate against the object's own type so a wrong-type or invalid
        // parameter set can never replace a working model.
        const validated = validateFurnitureParams(object.type, action.params);
        return validated ? { ...object, params: validated } : object;
      });

    case 'UPDATE_MATERIAL':
      return replaceObject(state, action.id, (object) => ({
        ...object,
        material: mergeMaterial(object.material, action.material),
      }));

    case 'SET_MATERIAL_MAP': {
      return replaceObject(state, action.id, (object) => {
        const maps = { ...object.material.maps };
        if (action.ref === null) {
          delete maps[action.role];
        } else {
          const validated = validateMaterialAssetMaps({ [action.role]: action.ref });
          if (!validated.ok || !validated.maps[action.role]) {
            return object;
          }
          maps[action.role] = validated.maps[action.role];
        }

        const material: ObjectMaterial = { ...object.material };
        if (Object.keys(maps).length > 0) {
          material.maps = maps;
        } else {
          delete material.maps;
        }
        return { ...object, material };
      });
    }

    case 'SET_SHEET_MATERIAL': {
      const { assignment } = action;
      // The reducer is the last gate before state: an invalid thickness or an
      // unknown material must never reach storage, whatever the UI did.
      if (!isKnownSheetMaterial(assignment.materialId)) {
        return state;
      }
      const thickness = validateSheetThickness(assignment.thicknessMm);
      if (!thickness.ok) {
        return state;
      }
      const partId = assignment.partId.trim();
      if (partId === '') {
        return state;
      }
      return replaceObject(state, action.id, (object) => {
        const current = object.sheetMaterials ?? [];
        const existing = current.findIndex((entry) => entry.partId === partId);
        const next: SheetMaterialEntry = {
          partId,
          materialId: assignment.materialId,
          thicknessMm: thickness.thicknessMm,
          thicknessSource: 'user',
        };
        if (existing >= 0) {
          const updated = [...current];
          updated[existing] = next;
          return { ...object, sheetMaterials: updated };
        }
        if (current.length >= MAX_SHEET_MATERIALS_PER_OBJECT) {
          return object;
        }
        return { ...object, sheetMaterials: [...current, next] };
      });
    }

    case 'REMOVE_SHEET_MATERIAL': {
      return replaceObject(state, action.id, (object) => {
        const current = object.sheetMaterials;
        if (!current || !current.some((entry) => entry.partId === action.partId)) {
          return object;
        }
        const remaining = current.filter((entry) => entry.partId !== action.partId);
        // Drop the field entirely when nothing is left, so the object returns to
        // its pre-assignment shape rather than carrying an empty array.
        if (remaining.length === 0) {
          const { sheetMaterials: _removed, ...rest } = object;
          return rest;
        }
        return { ...object, sheetMaterials: remaining };
      });
    }

    case 'SET_HARDWARE': {
      const result = buildHardwareBom(action.hardware);
      if (!result.ok) {
        return state;
      }
      return replaceObject(state, action.id, (object) => {
        if (!result.hardware.specified) {
          const { hardware: _removed, ...rest } = object;
          return rest;
        }
        return { ...object, hardware: result.hardware.items };
      });
    }

    case 'APPLY_MATERIAL_PRESET': {
      const preset = getMaterialPreset(action.presetId);
      return replaceObject(state, action.id, (object) => {
        const material: ObjectMaterial = {
          materialId: preset.id,
          metalness: preset.metalness,
          roughness: preset.roughness,
          opacity: preset.opacity,
          textureScale: preset.textureScale,
          normalStrength: preset.normalStrength,
          // A preset changes the PBR response, not the user's uploaded bitmap.
          // Removing a texture is the explicit map action (or a material reset).
          ...(object.material.maps ? { maps: object.material.maps } : {}),
        };
        // Universal pieces render one material per slot, so the preset colour
        // needs an explicit material override to be visible; legacy pieces use
        // the existing param colour as the single source of truth.
        if (object.definitionId !== undefined && preset.color) {
          material.baseColor = preset.color;
        }
        return {
          ...object,
          material,
          params: preset.color ? { ...object.params, color: preset.color } : object.params,
        };
      });
    }

    case 'RESET_MATERIAL':
      return replaceObject(state, action.id, (object) => ({
        ...object,
        material: { ...MATERIAL_DEFAULTS },
      }));

    case 'TOGGLE_VISIBILITY':
      return replaceObject(state, action.id, (object) => ({ ...object, visible: !object.visible }));

    case 'DELETE_OBJECT': {
      const objects = state.data.objects.filter((object) => object.id !== action.id);
      if (objects.length === state.data.objects.length) {
        return state;
      }
      // Keep the undo stacks of other objects; only this object's entries go.
      const history = state.history
        ? {
            past: state.history.past.filter((entry) => entry.objectId !== action.id),
            future: state.history.future.filter((entry) => entry.objectId !== action.id),
          }
        : undefined;

      return {
        data: { ...state.data, objects },
        selectedId:
          state.selectedId === action.id ? (objects[0]?.id ?? ROOM_OBJECT_ID) : state.selectedId,
        ...(history ? { history } : {}),
      };
    }

    case 'LOAD_SCENE':
      return {
        data: action.scene,
        selectedId: action.scene.objects[0]?.id ?? ROOM_OBJECT_ID,
      };

    case 'ADD_ASSEMBLY': {
      // W14: assemblies are stored as parameters only; the cap is enforced here
      // and mirrored on the server, so a scene cannot exceed it either way.
      const current = state.data.assemblies ?? [];
      if (current.length >= MAX_ASSEMBLIES_PER_SCENE) {
        return state;
      }
      if (current.some((entry) => entry.id === action.assembly.id)) {
        return state;
      }
      return {
        data: { ...state.data, assemblies: [...current, action.assembly] },
        selectedId: state.selectedId,
      };
    }

    case 'DELETE_ASSEMBLY': {
      const current = state.data.assemblies ?? [];
      if (!current.some((entry) => entry.id === action.id)) {
        return state;
      }
      return {
        data: {
          ...state.data,
          assemblies: current.filter((entry) => entry.id !== action.id),
        },
        selectedId: state.selectedId,
      };
    }

    case 'NEW_SCENE': {
      const object = createTableSceneObject(action.id);
      return {
        data: {
          schemaVersion: SCENE_SCHEMA_VERSION,
          room: validateRoomConfig({}),
          objects: [object],
          settings: createDefaultSettings(),
        },
        selectedId: object.id,
      };
    }

    case 'SET_BACKGROUND': {
      const background = validateColor(action.color, state.data.settings.background);
      return withSettings(state, { ...state.data.settings, background });
    }

    case 'UPDATE_LIGHTS': {
      const lights = validateSceneSettings({
        ...state.data.settings,
        lights: { ...state.data.settings.lights, ...action.lights },
      }).lights;
      // Editing a light by hand means the values no longer come from a preset.
      return withSettings(state, { ...state.data.settings, lights, lightingPreset: 'custom' });
    }

    case 'RESET_LIGHTS':
      return withSettings(state, {
        ...state.data.settings,
        lights: createDefaultSettings().lights,
      });

    case 'APPLY_LIGHTING_PRESET': {
      const preset = isLightingPresetId(action.preset)
        ? action.preset
        : state.data.settings.lightingPreset;
      if (preset === 'custom') {
        return state;
      }
      const config = LIGHTING_PRESET_CONFIGS[preset];
      // Write the preset's concrete light values so the manual controls reflect
      // exactly what the renderer will use (single source of truth = settings.lights).
      const lights = validateSceneSettings({
        ...state.data.settings,
        lights: { ...state.data.settings.lights, ...config },
      }).lights;
      return withSettings(state, { ...state.data.settings, lights, lightingPreset: preset });
    }

    case 'UPDATE_ROOM_MATERIALS':
      return withSettings(state, {
        ...state.data.settings,
        roomMaterials: validateSceneSettings({
          ...state.data.settings,
          roomMaterials: {
            floorColor: action.floorColor ?? state.data.settings.roomMaterials.floorColor,
            wallColor: action.wallColor ?? state.data.settings.roomMaterials.wallColor,
            ceilingColor: action.ceilingColor ?? state.data.settings.roomMaterials.ceilingColor,
          },
        }).roomMaterials,
      });

    case 'SET_CAMERA_PRESET': {
      const cameraPreset = (CAMERA_PRESETS as readonly string[]).includes(action.preset)
        ? action.preset
        : state.data.settings.cameraPreset;
      return withSettings(state, { ...state.data.settings, cameraPreset });
    }

    case 'SET_RENDER_QUALITY': {
      const qualityPreset = isQualityPresetId(action.quality)
        ? action.quality
        : state.data.settings.qualityPreset;
      return withSettings(state, { ...state.data.settings, qualityPreset });
    }

    case 'SET_EXPOSURE':
      return withSettings(state, {
        ...state.data.settings,
        exposure: validateExposure(action.exposure, state.data.settings.exposure),
      });

    case 'SET_TONE_MAPPING': {
      const toneMapping = isToneMappingMode(action.toneMapping)
        ? action.toneMapping
        : state.data.settings.toneMapping;
      return withSettings(state, { ...state.data.settings, toneMapping });
    }

    default:
      return state;
  }
}

export function findSceneObject(state: SceneState, id: string | null): SceneObject | null {
  if (!id) {
    return null;
  }
  return state.data.objects.find((object) => object.id === id) ?? null;
}
