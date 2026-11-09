/**
 * Phase 4.2 — built-in material library.
 *
 * The preset catalogue remains the editing API (`MaterialPanel` and the reducer
 * use it unchanged). This module adds the library layer on top of MaterialAsset
 * v1: catalog metadata (category, preview colour, detail source), deterministic
 * search/filtering and a frozen built-in registry.
 */
import {
  MATERIAL_ASSET_VERSION,
  PROCEDURAL_TEXTURE_MAP_ROLES,
  TEXTURE_ROLE_COLOR_SPACE,
  canonicalMaterialAsset,
  validateMaterialAsset,
  type MaterialAsset,
  type MaterialAssetErrorCode,
  type MaterialAssetMaps,
  type TextureAsset,
} from './asset';
import { MATERIAL_PRESETS, type MaterialPreset } from './presets';
import { PROCEDURAL_TEXTURE_KINDS, proceduralTextureId } from './textureSource';
import {
  DEFAULT_UV_TILE_CM,
  MATERIAL_CATEGORIES,
  MATERIAL_CATEGORY_LABELS,
  textureKindFor,
  type MaterialCategory,
} from './types';

/** Convert one existing preset into a MaterialAsset v1 without changing values. */
export function materialAssetFromPreset(preset: MaterialPreset): MaterialAsset {
  const maps: MaterialAssetMaps = {};
  const kind = textureKindFor(preset.type);
  if (kind !== 'none') {
    for (const role of PROCEDURAL_TEXTURE_MAP_ROLES) {
      maps[role] = {
        id: proceduralTextureId(kind, role),
        version: 1,
        role,
        colorSpace: TEXTURE_ROLE_COLOR_SPACE[role],
        wrap: 'repeat',
      };
    }
  }

  return {
    id: preset.id,
    version: MATERIAL_ASSET_VERSION,
    label: preset.name,
    type: preset.type,
    colorPolicy: preset.color === null ? 'object' : 'fixed',
    baseColor: preset.color,
    pbr: {
      metalness: preset.metalness,
      roughness: preset.roughness,
      opacity: preset.opacity,
      normalStrength: preset.normalStrength,
      textureScale: preset.textureScale,
      emissiveIntensity: 1,
      aoIntensity: 1,
    },
    maps,
    uv: { mode: 'physical-box', tileCm: preset.physicalTileCm ?? DEFAULT_UV_TILE_CM },
    license: { kind: 'built-in', source: '3D Studio AI procedural preset' },
  };
}

/** Recursively freeze catalog data, so a consumer cannot mutate the built-ins. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** Ids of every procedural map the generator can produce. */
const PROCEDURAL_TEXTURE_IDS: ReadonlySet<string> = new Set(
  PROCEDURAL_TEXTURE_KINDS.flatMap((kind) =>
    PROCEDURAL_TEXTURE_MAP_ROLES.map((role) => proceduralTextureId(kind, role)),
  ),
);

/**
 * Every built-in preset as a validated, frozen MaterialAsset, in catalogue
 * order. Validation runs once at module load: an invalid built-in is a
 * programmer error and must not silently enter the library.
 */
export const BUILT_IN_MATERIAL_ASSETS: readonly MaterialAsset[] = deepFreeze(
  MATERIAL_PRESETS.map((preset) => {
    const asset = materialAssetFromPreset(preset);
    const validated = validateMaterialAsset(asset, {
      knownTextureIds: PROCEDURAL_TEXTURE_IDS,
    });
    if (!validated.ok) {
      throw new Error(`Built-in material "${preset.id}" yaroqsiz: ${validated.message}`);
    }
    return validated.asset;
  }),
);

/**
 * Metadata for the procedural maps the built-ins reference. Procedural maps
 * have no encoded file, so MIME/hash are null and dimensions are resolved when
 * the map is generated (128 px preview, 512 px export).
 */
export const BUILT_IN_TEXTURE_ASSETS: readonly TextureAsset[] = PROCEDURAL_TEXTURE_KINDS.flatMap(
  (kind) =>
    PROCEDURAL_TEXTURE_MAP_ROLES.map((role) => ({
      id: proceduralTextureId(kind, role),
      version: 1,
      mimeType: null,
      width: 0,
      height: 0,
      byteSize: 0,
      contentHash: null,
      source: { kind: 'procedural' as const, generator: `procedural:${kind}` },
    })),
);

/** Public snapshot; registration uses the private set so external mutation is inert. */
export const BUILT_IN_TEXTURE_IDS: ReadonlySet<string> = new Set(PROCEDURAL_TEXTURE_IDS);

export const MATERIAL_ASSET_IDS: ReadonlySet<string> = new Set(
  BUILT_IN_MATERIAL_ASSETS.map((asset) => asset.id),
);

const ASSETS_BY_ID = new Map(BUILT_IN_MATERIAL_ASSETS.map((asset) => [asset.id, asset]));

/** How a built-in material produces surface detail. Never a bitmap claim. */
export type MaterialDetailSource = 'procedural' | 'none';

export interface MaterialCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly category: MaterialCategory;
  /** CSS-ready colour for the library swatch; the renderer still uses the asset. */
  readonly previewColor: string;
  readonly detail: MaterialDetailSource;
  readonly asset: MaterialAsset;
}

export interface MaterialCategorySummary {
  readonly id: MaterialCategory;
  readonly label: string;
  readonly count: number;
}

/**
 * Catalog entries in curated preset order. `detail` distinguishes the four
 * families with a procedural map from the scalar-only families, so the UI never
 * implies a bitmap texture exists.
 */
export const MATERIAL_CATALOG: readonly MaterialCatalogEntry[] = deepFreeze(
  MATERIAL_PRESETS.map((preset) => {
    const asset = ASSETS_BY_ID.get(preset.id);
    if (!asset) {
      throw new Error(`Material asset topilmadi: ${preset.id}`);
    }
    return {
      id: preset.id,
      label: preset.name,
      category: preset.category,
      previewColor: preset.color ?? '#b8bec6',
      detail: Object.keys(asset.maps).length > 0 ? 'procedural' : 'none',
      asset,
    } as MaterialCatalogEntry;
  }),
);

const CATALOG_BY_ID = new Map(MATERIAL_CATALOG.map((entry) => [entry.id, entry]));

/** All built-in entries, in deterministic catalogue order. */
export function listMaterialCatalog(): readonly MaterialCatalogEntry[] {
  return MATERIAL_CATALOG;
}

/** Category navigation data, in the canonical category order. */
export function listMaterialCategories(): readonly MaterialCategorySummary[] {
  return MATERIAL_CATEGORIES.map((category) => ({
    id: category,
    label: MATERIAL_CATEGORY_LABELS[category],
    count: MATERIAL_CATALOG.filter((entry) => entry.category === category).length,
  }));
}

/** One entry by stable id, or null when the id is not a built-in. */
export function getMaterialCatalogEntry(
  id: string | null | undefined,
): MaterialCatalogEntry | null {
  if (!id) {
    return null;
  }
  return CATALOG_BY_ID.get(id) ?? null;
}

/**
 * Search text is case-, accent- and apostrophe-insensitive, so "yogoch" finds
 * "Yog'och" and "xrom" finds "Metall (xrom)". Ids are included, which is what
 * makes the English family names (oak, walnut, chrome, velvet, ...) searchable.
 */
function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface MaterialCatalogFilter {
  category?: MaterialCategory;
  query?: string;
}

/**
 * Filter the catalogue deterministically. Results keep catalogue order, so the
 * same filter always renders the same grid.
 */
export function filterMaterialCatalog(
  filter: MaterialCatalogFilter = {},
): readonly MaterialCatalogEntry[] {
  const query = normalizeSearchText(filter.query ?? '');
  return MATERIAL_CATALOG.filter((entry) => {
    if (filter.category !== undefined && entry.category !== filter.category) {
      return false;
    }
    if (query === '') {
      return true;
    }
    const haystack = normalizeSearchText(
      `${entry.label} ${entry.id} ${MATERIAL_CATEGORY_LABELS[entry.category]}`,
    );
    return haystack.includes(query);
  });
}

/** Name/id search without a category constraint. */
export function searchMaterialCatalog(query: string): readonly MaterialCatalogEntry[] {
  return filterMaterialCatalog({ query });
}

/** Deterministic id resolution with the same fallback rule as presets. */
export function getMaterialAsset(id: string | null | undefined): MaterialAsset {
  if (id && ASSETS_BY_ID.has(id)) {
    return ASSETS_BY_ID.get(id) as MaterialAsset;
  }
  return ASSETS_BY_ID.get('default') as MaterialAsset;
}

/** Throwing variant for callers that cannot continue with a fallback. */
export function requireMaterialAsset(id: string): MaterialAsset {
  const asset = ASSETS_BY_ID.get(id);
  if (!asset) {
    throw new Error(`Material asset topilmadi: ${id}`);
  }
  return asset;
}

export type MaterialAssetRegistrationResult =
  | { ok: true; assets: MaterialAsset[]; warnings: string[] }
  | {
      ok: false;
      code: 'duplicate_id' | MaterialAssetErrorCode;
      message: string;
      id?: string;
    };

/**
 * Add assets to a collection with registry-grade checks: each addition is
 * validated, and an id that already exists is rejected instead of silently
 * replacing the earlier material.
 */
export function registerMaterialAssets(
  base: readonly MaterialAsset[],
  additions: readonly unknown[],
  options: { knownTextureIds?: ReadonlySet<string> } = {},
): MaterialAssetRegistrationResult {
  const knownTextureIds = options.knownTextureIds ?? PROCEDURAL_TEXTURE_IDS;
  const assets = [...base];
  const seen = new Set(assets.map((asset) => asset.id));
  const warnings: string[] = [];

  for (const raw of additions) {
    const validated = validateMaterialAsset(raw, { knownTextureIds });
    if (!validated.ok) {
      return { ok: false, code: validated.code, message: validated.message };
    }
    if (seen.has(validated.asset.id)) {
      return {
        ok: false,
        code: 'duplicate_id',
        id: validated.asset.id,
        message: `Material asset id takrorlanadi: ${validated.asset.id}`,
      };
    }
    seen.add(validated.asset.id);
    assets.push(validated.asset);
    warnings.push(...validated.warnings);
  }

  return { ok: true, assets, warnings };
}

/** Codepoint comparison, so the document does not depend on the host locale. */
function compareAssetIds(a: MaterialAsset, b: MaterialAsset): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** Deterministic document for a whole collection, sorted by id. */
export function serializeMaterialAssetLibrary(assets: readonly MaterialAsset[]): string {
  return JSON.stringify([...assets].sort(compareAssetIds).map(canonicalMaterialAsset));
}
