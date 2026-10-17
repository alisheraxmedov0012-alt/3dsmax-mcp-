/**
 * W14 — feature flag for assemblies.
 *
 * Assemblies ship behind a flag so the whole feature can be switched off without
 * a code change if something goes wrong after merge (plan §13, rollback level
 * R1). With the flag off, no assembly UI is rendered and no assembly is built;
 * the eight furniture types, the viewer, export and manufacturing paths are
 * untouched.
 *
 * Default is **off**. It is turned on by setting `VITE_ASSEMBLY_ENABLED=true` at
 * build time.
 */
export function assembliesEnabled(): boolean {
  const raw = import.meta.env?.VITE_ASSEMBLY_ENABLED;
  if (typeof raw !== 'string') {
    return false;
  }
  return raw.trim().toLowerCase() === 'true';
}

export const ASSEMBLY_FLAG_NAME = 'VITE_ASSEMBLY_ENABLED';
