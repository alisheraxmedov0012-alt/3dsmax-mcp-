/**
 * Phase 9A.2.11 — derived scene hierarchy.
 *
 * The panel is a view over `SceneData`, not a second registry: every item is
 * rebuilt deterministically from the scene arrays, with the legacy room first,
 * then opt-in rooms, then furniture objects in scene order.
 */
import {
  ROOM_OBJECT_ID,
  isImportedSceneObject,
  type RoomConfig,
  type RoomInstance,
  type SceneObject,
} from './types';
import { roomSelectionId } from './selectionIds';

export type HierarchyEntityType = 'furniture' | 'room' | 'legacy-room' | 'imported';
export type HierarchyGroupId = 'rooms' | 'furniture';

export interface HierarchyItem {
  /** Selection id used by `SceneState.selectedId` and `SceneViewer.onSelect`. */
  readonly id: string;
  readonly entityId: string;
  readonly entityType: HierarchyEntityType;
  readonly displayName: string;
  readonly visible: boolean;
  readonly selected: boolean;
  readonly group: HierarchyGroupId;
  readonly parentId: string | null;
  readonly meta: string;
  readonly typeLabel: string;
  readonly canRename: boolean;
  readonly canToggleVisibility: boolean;
  readonly canFocus: boolean;
  readonly canDelete: boolean;
}

export interface SceneHierarchy {
  readonly rooms: readonly HierarchyItem[];
  readonly furniture: readonly HierarchyItem[];
  readonly items: readonly HierarchyItem[];
  /** True when the scene has no furniture and no opt-in rooms (legacy room aside). */
  readonly isEmpty: boolean;
}

export interface HierarchySceneSource {
  readonly room: RoomConfig;
  readonly rooms?: readonly RoomInstance[];
  readonly objects: readonly SceneObject[];
}

function fallbackName(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function importedSizeLabel(object: SceneObject): string {
  const bounds = object.imported?.boundsCm;
  if (!bounds) {
    return '—';
  }
  const { min, max } = bounds;
  return [max.x - min.x, max.y - min.y, max.z - min.z]
    .map((value) => value.toFixed(0))
    .join(' × ');
}

function furnitureMeta(object: SceneObject): string {
  if (isImportedSceneObject(object)) {
    return `${importedSizeLabel(object)} sm · import`;
  }
  return `${object.params.widthCm} × ${object.params.depthCm} × ${object.params.heightCm} sm`;
}

export function buildSceneHierarchy(
  scene: HierarchySceneSource,
  selectedId: string | null,
): SceneHierarchy {
  const legacyRoom: HierarchyItem = {
    id: ROOM_OBJECT_ID,
    entityId: ROOM_OBJECT_ID,
    entityType: 'legacy-room',
    displayName: 'Xona',
    visible: true,
    selected: selectedId === ROOM_OBJECT_ID,
    group: 'rooms',
    parentId: null,
    meta: `${scene.room.widthCm} × ${scene.room.lengthCm} × ${scene.room.heightCm} sm`,
    typeLabel: 'Asosiy xona',
    canRename: false,
    canToggleVisibility: false,
    canFocus: true,
    canDelete: false,
  };

  const roomItems = (scene.rooms ?? []).map<HierarchyItem>((room) => ({
    id: roomSelectionId(room.id),
    entityId: room.id,
    entityType: 'room',
    displayName: fallbackName(room.name, `Xona ${room.id.slice(0, 8)}`),
    visible: room.visible,
    selected: selectedId === roomSelectionId(room.id),
    group: 'rooms',
    parentId: null,
    meta: `${room.spec.widthCm} × ${room.spec.lengthCm} × ${room.spec.heightCm} sm`,
    typeLabel: 'Interior xona',
    canRename: true,
    canToggleVisibility: true,
    canFocus: true,
    canDelete: false,
  }));

  const furnitureItems = scene.objects.map<HierarchyItem>((object) => {
    const imported = isImportedSceneObject(object);
    return {
      id: object.id,
      entityId: object.id,
      entityType: imported ? 'imported' : 'furniture',
      displayName: fallbackName(object.name, imported ? 'Import' : object.type),
      visible: object.visible,
      selected: selectedId === object.id,
      group: 'furniture',
      parentId: null,
      meta: furnitureMeta(object),
      typeLabel: imported ? 'Import' : 'Mebel',
      canRename: true,
      canToggleVisibility: true,
      canFocus: true,
      canDelete: true,
    };
  });

  const rooms = Object.freeze([legacyRoom, ...roomItems]);
  const furniture = Object.freeze(furnitureItems);
  return Object.freeze({
    rooms,
    furniture,
    items: Object.freeze([...rooms, ...furniture]),
    isEmpty: (scene.rooms?.length ?? 0) === 0 && scene.objects.length === 0,
  });
}
