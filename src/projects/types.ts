import type { SceneData } from '../scene/types';

/**
 * Persisted representation of a user project (Stage 5, schema v2).
 *
 * v1 (Stages 1–4) stored only `params: TableParams`. v2 stores a full scene.
 * Old v1 records are migrated on load (see `projectValidation.ts`), so
 * table-only projects remain loadable.
 */
export interface SavedProject {
  id: string;
  name: string;
  scene: SceneData;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
}

/** Data required to create or update a project. */
export interface ProjectInput {
  name: string;
  scene: SceneData;
}

export const PROJECTS_SCHEMA_VERSION = 2;
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
