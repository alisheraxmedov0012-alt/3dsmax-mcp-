import { ROOM_OBJECT_ID, type RoomConfig, type SceneObject } from '../scene/types';

interface SceneHierarchyPanelProps {
  room: RoomConfig;
  objects: SceneObject[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onDelete: (id: string) => void;
  onAddTable: () => void;
}

export function SceneHierarchyPanel({
  room,
  objects,
  selectedId,
  onSelect,
  onToggleVisibility,
  onDelete,
  onAddTable,
}: SceneHierarchyPanelProps) {
  return (
    <section className="hierarchy">
      <h2 className="hierarchy__title">Sahna obyektlari</h2>

      <button type="button" className="hierarchy__add" onClick={onAddTable}>
        Stol qo'shish
      </button>

      <ul className="hierarchy__list">
        <li
          className={
            selectedId === ROOM_OBJECT_ID ? 'node node--room node--selected' : 'node node--room'
          }
        >
          <button
            type="button"
            className="node__select"
            onClick={() => onSelect(ROOM_OBJECT_ID)}
            aria-pressed={selectedId === ROOM_OBJECT_ID}
          >
            <span className="node__name">Xona</span>
            <span className="node__meta">
              {room.widthCm} × {room.lengthCm} × {room.heightCm} sm
            </span>
          </button>
        </li>

        {objects.map((object) => {
          const isSelected = selectedId === object.id;
          return (
            <li
              key={object.id}
              className={isSelected ? 'node node--selected' : 'node'}
            >
              <button
                type="button"
                className="node__select"
                onClick={() => onSelect(object.id)}
                aria-pressed={isSelected}
              >
                <span className="node__name">{object.name}</span>
                <span className="node__meta">
                  {object.visible ? '' : 'yashirilgan · '}
                  {object.params.widthCm} × {object.params.depthCm} × {object.params.heightCm} sm
                </span>
              </button>
              <div className="node__actions">
                <button
                  type="button"
                  className="node__visibility"
                  onClick={() => onToggleVisibility(object.id)}
                  aria-label={`${object.name} ${object.visible ? 'yashirish' : "ko'rsatish"}`}
                >
                  {object.visible ? 'Yashirish' : "Ko'rsatish"}
                </button>
                <button
                  type="button"
                  className="node__delete"
                  onClick={() => onDelete(object.id)}
                  aria-label={`${object.name} o'chirish`}
                >
                  O'chirish
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {objects.length === 0 && <p className="hierarchy__empty">Sahnada obyekt yo'q.</p>}
    </section>
  );
}
