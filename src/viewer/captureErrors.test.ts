import { describe, expect, it } from 'vitest';
import { CaptureError, describeCaptureError } from './captureErrors';

describe('describeCaptureError', () => {
  it('explains context loss with a recovery step', () => {
    const message = describeCaptureError(new CaptureError('context-lost', 'lost'));
    expect(message).toMatch(/WebGL konteksti yo'qoldi/);
    expect(message).toMatch(/takrorlang/);
  });

  it('distinguishes a concurrent export', () => {
    expect(describeCaptureError(new CaptureError('busy', 'busy'))).toMatch(
      /Boshqa eksport davom etmoqda/,
    );
  });

  it('distinguishes an empty buffer from a readback failure', () => {
    expect(describeCaptureError(new CaptureError('empty-buffer', 'empty'))).toMatch(/bo'sh/);
    expect(describeCaptureError(new CaptureError('readback-failed', 'read'))).toMatch(
      /o'qib bo'lmadi/,
    );
  });

  it('distinguishes an encode failure', () => {
    expect(describeCaptureError(new CaptureError('encode-failed', 'encode'))).toMatch(
      /PNG faylini yaratib bo'lmadi/,
    );
  });

  it('passes the transparent-capability reason through', () => {
    const message = describeCaptureError(
      new CaptureError('transparent-unsupported', 'Alpha ishonchsiz.'),
    );
    expect(message).toBe('Alpha ishonchsiz.');
  });

  it('prefers the explicit message of an unknown error', () => {
    expect(describeCaptureError(new Error('Capture 5000x1080 juda katta'))).toBe(
      'Eksport amalga oshmadi: Capture 5000x1080 juda katta',
    );
  });

  it('has a generic fallback for non-Error values', () => {
    expect(describeCaptureError('boom')).toMatch(/Eksport amalga oshmadi/);
  });
});
