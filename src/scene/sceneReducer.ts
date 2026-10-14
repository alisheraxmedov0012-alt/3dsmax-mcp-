import type { TableParams } from '../geometry/tableParams';
import { getMaterialPreset, MATERIAL_PRESET_IDS } from '../materials/presets';
import { PBR_LIMITS, type NumericRange } from '../materials/types';
import { validateRoomConfig } from './sceneValidation';
import { createDefaultSettings, validateColor, validateSceneSettings, CAMERA_PRESETS, type LightSettings, type CameraPreset, type SceneSettings } from './sceneSettings';
import {
  MATERIAL_DEFAULTS,
  MATERIAL_LIMITS,
  OBJECT_NAME_MAX_LENGTH,
  OBJECT_LIMITS,
  ROOM_OBJECT_ID,
  SCENE_SCHEMA_VERSION,
  createTableSceneObject,
  type ObjectMaterial,
  type RoomConfig,
  type SceneData,
  type SceneObject,
  type SceneState,
  type Vec3,
} from './types';

export type SceneAction =
  | { type: 'SET_ROOM'; room: Partial<RoomConfig> }
  | { type: 'ADD_TABLE'; id: string }
  | { type: 'SELECT'; id: string | null }
  | {
      type: 'UPDATE_TRANSFORM';
      id: string;
      position?: Partial<Vec3>;
      rotation?: Partial<Vec3>;
      scale?: Partial<Vec3>;
    }
  | { type: 'RENAME_OBJECT'; id: string; name: string }
  | { type: 'UPDATE_PARAMS'; id: string; params: TableParams }
  | { type: 'UPDATE_MATERIAL'; id: string; material: Partial<ObjectMaterial> }
  | { type: 'APPLY_MATERIAL_PRESET'; id: string; presetId: string }
  | { type: 'RESET_MATERIAL'; id: string }
  | { type: 'TOGGLE_VISIBILITY'; id: string }
  | { type: 'DELETE_OBJECT'; id: string }
  | { type: 'SET_BACKGROUND'; color: string }
  | { type: 'UPDATE_LIGHTS'; lights: Partial<LightSettings> }
  | { type: 'RESET_LIGHTS' }
  | { type: 'UPDATE_ROOM_MATERIALS'; floorColor?: string; wallColor?: string }
  | { type: 'SET_CAMERA_PRESET'; preset: CameraPreset }
  | { type: 'LOAD_SCENE'; scene: SceneData }
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

  return merged;
}

function withSettings(state: SceneState, settings: SceneSettings): SceneState {
  return { ...state, data: { ...state.data, schemaVersion: SCENE_SCHEMA_VERSION, settings } };
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

    case 'UPDATE_PARAMS':
      return replaceObject(state, action.id, (object) => ({ ...object, params: action.params }));

    case 'UPDATE_MATERIAL':
      return replaceObject(state, action.id, (object) => ({
        ...object,
        material: mergeMaterial(object.material, action.material),
      }));

    case 'APPLY_MATERIAL_PRESET': {
      const preset = getMaterialPreset(action.presetId);
      return replaceObject(state, action.id, (object) => ({
        ...object,
        material: {
          materialId: preset.id,
          metalness: preset.metalness,
          roughness: preset.roughness,
          opacity: preset.opacity,
          textureScale: preset.textureScale,
          normalStrength: preset.normalStrength,
        },
        // A preset may suggest a base colour; apply it through the existing
        // table colour so there is still a single source of truth.
        params: preset.color ? { ...object.params, color: preset.color } : object.params,
      }));
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
      return {
        data: { ...state.data, objects },
        selectedId:
          state.selectedId === action.id ? (objects[0]?.id ?? ROOM_OBJECT_ID) : state.selectedId,
      };
    }

    case 'LOAD_SCENE':
      return {
        data: action.scene,
        selectedId: action.scene.objects[0]?.id ?? ROOM_OBJECT_ID,
      };

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
      return withSettings(state, { ...state.data.settings, lights });
    }

    case 'RESET_LIGHTS':
      return withSettings(state, {
        ...state.data.settings,
        lights: createDefaultSettings().lights,
      });

    case 'UPDATE_ROOM_MATERIALS':
      return withSettings(state, {
        ...state.data.settings,
        roomMaterials: validateSceneSettings({
          ...state.data.settings,
          roomMaterials: {
            floorColor: action.floorColor ?? state.data.settings.roomMaterials.floorColor,
            wallColor: action.wallColor ?? state.data.settings.roomMaterials.wallColor,
          },
        }).roomMaterials,
      });

    case 'SET_CAMERA_PRESET': {
      const cameraPreset = (CAMERA_PRESETS as readonly string[]).includes(action.preset)
        ? action.preset
        : state.data.settings.cameraPreset;
      return withSettings(state, { ...state.data.settings, cameraPreset });
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
