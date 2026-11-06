import { describe, expect, it } from 'vitest';
import { parseMtlDocument } from './mtl';
import { ImportError } from './importErrors';
import { MAX_MTL_MATERIALS } from './importLimits';
import { chairMtl } from './__fixtures__/textFixtures';

function codeOf(text: string): string {
  try {
    parseMtlDocument(text, 'test.mtl');
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError);
    return (error as ImportError).code;
  }
  throw new Error('expected the MTL to be rejected');
}

describe('parseMtlDocument — conversion', () => {
  it('maps the documented MTL properties', () => {
    const { materials } = parseMtlDocument(chairMtl(), 'chair.mtl');
    const wood = materials.get('Wood');
    expect(wood).toBeTruthy();
    expect(wood?.baseColor).toEqual([0.8, 0.4, 0.2]);
    expect(wood?.opacity).toBeCloseTo(0.9, 3);
    expect(wood?.roughness).toBeCloseTo(1 - Math.sqrt(0.2), 3);
    expect(wood?.metalness).toBe(0);
    expect(wood?.baseColorMap).toBe('wood.png');
    expect(wood?.normalMap).toBeNull();

    const metal = materials.get('Metal');
    expect(metal?.metalness).toBeCloseTo(1, 3);
  });

  it('inverts Tr into opacity when d is absent', () => {
    const { materials } = parseMtlDocument(['newmtl Glass', 'Kd 0.5 0.5 0.5', 'Tr 0.25'].join('\n'));
    expect(materials.get('Glass')?.opacity).toBeCloseTo(0.75, 3);
  });

  it('prefers d over Tr when both are present', () => {
    const { materials } = parseMtlDocument(
      ['newmtl Mixed', 'Kd 0.5 0.5 0.5', 'd 0.4', 'Tr 0.9'].join('\n'),
    );
    expect(materials.get('Mixed')?.opacity).toBeCloseTo(0.4, 3);
  });

  it('falls back to a neutral colour when Kd is missing', () => {
    const { materials } = parseMtlDocument('newmtl Plain\nNs 100\n');
    expect(materials.get('Plain')?.baseColor).toEqual([0.8, 0.8, 0.8]);
  });

  it('clamps out-of-range channels instead of propagating them', () => {
    const { materials } = parseMtlDocument('newmtl Weird\nKd 4 -2 0.5\n');
    expect(materials.get('Weird')?.baseColor).toEqual([1, 0, 0.5]);
  });

  it('strips map options before the file name', () => {
    const { materials } = parseMtlDocument(
      ['newmtl Bumpy', 'Kd 1 1 1', 'map_Bump -bm 1 -s 2 2 2 bump.png'].join('\n'),
    );
    expect(materials.get('Bumpy')?.normalMap).toBe('bump.png');
  });

  it('reads a bump alias as the normal map', () => {
    const { materials } = parseMtlDocument('newmtl B\nKd 1 1 1\nbump height.png\n');
    expect(materials.get('B')?.normalMap).toBe('height.png');
  });
});

describe('parseMtlDocument — rejection', () => {
  it('rejects more materials than allowed', () => {
    const lines: string[] = [];
    for (let index = 0; index <= MAX_MTL_MATERIALS; index += 1) {
      lines.push(`newmtl m${index}`);
      lines.push('Kd 1 1 1');
    }
    expect(codeOf(lines.join('\n'))).toBe('too_complex');
  });

  it('rejects an over-long line before tokenising it', () => {
    expect(codeOf(`newmtl A\nKd ${'1 '.repeat(4000)}\n`)).toBe('too_complex');
  });

  it('rejects a material name longer than the limit', () => {
    expect(codeOf(`newmtl ${'a'.repeat(300)}\nKd 1 1 1\n`)).toBe('malformed');
  });

  it('never follows a texture path outside the selection', () => {
    const { materials, warnings } = parseMtlDocument(
      ['newmtl Esc', 'Kd 1 1 1', 'map_Kd ../../secret.png'].join('\n'),
    );
    // The reference is dropped and reported; the material itself is still usable.
    expect(materials.get('Esc')?.baseColorMap).toBeNull();
    expect(warnings.join(' ')).toContain('qabul qilinmadi');
  });

  it('drops an absolute Windows texture path with a warning', () => {
    const { materials, warnings } = parseMtlDocument(
      ['newmtl Win', 'Kd 1 1 1', 'map_Kd C:\\textures\\wood.png'].join('\n'),
    );
    expect(materials.get('Win')?.baseColorMap).toBeNull();
    expect(warnings.length).toBe(1);
  });
});
