import { migrateLegacyParamsToScene, validateSceneData } from '../scene/sceneValidation';
import type { SceneData } from '../scene/types';
import {
  DEFAULT_PROJECT_NAME,
  MAX_PROJECT_NAME_LENGTH,
  PROJECTS_SCHEMA_VERSION,
  type SavedProject,
} from './types';

export interface DeserializeResult {
  projects: SavedProject[];
  /** Number of stored entries that were invalid and therefore skipped. */
  skipped: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeName(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_PROJECT_NAME;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return DEFAULT_PROJECT_NAME;
  }
  return trimmed.slice(0, MAX_PROJECT_NAME_LENGTH);
}

function sanitizeTimestamp(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Resolves the scene for a stored record, migrating legacy (v1) table-only
 * projects that only carry `params`. Returns null when neither a usable scene
 * nor legacy parameters are present.
 */
function resolveScene(value: Record<string, unknown>): SceneData | null {
  if (isRecord(value.scene)) {
    const result = validateSceneData(value.scene);
    return result.scene;
  }

  if (isRecord(value.params)) {
    const params = value.params;
    return migrateLegacyParamsToScene({
      widthCm: Number(params.widthCm),
      heightCm: Number(params.heightCm),
      depthCm: Number(params.depthCm),
      color: typeof params.color === 'string' ? params.color : '',
    });
  }

  return null;
}

/**
 * Validates one stored record. Returns a normalized, migrated project or `null`
 * when the entry is unusable (so a single corrupt record cannot break loading).
 */
export function validateSavedProject(value: unknown): SavedProject | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value.id;
  if (typeof id !== 'string' || id.trim() === '') {
    return null;
  }

  const scene = resolveScene(value);
  if (!scene) {
    return null;
  }

  return {
    id: id.trim(),
    name: sanitizeName(value.name),
    scene,
    createdAt: sanitizeTimestamp(value.createdAt),
    updatedAt: sanitizeTimestamp(value.updatedAt),
    schemaVersion: PROJECTS_SCHEMA_VERSION,
  };
}

/**
 * Parses the raw stored string into a list of valid projects. Tolerates
 * malformed JSON, a missing container and individual invalid entries.
 */
export function deserializeProjects(raw: string | null): DeserializeResult {
  if (raw === null || raw === '') {
    return { projects: [], skipped: 0 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { projects: [], skipped: 0 };
  }

  const list = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.projects)
      ? parsed.projects
      : [];

  const projects: SavedProject[] = [];
  let skipped = 0;

  list.forEach((entry) => {
    const project = validateSavedProject(entry);
    if (project) {
      projects.push(project);
    } else {
      skipped += 1;
    }
  });

  return { projects, skipped };
}

export function serializeProjects(projects: SavedProject[]): string {
  return JSON.stringify({ schemaVersion: PROJECTS_SCHEMA_VERSION, projects });
}
