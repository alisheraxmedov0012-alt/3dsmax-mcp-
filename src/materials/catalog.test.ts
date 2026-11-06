import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_TEXTURE_IDS,
  MATERIAL_ASSET_IDS,
  MATERIAL_CATALOG,
  filterMaterialCatalog,
  getMaterialCatalogEntry,
  listMaterialCatalog,
  listMaterialCategories,
  searchMaterialCatalog,
} from './library';
import { MATERIAL_PRESETS } from './presets';
import { MATERIAL_ASSET_VERSION, serializeMaterialAsset, validateMaterialAsset } from './asset';
import {
  MATERIAL_CATEGORIES,
  MATERIAL_CATEGORY_LABELS,
  MATERIAL_TYPES,
  type MaterialCategory,
  type MaterialType,
} from './types';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { parseSceneJson, serializeSceneToJson } from '../export/sceneJson';

const TYPE_CATEGORY: Record<MaterialType, MaterialCategory> = {
  painted: 'painted',
  wood: 'wood',
  metal: 'metal',
  fabric: 'fabric',
  leather: 'leather',
  glass: 'glass',
  plastic: 'plastic',
};

const ORIGINAL_PRESETS = [
  'default',
  'wood-oak',
  'metal-steel',
  'fabric-linen',
  'leather-brown',
  'glass-clear',
  'plastic-white',
  'painted-red',
] as const;

const ORIGINAL_VALUES: Record<
  (typeof ORIGINAL_PRESETS)[number],
  {
    type: MaterialType;
    color: string | null;
    metalness: number;
    roughness: number;
    opacity: number;
    textureScale: number;
    normalStrength: number;
  }
> = {
  default: {
    type: 'painted',
    color: null,
    metalness: 0.05,
    roughness: 0.6,
    opacity: 1,
    textureScale: 1,
    normalStrength: 0,
  },
  'wood-oak': {
    type: 'wood',
    color: '#a9744f',
    metalness: 0,
    roughness: 0.65,
    opacity: 1,
    textureScale: 1,
    normalStrength: 0.3,
  },
  'metal-steel': {
    type: 'metal',
    color: '#c9ced3',
    metalness: 0.95,
    roughness: 0.3,
    opacity: 1,
    textureScale: 1,
    normalStrength: 0.05,
  },
  'fabric-linen': {
    type: 'fabric',
    color: '#7d8b99',
    metalness: 0,
    roughness: 0.9,
    opacity: 1,
    textureScale: 2,
    normalStrength: 0.6,
  },
  'leather-brown': {
    type: 'leather',
    color: '#5b3a29',
    metalness: 0,
    roughness: 0.55,
    opacity: 1,
    textureScale: 1.5,
    normalStrength: 0.5,
  },
  'glass-clear': {
    type: 'glass',
    color: '#bfe3ea',
    metalness: 0,
    roughness: 0.05,
    opacity: 0.3,
    textureScale: 1,
    normalStrength: 0,
  },
  'plastic-white': {
    type: 'plastic',
    color: '#dcdcdc',
    metalness: 0,
    roughness: 0.4,
    opacity: 1,
    textureScale: 1,
    normalStrength: 0.05,
  },
  'painted-red': {
    type: 'painted',
    color: '#c0392b',
    metalness: 0.05,
    roughness: 0.5,
    opacity: 1,
    textureScale: 1,
    normalStrength: 0.05,
  },
};

function ids(entries: readonly { id: string }[]): string[] {
  return entries.map((entry) => entry.id);
}

describe('built-in material catalog', () => {
  it('contains at least 24 distinct materials', () => {
    expect(MATERIAL_CATALOG.length).toBeGreaterThanOrEqual(24);
    expect(new Set(ids(MATERIAL_CATALOG)).size).toBe(MATERIAL_CATALOG.length);
  });

  it('keeps every catalogue id aligned with the preset registry', () => {
    expect(ids(MATERIAL_CATALOG)).toEqual(MATERIAL_PRESETS.map((preset) => preset.id));
    for (const entry of MATERIAL_CATALOG) {
      expect(MATERIAL_ASSET_IDS.has(entry.id)).toBe(true);
    }
  });

  it('represents every category with the target families', () => {
    const counts = new Map(listMaterialCategories().map((item) => [item.id, item.count]));
    for (const category of MATERIAL_CATEGORIES) {
      expect(counts.get(category)).toBeGreaterThan(0);
    }
    expect(counts.get('wood')).toBeGreaterThanOrEqual(5);
    expect(counts.get('metal')).toBeGreaterThanOrEqual(4);
    expect(counts.get('fabric')).toBeGreaterThanOrEqual(4);
    expect(counts.get('leather')).toBeGreaterThanOrEqual(3);
    expect(counts.get('glass')).toBeGreaterThanOrEqual(3);
    expect(counts.get('plastic')).toBeGreaterThanOrEqual(3);
  });

  it('assigns the category that matches the material type', () => {
    for (const entry of MATERIAL_CATALOG) {
      expect(entry.category).toBe(TYPE_CATEGORY[entry.asset.type]);
      expect(MATERIAL_CATEGORY_LABELS[entry.category]).toBeTruthy();
    }
  });

  it('holds a valid MaterialAsset v1 for every entry', () => {
    for (const entry of MATERIAL_CATALOG) {
      const result = validateMaterialAsset(entry.asset, { knownTextureIds: BUILT_IN_TEXTURE_IDS });
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) continue;
      expect(result.warnings).toEqual([]);
      expect(entry.asset.version).toBe(MATERIAL_ASSET_VERSION);
      expect(JSON.parse(serializeMaterialAsset(entry.asset))).toEqual(entry.asset);
    }
  });

  it('does not claim a bitmap map for scalar-only materials', () => {
    for (const entry of MATERIAL_CATALOG) {
      const mapIds = Object.values(entry.asset.maps).map((ref) => ref.id);
      if (entry.detail === 'none') {
        expect(mapIds).toEqual([]);
      } else {
        expect(entry.detail).toBe('procedural');
        expect(mapIds.length).toBeGreaterThan(0);
        for (const id of mapIds) {
          expect(id.startsWith('procedural:')).toBe(true);
        }
      }
    }
  });

  it('uses a valid preview colour for every entry', () => {
    for (const entry of MATERIAL_CATALOG) {
      expect(entry.previewColor).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('keeps the original eight preset ids and values byte-for-byte', () => {
    const byId = new Map(MATERIAL_CATALOG.map((entry) => [entry.id, entry]));
    for (const id of ORIGINAL_PRESETS) {
      const entry = byId.get(id);
      const expected = ORIGINAL_VALUES[id];
      expect(entry).toBeDefined();
      if (!entry) continue;
      expect(entry.asset.version).toBe(MATERIAL_ASSET_VERSION);
      expect(entry.asset.type).toBe(expected.type);
      expect(entry.asset.baseColor).toBe(expected.color);
      expect(entry.asset.colorPolicy).toBe(expected.color === null ? 'object' : 'fixed');
      expect(entry.asset.pbr.metalness).toBe(expected.metalness);
      expect(entry.asset.pbr.roughness).toBe(expected.roughness);
      expect(entry.asset.pbr.opacity).toBe(expected.opacity);
      expect(entry.asset.pbr.textureScale).toBe(expected.textureScale);
      expect(entry.asset.pbr.normalStrength).toBe(expected.normalStrength);
    }
  });

  it('does not contain two materials that differ only by name', () => {
    const signatures = new Set(
      MATERIAL_CATALOG.map((entry) =>
        JSON.stringify([
          entry.asset.type,
          entry.asset.baseColor,
          entry.asset.pbr.metalness,
          entry.asset.pbr.roughness,
          entry.asset.pbr.opacity,
          entry.asset.pbr.textureScale,
          entry.asset.pbr.normalStrength,
        ]),
      ),
    );
    expect(signatures.size).toBe(MATERIAL_CATALOG.length);
  });

  it('is deeply frozen so the built-in registry cannot drift at runtime', () => {
    expect(Object.isFrozen(MATERIAL_CATALOG)).toBe(true);
    const entry = MATERIAL_CATALOG[0];
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.asset)).toBe(true);
    expect(Object.isFrozen(entry.asset.pbr)).toBe(true);
    expect(Object.isFrozen(entry.asset.maps)).toBe(true);
    expect(Reflect.set(entry, 'label', 'mutated')).toBe(false);
    expect(Reflect.set(entry.asset.pbr, 'roughness', 0)).toBe(false);
    expect(entry.label).not.toBe('mutated');
  });
});

describe('category listing', () => {
  it('lists categories in the canonical order with accurate counts', () => {
    const categories = listMaterialCategories();
    expect(categories.map((item) => item.id)).toEqual([...MATERIAL_CATEGORIES]);
    expect(categories.reduce((sum, item) => sum + item.count, 0)).toBe(MATERIAL_CATALOG.length);
    for (const item of categories) {
      expect(item.label).toBe(MATERIAL_CATEGORY_LABELS[item.id]);
      expect(item.count).toBe(
        MATERIAL_CATALOG.filter((entry) => entry.category === item.id).length,
      );
    }
  });
});

describe('search and filtering', () => {
  it('returns every material for an empty query in catalogue order', () => {
    expect(ids(filterMaterialCatalog())).toEqual(ids(MATERIAL_CATALOG));
    expect(ids(filterMaterialCatalog({ query: '   ' }))).toEqual(ids(MATERIAL_CATALOG));
  });

  it('filters by category without changing catalogue order', () => {
    const wood = filterMaterialCatalog({ category: 'wood' });
    expect(wood.length).toBeGreaterThanOrEqual(5);
    expect(wood.every((entry) => entry.category === 'wood')).toBe(true);
    expect(ids(wood)).toEqual(
      ids(MATERIAL_CATALOG).filter((id) => wood.some((entry) => entry.id === id)),
    );
  });

  it('searches by display label case-insensitively', () => {
    expect(ids(searchMaterialCatalog('XROM'))).toEqual(['metal-chrome']);
    expect(ids(searchMaterialCatalog('zamsh'))).toEqual(['leather-suede']);
    expect(ids(searchMaterialCatalog('baxmal'))).toEqual(['fabric-velvet']);
  });

  it('ignores apostrophes, so natural Uzbek spelling works', () => {
    const expected = ids(filterMaterialCatalog({ category: 'wood' }));
    expect(ids(searchMaterialCatalog('yogoch'))).toEqual(expected);
    expect(ids(searchMaterialCatalog("yog'och"))).toEqual(expected);
  });

  it('searches the stable id, which exposes the English family names', () => {
    // The premium product preset shares the oak family keyword.
    expect(ids(searchMaterialCatalog('oak'))).toEqual([
      'wood-oak',
      'wood-oak-premium',
    ]);
    expect(ids(searchMaterialCatalog('walnut'))).toEqual(['wood-walnut']);
    expect(ids(searchMaterialCatalog('velvet'))).toEqual(['fabric-velvet']);
    expect(ids(searchMaterialCatalog('suede'))).toEqual(['leather-suede']);
    expect(ids(searchMaterialCatalog('chrome'))).toEqual(['metal-chrome']);
  });

  it('combines a category with a query', () => {
    expect(ids(filterMaterialCatalog({ category: 'glass', query: 'frost' }))).toEqual([
      'glass-frosted',
    ]);
    expect(filterMaterialCatalog({ category: 'wood', query: 'chrome' })).toEqual([]);
  });

  it('returns no results for an unknown term', () => {
    expect(searchMaterialCatalog('carbon-fibre')).toEqual([]);
  });

  it('is deterministic across repeated calls', () => {
    const first = ids(filterMaterialCatalog({ query: 'yogoch' }));
    const second = ids(filterMaterialCatalog({ query: 'yogoch' }));
    expect(second).toEqual(first);
    expect(ids(listMaterialCatalog())).toEqual(ids(MATERIAL_CATALOG));
  });
});

describe('catalog lookup', () => {
  it('resolves a known entry and rejects unknown ids', () => {
    expect(getMaterialCatalogEntry('metal-brass')?.label).toBe('Metall (jez)');
    expect(getMaterialCatalogEntry('nope')).toBeNull();
    expect(getMaterialCatalogEntry(null)).toBeNull();
    expect(getMaterialCatalogEntry(undefined)).toBeNull();
  });

  it('covers every material type', () => {
    const types = new Set(MATERIAL_CATALOG.map((entry) => entry.asset.type));
    for (const type of MATERIAL_TYPES) {
      expect(types.has(type)).toBe(true);
    }
  });
});

describe('scene compatibility', () => {
  it('keeps schema v3 and round-trips a newly added preset id', () => {
    expect(SCENE_SCHEMA_VERSION).toBe(3);

    const object = createFurnitureSceneObject('table', 'obj-1', {
      material: { metalness: 0, roughness: 0.45, materialId: 'wood-mahogany' },
    });
    const scene = {
      schemaVersion: SCENE_SCHEMA_VERSION,
      room: { ...ROOM_DEFAULTS },
      objects: [object],
      settings: createDefaultSettings(),
    };

    const parsed = parseSceneJson(
      serializeSceneToJson(scene, { name: 'catalog', furnitureType: 'table', units: 'cm' }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.scene.schemaVersion).toBe(3);
    expect(parsed.scene.objects[0].material.materialId).toBe('wood-mahogany');
    expect(parsed.scene.objects[0].material.roughness).toBeCloseTo(0.45, 5);
  });
});
