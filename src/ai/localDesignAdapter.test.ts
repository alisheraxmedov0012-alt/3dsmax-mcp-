/**
 * A3 — the offline analyzer must understand every type the geometry layer can
 * build, and must still refuse what it cannot. These tests pin both halves.
 */
import { describe, expect, it } from 'vitest';
import { FURNITURE_TYPES } from '../geometry/furniture/types';
import { validateFurnitureParams } from '../geometry/furniture/params';
import {
  LOCAL_DESIGN_ADAPTER_ID,
  detectFurnitureType,
  detectMaterialKind,
  localDesignAdapter,
  parseDesignPrompt,
} from './localDesignAdapter';
import { AiAdapterError } from './types';

describe('detectFurnitureType', () => {
  it.each([
    ['stol', 'table'],
    ['stul', 'chair'],
    ['kreslo', 'armchair'],
    ['divan', 'sofa'],
    ['krovat', 'bed'],
    ['shkaf', 'wardrobe'],
    ['javon', 'shelf'],
    ['tumba', 'dresser'],
    ['стол', 'table'],
    ['wardrobe', 'wardrobe'],
  ] as const)('recognises %s as %s', (text, type) => {
    expect(detectFurnitureType(text).type).toBe(type);
  });

  it('accepts Uzbek case suffixes and English plurals', () => {
    expect(detectFurnitureType('shkaflar uchun').type).toBe('wardrobe');
    expect(detectFurnitureType('divanning o‘lchami').type).toBe('sofa');
    expect(detectFurnitureType('two chairs').type).toBe('chair');
  });

  it('picks the first type named and reports the rest as ignored', () => {
    const match = detectFurnitureType('stol va stul kerak');
    expect(match.type).toBe('table');
    expect(match.ignored.map((entry) => entry.type)).toEqual(['chair']);
  });

  it('returns null when no type is named', () => {
    expect(detectFurnitureType('180x60x75 sm').type).toBeNull();
  });
});

describe('detectMaterialKind', () => {
  it.each([
    ["yog'och stol", 'wood'],
    ['metall karkas', 'metal'],
    ['mato qoplama', 'fabric'],
    ['charm divan', 'leather'],
    ['shisha stol', 'glass'],
    ['plastik stul', 'plastic'],
  ] as const)('reads %s as %s', (text, kind) => {
    expect(detectMaterialKind(text)).toBe(kind);
  });

  it('returns null when no material is named', () => {
    expect(detectMaterialKind('180x60x75 sm stol')).toBeNull();
  });
});

describe('parseDesignPrompt — all buildable types', () => {
  it.each(FURNITURE_TYPES)('builds a valid %s from its own defaults', (type) => {
    const parsed = parseDesignPrompt(type);
    expect(parsed.furniture).toBe(type);
    expect(validateFurnitureParams(type, parsed.params)).not.toBeNull();
  });

  it('reads the wardrobe example from the panel hint', () => {
    const parsed = parseDesignPrompt('3 eshikli shkaf, 200 sm baland');
    expect(parsed.furniture).toBe('wardrobe');
    expect(parsed.params.heightCm).toBe(200);
    // Width/depth come from the wardrobe defaults, not from a table.
    expect(parsed.params.widthCm).toBe(180);
    expect(parsed.params.depthCm).toBe(60);
    expect(parsed.params.doorCount).toBe(3);
  });

  it('reads a dimension triple as width x depth x height', () => {
    const parsed = parseDesignPrompt('180x60x75 sm stol');
    expect(parsed.params.widthCm).toBe(180);
    expect(parsed.params.depthCm).toBe(60);
    expect(parsed.params.heightCm).toBe(75);
    expect(parsed.confidence).toBe('high');
  });

  it('maps a bed length onto the Z extent, the same axis the builder uses', () => {
    const parsed = parseDesignPrompt('krovat 160 sm keng, 200 sm uzunlik, 40 sm baland');
    expect(parsed.furniture).toBe('bed');
    expect(parsed.params.widthCm).toBe(160);
    expect(parsed.params.depthCm).toBe(200);
    expect(parsed.params.heightCm).toBe(40);
    expect(parsed.notes.join(' ')).toMatch(/uzunligi chuqurlik/i);
  });

  it('reads counted details for the type that has them', () => {
    expect(parseDesignPrompt('4 tortmali tumba').params.drawerCount).toBe(4);
    expect(parseDesignPrompt('5 javonli javon').params.shelfCount).toBe(5);
    expect(parseDesignPrompt('3 eshikli shkaf').params.doorCount).toBe(3);
  });

  it('resolves the material category and colour', () => {
    const parsed = parseDesignPrompt("qizil yog'och stol");
    expect(parsed.materialKind).toBe('wood');
    expect(parsed.params.color).toBe('#c0392b');
  });

  it('clamps an out-of-range dimension and says so', () => {
    const parsed = parseDesignPrompt('500x60x75 sm stol');
    expect(parsed.params.widthCm).toBe(240);
    expect(parsed.warnings.join(' ')).toMatch(/oralig/);
  });

  it('defaults to a table with an explicit warning when no type is named', () => {
    const parsed = parseDesignPrompt('180x60x75 sm, yog‘och rangli');
    expect(parsed.furniture).toBe('table');
    expect(parsed.warnings.join(' ')).toMatch(/Tur aniqlanmadi/);
  });

  it('refuses a room word instead of substituting a table', () => {
    expect(() => parseDesignPrompt('oshxona uchun mebel')).toThrow(AiAdapterError);
    expect(() => parseDesignPrompt('office desk')).toThrow(/qo'llab-quvvatlanmaydi/);
  });
});

describe('localDesignAdapter', () => {
  it('exposes an id and text-only capability', () => {
    expect(localDesignAdapter.id).toBe(LOCAL_DESIGN_ADAPTER_ID);
    expect(localDesignAdapter.capabilities).toEqual({ text: true, image: false });
  });

  it('generates a wardrobe proposal end to end', async () => {
    const proposal = await localDesignAdapter.generate({ text: '3 eshikli shkaf, 200 sm baland' });
    expect(proposal.furniture).toBe('wardrobe');
    expect(proposal.adapterId).toBe(LOCAL_DESIGN_ADAPTER_ID);
    expect(proposal.params.heightCm).toBe(200);
    expect(proposal.notes.length).toBeGreaterThan(0);
  });

  it('rejects an image request, which no local analyzer reads', async () => {
    await expect(
      localDesignAdapter.generate({ text: 'stol', imageFileName: 'photo.png' }),
    ).rejects.toBeInstanceOf(AiAdapterError);
  });

  it('rejects empty text', async () => {
    await expect(localDesignAdapter.generate({ text: '   ' })).rejects.toThrow(/Matn bo'sh/);
  });
});
