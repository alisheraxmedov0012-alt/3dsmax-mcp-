import {
  deserializeProjects,
  serializeProjects,
} from './projectValidation';
import {
  DEFAULT_PROJECT_NAME,
  MAX_PROJECT_NAME_LENGTH,
  PROJECTS_SCHEMA_VERSION,
  PROJECTS_STORAGE_KEY,
  type ProjectInput,
  type ProjectRepository,
  type SavedProject,
} from './types';

export interface LocalRepositoryOptions {
  storage: Storage;
  now?: () => string;
  generateId?: () => string;
  storageKey?: string;
}

function defaultGenerateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  return trimmed === '' ? DEFAULT_PROJECT_NAME : trimmed.slice(0, MAX_PROJECT_NAME_LENGTH);
}

function sortByUpdatedDesc(projects: SavedProject[]): SavedProject[] {
  return [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Browser-local project repository backed by Web Storage (localStorage).
 *
 * This is a temporary stand-in for the plan's backend data layer and keeps data
 * on a single device/browser only — it is NOT synchronized across devices.
 * The async {@link ProjectRepository} interface allows a backend implementation
 * to replace it later without changing the UI.
 */
export function createLocalProjectRepository(
  options: LocalRepositoryOptions,
): ProjectRepository {
  const storage = options.storage;
  const now = options.now ?? (() => new Date().toISOString());
  const generateId = options.generateId ?? defaultGenerateId;
  const storageKey = options.storageKey ?? PROJECTS_STORAGE_KEY;

  function readAll(): SavedProject[] {
    return deserializeProjects(storage.getItem(storageKey)).projects;
  }

  function writeAll(projects: SavedProject[]): void {
    storage.setItem(storageKey, serializeProjects(projects));
  }

  return {
    async list(): Promise<SavedProject[]> {
      return sortByUpdatedDesc(readAll());
    },

    async create(input: ProjectInput): Promise<SavedProject> {
      const timestamp = now();
      const project: SavedProject = {
        id: generateId(),
        name: normalizeName(input.name),
        scene: input.scene,
        createdAt: timestamp,
        updatedAt: timestamp,
        schemaVersion: PROJECTS_SCHEMA_VERSION,
      };

      writeAll([...readAll(), project]);
      return project;
    },

    async update(id: string, input: ProjectInput): Promise<SavedProject | null> {
      const projects = readAll();
      const index = projects.findIndex((project) => project.id === id);
      if (index === -1) {
        return null;
      }

      const updated: SavedProject = {
        ...projects[index],
        name: normalizeName(input.name),
        scene: input.scene,
        updatedAt: now(),
      };

      projects[index] = updated;
      writeAll(projects);
      return updated;
    },

    async remove(id: string): Promise<boolean> {
      const projects = readAll();
      const remaining = projects.filter((project) => project.id !== id);
      if (remaining.length === projects.length) {
        return false;
      }
      writeAll(remaining);
      return true;
    },
  };
}
