import {
  validateFurnitureParams,
  type FurnitureParams,
  type FurnitureType,
} from '../geometry/furniture';
import { getMaterialPreset, MATERIAL_PRESET_IDS } from '../materials/presets';
import {
  isKnownSheetMaterial,
  validateSheetThickness,
  type SheetMaterialEntry,
} from '../manufacturing/sheetMaterial';
import { MAX_SHEET_MATERIALS_PER_OBJECT } from './types';
import { PBR_LIMITS, type NumericRange } from '../materials/types';
import { validateRoomConfig, validateSceneObject } from './sceneValidation';
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
  | { type: 'ADD_FURNITURE'; furnitureType: FurnitureType; id: string; params?: FurnitureParams }
  | { type: 'SELECT'; id: string | null }
  | {
      type: 'UPDATE_TRANSFORM';
      id: string;
      position?: Partial<Vec3>;
      rotation?: Partial<Vec3>;
      scale?: Partial<Vec3>;
    }
  | { type: 'RENAME_OBJECT'; id: string; name: string }
  | { type: 'UPDATE_PARAMS'; id: string; params: FurnitureParams }
  | { type: 'UPDATE_MATERIAL'; id: string; material: Partial<ObjectMaterial> }
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
      return replaceObject(state, action.id, (object) => {
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
