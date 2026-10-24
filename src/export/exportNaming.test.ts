import { describe, expect, it } from 'vitest';
import { MAX_NAME_LENGTH, buildExportFilename, nameDigest, slugifyName } from './exportNaming';

describe('slugifyName', () => {
  it('lowercases and dash-separates', () => {
    expect(slugifyName('Yotoqxona Shkafi')).toBe('yotoqxona-shkafi');
    expect(slugifyName("Yog'och stol 1")).toBe('yog-och-stol-1');
  });

  it('strips trailing/leading separators and collapses runs', () => {
    expect(slugifyName('  --Hello__World--  ')).toBe('hello-world');
  });

  it('falls back when nothing usable remains', () => {
    expect(slugifyName('***')).toBe('model');
    expect(slugifyName('ЖЖЖ')).toBe('model');
  });

  it('caps the length', () => {
    expect(slugifyName('a'.repeat(200)).length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
  });
});

describe('buildExportFilename', () => {
  it('includes the furniture type when known', () => {
    expect(
      buildExportFilename(
        { name: 'Yotoqxona', furnitureType: 'wardrobe', units: 'cm' },
        'glb',
      ),
    ).toBe('yotoqxona-wardrobe.glb');
  });

  it('omits the type when it is unknown or identical to the name', () => {
    expect(buildExportFilename({ name: 'Sahna', furnitureType: null, units: 'cm' }, 'json')).toBe(
      'sahna.json',
    );
    expect(
      buildExportFilename({ name: 'Sofa', furnitureType: 'sofa', units: 'cm' }, 'stl'),
    ).toBe('sofa.stl');
  });

  it('falls back to model when the name is empty', () => {
    expect(buildExportFilename({ name: '', furnitureType: null, units: 'cm' }, 'obj')).toBe(
      'model.obj',
    );
  });
});

describe('nameDigest', () => {
  it('is stable for the same input', () => {
    expect(nameDigest('Stol loyihasi')).toBe(nameDigest('Stol loyihasi'));
    expect(nameDigest('Ошхона шкаф')).toBe(nameDigest('Ошхона шкаф'));
  });

  it('keeps a fixed value for a known input', () => {
    // Golden values: if the algorithm or its byte encoding changes, filenames
    // already handed to users would silently change too. Update only on purpose.
    expect(nameDigest('Stol loyihasi')).toBe('29e23ec7396c');
    expect(nameDigest('Ошхона шкаф')).toBe('f6adcda56745');
  });

  it('emits 12 lowercase hex characters', () => {
    for (const value of ['', 'a', 'Ошхона шкаф', 'Kitchen Table', 'a'.repeat(500)]) {
      expect(nameDigest(value)).toMatch(/^[0-9a-f]{12}$/);
    }
  });

  it('differs whenever the name differs', () => {
    const names = [
      'Stol',
      'stol',
      'STOL',
      'Stol ',
      ' Stol',
      'Stol-',
      'Ошхона шкаф',
      'Кухня',
      'Шкаф 2026',
      'Ошхона шкаф 2026',
      'Kitchen Table',
      'Kitchen-Table',
      '',
      '   ',
      '!!!',
    ];
    const digests = names.map(nameDigest);
    expect(new Set(digests).size).toBe(names.length);
  });

  it('normalises Unicode so equivalent spellings agree', () => {
    // "Ü" as one code point vs "U" + combining diaeresis: same visible name.
    expect(nameDigest('\u00dcrgentsh')).toBe(nameDigest('U\u0308rgentsh'));
  });
});
