/**
 * W8 export filename rules.
 *
 * Kept pure and deterministic so the naming policy is testable and consistent
 * across formats (also useful for marketplace uploads later, which expect clean,
 * predictable file names).
 */
import type { ExportMetadata } from './exportTypes';

/** Max length of the sanitized name portion, before the extension. */
export const MAX_NAME_LENGTH = 48;

/**
 * Convert a free-text project name into a safe filename slug: ASCII letters,
 * digits and single dashes. Non-ASCII (e.g. Uzbek accented letters) are dropped
 * rather than transliterated, and a fallback is used when nothing remains.
 */
export function slugifyName(value: string, fallback = 'model'): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_NAME_LENGTH)
    .replace(/-+$/g, '');
  return slug === '' ? fallback : slug;
}

/**
 * Build the export filename: `{slug}[-{type}].{ext}`.
 * The furniture type is included when known so a marketplace listing can tell
 * pieces apart at a glance.
 */
export function buildExportFilename(
  metadata: ExportMetadata,
  extension: string,
): string {
  const slug = slugifyName(metadata.name);
  const type = metadata.furnitureType ? slugifyName(metadata.furnitureType, '') : '';
  const base = type && type !== slug ? `${slug}-${type}` : slug;
  return `${base}.${extension}`;
}
