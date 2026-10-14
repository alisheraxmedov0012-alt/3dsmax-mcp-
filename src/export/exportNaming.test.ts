import { describe, expect, it } from 'vitest';
import { MAX_NAME_LENGTH, buildExportFilename, slugifyName } from './exportNaming';

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
