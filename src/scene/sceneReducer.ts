import type { TableParams } from '../geometry/tableParams';
import { validateRoomConfig } from './sceneValidation';
import {
  OBJECT_NAME_MAX_LENGTH,
  OBJECT_LIMITS,
  ROOM_OBJECT_ID,
  SCENE_SCHEMA_VERSION,
  createTableSceneObject,
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
  | { type: 'TOGGLE_VISIBILITY'; id: string }
  | { type: 'DELETE_OBJECT'; id: string }
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
        },
        selectedId: object.id,
      };
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
