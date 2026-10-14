import type { SavedProject } from '../projects/types';
import { MAX_PROJECT_NAME_LENGTH } from '../projects/types';

export type ProjectsStatus = 'idle' | 'ok' | 'error';

interface ProjectsPanelProps {
  projects: SavedProject[];
  activeId: string | null;
  name: string;
  status: ProjectsStatus;
  message: string;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onNew: () => void;
  onOpen: (project: SavedProject) => void;
  onDelete: (project: SavedProject) => void;
}

export function ProjectsPanel({
  projects,
  activeId,
  name,
  status,
  message,
  onNameChange,
  onSave,
  onNew,
  onOpen,
  onDelete,
}: ProjectsPanelProps) {
  const hasActive = activeId !== null;

  return (
    <section className="projects">
      <h2 className="projects__title">Loyihalar</h2>

      <input
        className="field__input"
        type="text"
        value={name}
        maxLength={MAX_PROJECT_NAME_LENGTH}
        placeholder="Loyiha nomi"
        aria-label="Loyiha nomi"
        onChange={(event) => onNameChange(event.target.value)}
      />

      <div className="projects__actions">
        <button type="button" className="projects__save" onClick={onSave}>
          {hasActive ? 'Yangilash' : 'Saqlash'}
        </button>
        <button type="button" className="projects__new" onClick={onNew} disabled={!hasActive}>
          Yangi loyiha
        </button>
      </div>

      {message &&
        (status === 'error' ? (
          <p className="projects__message projects__message--error" role="alert">
            {message}
          </p>
        ) : (
          <p className="projects__message" role="status" aria-live="polite">
            {message}
          </p>
        ))}

      {projects.length === 0 ? (
        <p className="projects__empty">Hozircha saqlangan loyihalar yo'q.</p>
      ) : (
        <ul className="projects__list">
          {projects.map((project) => (
            <li
              key={project.id}
              className={
                project.id === activeId ? 'project project--active' : 'project'
              }
            >
              <div className="project__info">
                <span className="project__name">{project.name}</span>
                <span className="project__meta">
                  {project.params.widthCm} × {project.params.depthCm} × {project.params.heightCm} sm
                </span>
              </div>
              <div className="project__actions">
                <button
                  type="button"
                  className="project__open"
                  onClick={() => onOpen(project)}
                  aria-label={`${project.name} loyihasini ochish`}
                >
                  Ochish
                </button>
                <button
                  type="button"
                  className="project__delete"
                  onClick={() => onDelete(project)}
                  aria-label={`${project.name} loyihasini o'chirish`}
                >
                  O'chirish
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="projects__hint">
        Loyihalar shu brauzerda (qurilmada) saqlanadi va boshqa qurilmalar bilan
        sinxronlanmaydi.
      </p>
    </section>
  );
}
