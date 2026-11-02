import { describe, expect, it } from 'vitest';
import { EMPTY_PRINTER_PROFILE, resolvePrinterProfile } from './printerProfile';

describe('printer profile validation', () => {
  it('assumes no limits when nothing is configured', () => {
    const { profile, errors } = resolvePrinterProfile();
    expect(errors).toEqual([]);
    expect(profile).toEqual(EMPTY_PRINTER_PROFILE);
    expect(profile.buildVolumeMm).toBeNull();
    expect(profile.minWallThicknessMm).toBeNull();
  });

  it('accepts a complete, positive build volume', () => {
    const { profile, errors } = resolvePrinterProfile({
      buildVolumeXmm: 220,
      buildVolumeYmm: 220,
      buildVolumeZmm: 250,
      minWallThicknessMm: 0.8,
      minFeatureSizeMm: 0.4,
    });
    expect(errors).toEqual([]);
    expect(profile.buildVolumeMm).toEqual({ x: 220, y: 220, z: 250 });
    expect(profile.minWallThicknessMm).toBe(0.8);
    expect(profile.minFeatureSizeMm).toBe(0.4);
  });

  it('rejects a partially entered build volume instead of completing it', () => {
    const { profile, errors } = resolvePrinterProfile({
      buildVolumeXmm: 220,
      buildVolumeYmm: 220,
    });
    expect(profile.buildVolumeMm).toBeNull();
    expect(errors.join(' ')).toMatch(/to'liq kiritilishi/);
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('rejects a %s axis', (_label, value) => {
    const { profile, errors } = resolvePrinterProfile({
      buildVolumeXmm: value,
      buildVolumeYmm: 100,
      buildVolumeZmm: 100,
    });
    expect(profile.buildVolumeMm).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a build volume beyond the sanity bound', () => {
    const { profile, errors } = resolvePrinterProfile({
      buildVolumeXmm: 50000,
      buildVolumeYmm: 100,
      buildVolumeZmm: 100,
    });
    expect(profile.buildVolumeMm).toBeNull();
    expect(errors.join(' ')).toMatch(/oshmasligi/);
  });

  it('rejects a non-positive minimum wall', () => {
    const { profile, errors } = resolvePrinterProfile({ minWallThicknessMm: 0 });
    expect(profile.minWallThicknessMm).toBeNull();
    expect(errors.join(' ')).toMatch(/Minimal devor/);
  });

  it('uses the supplied name, or a neutral fallback', () => {
    expect(resolvePrinterProfile({ name: '  Ender  ' }).profile.name).toBe('Ender');
    expect(resolvePrinterProfile({ name: '   ', minWallThicknessMm: 1 }).profile.name).toBe(
      'Foydalanuvchi profili',
    );
    expect(resolvePrinterProfile({ name: '   ' }).profile.name).toBe('Sozlanmagan');
  });
});
