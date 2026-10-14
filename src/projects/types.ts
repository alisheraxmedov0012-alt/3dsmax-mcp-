import type { TableParams } from '../geometry/tableParams';

/** Persisted representation of a user project. */
export interface SavedProject {
  id: string;
  name: string;
  params: TableParams;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
}

/** Data required to create or update a project. */
export interface ProjectInput {
  name: string;
  params: TableParams;
}

export const PROJECTS_SCHEMA_VERSION = 1;
export const PROJECTS_STORAGE_KEY = '3d-studio-ai.projects.v1';
export const MAX_PROJECT_NAME_LENGTH = 60;
export const DEFAULT_PROJECT_NAME = 'Nomsiz loyiha';

/**
 * Storage abstraction for projects. Async so a real backend (per the plan's
 * data layer) can implement the same interface later without UI changes.
 */
export interface ProjectRepository {
  list(): Promise<SavedProject[]>;
  create(input: ProjectInput): Promise<SavedProject>;
  update(id: string, input: ProjectInput): Promise<SavedProject | null>;
  remove(id: string): Promise<boolean>;
}
