import { parseTableValues, type TableFieldValues } from '../geometry/tableParams';
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

function coerceFieldValues(params: Record<string, unknown>): TableFieldValues {
  return {
    widthCm: String(params.widthCm ?? ''),
    heightCm: String(params.heightCm ?? ''),
    depthCm: String(params.depthCm ?? ''),
    color: typeof params.color === 'string' ? params.color : '',
  };
}

/**
 * Validates one stored record. Returns a normalized project or `null` when the
 * entry is unusable (so a single corrupt record cannot break loading).
 */
export function validateSavedProject(value: unknown): SavedProject | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value.id;
  if (typeof id !== 'string' || id.trim() === '') {
    return null;
  }

  if (!isRecord(value.params)) {
    return null;
  }

  const parsed = parseTableValues(coerceFieldValues(value.params));
  if (!parsed.params) {
    return null;
  }

  return {
    id: id.trim(),
    name: sanitizeName(value.name),
    params: parsed.params,
    createdAt: sanitizeTimestamp(value.createdAt),
    updatedAt: sanitizeTimestamp(value.updatedAt),
    schemaVersion:
      typeof value.schemaVersion === 'number' ? value.schemaVersion : PROJECTS_SCHEMA_VERSION,
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
