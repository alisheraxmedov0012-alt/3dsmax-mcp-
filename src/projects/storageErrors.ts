/**
 * Recognize the Web Storage quota failure that browsers raise when
 * `localStorage.setItem` cannot grow any further.
 *
 * The name differs between engines (Chrome/Safari `QuotaExceededError`,
 * Firefox `NS_ERROR_DOM_QUOTA_REACHED`) and some WebViews only expose the
 * legacy numeric code, so all three are checked. The caller can then tell the
 * reader to free space instead of showing a generic save failure.
 */
export function isStorageQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { name?: unknown; code?: unknown };
  return (
    candidate.name === 'QuotaExceededError' ||
    candidate.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    candidate.code === 22
  );
}
