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
 * FNV-1a constants for the 64-bit digest below.
 *
 * A digest is needed because {@link slugifyName} is deliberately lossy: it
 * drops every non-ASCII character and collapses punctuation, so `Ошхона шкаф`
 * and `Кухня` both become `model`, and `Kitchen Table` and `Kitchen-Table` both
 * become `kitchen-table`. No slug-only rule can separate those, because the
 * information that distinguished them is what the slug throws away.
 */
const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** Hex characters kept from the digest: 48 bits, ~1 in 2.8e14 for a pair. */
const DIGEST_LENGTH = 12;

/**
 * Stable digest of a project name, safe to embed in a filename.
 *
 * FNV-1a over the UTF-8 bytes of the NFC-normalised name, so the same name
 * always yields the same value regardless of platform, and names that differ at
 * all (case, script, punctuation) yield different values. Not cryptographic —
 * it only has to keep filenames apart, never to resist an attacker.
 */
export function nameDigest(value: string): string {
  let hash = FNV_OFFSET_64;
  for (const byte of new TextEncoder().encode(value.normalize('NFC'))) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0').slice(0, DIGEST_LENGTH);
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
