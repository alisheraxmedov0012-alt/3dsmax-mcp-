import { useMemo, useState } from 'react';
import { buildSceneHierarchy, type HierarchyItem } from '../scene/hierarchy';
import {
  OBJECT_NAME_MAX_LENGTH,
  type RoomConfig,
  type RoomInstance,
  type SceneObject,
} from '../scene/types';

interface SceneHierarchyPanelProps {
  room: RoomConfig;
  rooms?: readonly RoomInstance[];
  objects: readonly SceneObject[];
  selectedId: string | null;
  onSelect: (selectionId: string) => void;
  /** Generic selection id: furniture object id, room-instance id or legacy room. */
  onToggleVisibility: (selectionId: string) => void;
  onDelete: (objectId: string) => void;
  onAddTable: () => void;
  onRename: (selectionId: string, name: string) => void;
  onFocus: (selectionId: string) => void;
}

const EMPTY_ROOMS: readonly RoomInstance[] = [];

const ICONS: Record<HierarchyItem['entityType'], string> = {
  furniture: '▣',
  imported: '⇩',
  room: '⌂',
  'legacy-room': '⌂',
};

export function SceneHierarchyPanel({
  room,
  rooms = EMPTY_ROOMS,
  objects,
  selectedId,
  onSelect,
  onToggleVisibility,
  onDelete,
  onAddTable,
  onRename,
  onFocus,
}: SceneHierarchyPanelProps) {
  const hierarchy = useMemo(
    () => buildSceneHierarchy({ room, rooms, objects }, selectedId),
    [room, rooms, objects, selectedId],
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const beginRename = (item: HierarchyItem): void => {
    if (!item.canRename) {
      return;
    }
    setEditingId(item.id);
    setDraft(item.displayName);
  };

  const commitRename = (): void => {
    if (!editingId) {
      return;
    }
    const name = draft.trim();
    setEditingId(null);
    if (name !== '') {
      onRename(editingId, name.slice(0, OBJECT_NAME_MAX_LENGTH));
    }
  };

  const renderItem = (item: HierarchyItem) => {
    const isEditing = editingId === item.id;
    const className = [
      'node',
      item.selected ? 'node--selected' : '',
      item.visible ? '' : 'node--hidden',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <li key={item.id} className={className}>
        <span className="node__icon" aria-hidden="true" title={item.typeLabel}>
          {ICONS[item.entityType]}
        </span>
        {isEditing ? (
          <input
            className="node__rename-input"
            value={draft}
            maxLength={OBJECT_NAME_MAX_LENGTH}
            autoFocus
            aria-label={`${item.displayName} yangi nomi`}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitRename();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setEditingId(null);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="node__select"
            onClick={() => onSelect(item.id)}
            aria-pressed={item.selected}
            disabled={!item.visible}
            title={item.visible ? item.typeLabel : `${item.typeLabel} · yashirilgan`}
          >
            <span className="node__name">{item.displayName}</span>
            <span className="node__meta">
              {item.visible ? '' : 'yashirilgan · '}
              {item.meta}
            </span>
          </button>
        )}
        <div className="node__actions">
          {item.canRename && !isEditing && (
            <button
              type="button"
              className="node__icon-button"
              onClick={() => beginRename(item)}
              aria-label={`${item.displayName} nomini o'zgartirish`}
              title="Nomini o'zgartirish"
            >
              ✎
            </button>
          )}
          {item.canFocus && item.visible && (
            <button
              type="button"
              className="node__icon-button"
              onClick={() => onFocus(item.id)}
              aria-label={`${item.displayName} ga fokus`}
              title="Kamerani fokuslash"
            >
              ◎
            </button>
          )}
          {item.canToggleVisibility && (
            <button
              type="button"
              className="node__visibility"
              onClick={() => onToggleVisibility(item.id)}
              aria-label={`${item.displayName} ${item.visible ? 'yashirish' : "ko'rsatish"}`}
            >
              {item.visible ? 'Yashirish' : "Ko'rsatish"}
            </button>
          )}
          {item.canDelete && (
            <button
              type="button"
              className="node__delete"
              onClick={() => onDelete(item.entityId)}
              aria-label={`${item.displayName} o'chirish`}
            >
              O'chirish
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <section className="hierarchy">
      <h2 className="hierarchy__title">Scene Hierarchy</h2>

      <button type="button" className="hierarchy__add" onClick={onAddTable}>
        Stol qo'shish
      </button>

      <div className="hierarchy__scroll">
        <div className="hierarchy__group">
          <h3 className="hierarchy__group-title">
            Rooms <span className="hierarchy__count">{hierarchy.rooms.length}</span>
          </h3>
          <ul className="hierarchy__list" aria-label="Xonalar">
            {hierarchy.rooms.map(renderItem)}
          </ul>
        </div>

        <div className="hierarchy__group">
          <h3 className="hierarchy__group-title">
            Furniture <span className="hierarchy__count">{hierarchy.furniture.length}</span>
          </h3>
          {hierarchy.furniture.length > 0 ? (
            <ul className="hierarchy__list" aria-label="Mebel">
              {hierarchy.furniture.map(renderItem)}
            </ul>
          ) : (
            <p className="hierarchy__empty">Sahnada mebel yo'q.</p>
          )}
        </div>
      </div>

      {hierarchy.isEmpty && (
        <p className="hierarchy__empty">Sahnada qo'shimcha obyekt yo'q.</p>
      )}
    </section>
  );
}
