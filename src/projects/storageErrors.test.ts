import { describe, expect, it } from 'vitest';
import { isStorageQuotaError } from './storageErrors';

describe('isStorageQuotaError', () => {
  it('recognizes the Chrome/Safari quota exception', () => {
    expect(isStorageQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
  });

  it('recognizes the Firefox name and the legacy numeric code', () => {
    expect(isStorageQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isStorageQuotaError({ code: 22 })).toBe(true);
  });

  it('does not misreport unrelated failures', () => {
    expect(isStorageQuotaError(new Error('blocked by policy'))).toBe(false);
    expect(isStorageQuotaError({ name: 'SecurityError', code: 18 })).toBe(false);
    expect(isStorageQuotaError(null)).toBe(false);
    expect(isStorageQuotaError('QuotaExceededError')).toBe(false);
  });
});
