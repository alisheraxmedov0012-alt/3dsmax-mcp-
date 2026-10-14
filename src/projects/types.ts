import type { SceneData } from '../scene/types';

/**
 * Persisted representation of a user project.
 *
 * v1 (Stages 1–4): table-only `params`.
 * v2 (Stage 5): full scene.
 * v3 (Stage 6): scene + visualization settings (background, lights, room
 * materials, camera preset) and per-object PBR material. Older records are
 * migrated on load (see `projectValidation.ts`).
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

export const PROJECTS_SCHEMA_VERSION = 3;
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
