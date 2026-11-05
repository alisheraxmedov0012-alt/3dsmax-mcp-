/**
 * Phase 4.1 — versioned, serializable PBR material assets.
 *
 * A `MaterialAsset` describes a material completely enough to rebuild it later:
 * PBR channels, texture references, UV policy and license provenance. It is
 * pure data: no Three.js, DOM, canvas or binary image ever enters this module,
 * so an asset can be validated, hashed and stored in JSON as-is.
 *
 * Runtime objects (textures, `MeshStandardMaterial`) are produced by
 * `buildMaterial.ts` from an asset; this module only decides what is *valid*.
 */
import {
  DEFAULT_PBR_MATERIAL,
  DEFAULT_UV_TILE_CM,
  MATERIAL_TYPES,
  PBR_LIMITS,
  type MaterialType,
  type NumericRange,
} from './types';

/** Schema version of the serialized material asset. */
export const MATERIAL_ASSET_VERSION = 1;

/** Hard cap for one serialized asset, before `JSON.parse` is attempted. */
export const MAX_MATERIAL_ASSET_BYTES = 256 * 1024;

/** Ids are used as stable references, so they stay ASCII and URL-safe. */
export const MATERIAL_ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/;

export const MATERIAL_ASSET_LABEL_MAX_LENGTH = 80;

export const MATERIAL_COLOR_POLICIES = ['object', 'fixed'] as const;
export type MaterialColorPolicy = (typeof MATERIAL_COLOR_POLICIES)[number];

/**
 * Map slots MaterialAsset v1 understands. A v1 document with any other slot is
 * rejected with `unknown_map_role`; silently dropping it would lose authored
 * data and only surface as a missing map much later.
 *
 * Phase 4.5 adds the professional PBR maps on top of the 4.1 baseColor/normal
 * pair. The schema version stays 1 because every addition is an optional field:
 * a v1 reader keeps ignoring maps it does not know at its own boundary, while
 * this build rejects unknown roles explicitly.
 */
export const TEXTURE_MAP_ROLES = [
  'baseColor',
  'normal',
  'roughness',
  'metalness',
  'ao',
  'orm',
  'emissive',
] as const;
export type TextureMapRole = (typeof TEXTURE_MAP_ROLES)[number];

/**
 * Roles the procedural generator can synthesize. Imported bitmaps use any role;
 * only these two exist as built-in library assets.
 */
export const PROCEDURAL_TEXTURE_MAP_ROLES = ['baseColor', 'normal'] as const;
export type ProceduralTextureMapRole = (typeof PROCEDURAL_TEXTURE_MAP_ROLES)[number];

/**
 * Color space is a property of the map's *role*, not of the file. Assigning an
 * sRGB space to a normal map (or vice versa) is a correctness bug, so the
 * mapping is fixed here and enforced by the builder and by validation.
 *
 * Data maps (normal/roughness/metalness/AO/ORM) are linear; only color maps
 * (baseColor/emissive) are sRGB.
 */
export type TextureColorSpace = 'srgb' | 'linear';

export const TEXTURE_ROLE_COLOR_SPACE: Record<TextureMapRole, TextureColorSpace> = {
  baseColor: 'srgb',
  normal: 'linear',
  roughness: 'linear',
  metalness: 'linear',
  ao: 'linear',
  orm: 'linear',
  emissive: 'srgb',
};

/** Human-readable role labels used by the material panel. */
export const TEXTURE_MAP_ROLE_LABELS: Record<TextureMapRole, string> = {
  baseColor: 'Base Color',
  normal: 'Normal',
  roughness: 'Roughness',
  metalness: 'Metalness',
  ao: 'Ambient Occlusion',
  orm: 'ORM (O+R+M)',
  emissive: 'Emissive',
};

export const TEXTURE_WRAPS = ['repeat', 'clamp'] as const;
export type TextureWrap = (typeof TEXTURE_WRAPS)[number];

export const UV_MODES = ['physical-box'] as const;
export type UvMode = (typeof UV_MODES)[number];

export const MATERIAL_LICENSE_KINDS = ['built-in', 'cc0', 'user-owned', 'unknown'] as const;
export type MaterialLicenseKind = (typeof MATERIAL_LICENSE_KINDS)[number];

export interface MaterialAssetLicense {
  kind: MaterialLicenseKind;
  /** Where the asset came from; omitted when unknown. */
  source?: string;
  /** Required attribution text when the license needs one. */
  attribution?: string;
}

export interface MaterialAssetPbr {
  metalness: number;
  roughness: number;
  opacity: number;
  normalStrength: number;
  textureScale: number;
  /** Multiplier for the emissive map; 1 by default. */
  emissiveIntensity: number;
  /** Multiplier for the AO (or ORM red) channel; 1 by default. */
  aoIntensity: number;
}

/** A pointer to texture bytes that live outside the asset document. */
export interface TextureAssetRef {
  id: string;
  version: number;
  role: TextureMapRole;
  colorSpace: TextureColorSpace;
  wrap: TextureWrap;
}

export interface MaterialAssetMaps {
  baseColor?: TextureAssetRef;
  normal?: TextureAssetRef;
  roughness?: TextureAssetRef;
  metalness?: TextureAssetRef;
  ao?: TextureAssetRef;
  orm?: TextureAssetRef;
  emissive?: TextureAssetRef;
}

export interface MaterialAssetUv {
  mode: UvMode;
  tileCm: number;
}

export interface MaterialAsset {
  id: string;
  version: typeof MATERIAL_ASSET_VERSION;
  label: string;
  type: MaterialType;
  colorPolicy: MaterialColorPolicy;
  /** Fixed albedo for `colorPolicy: 'fixed'`; null when the object supplies it. */
  baseColor: string | null;
  pbr: MaterialAssetPbr;
  maps: MaterialAssetMaps;
  uv: MaterialAssetUv;
  license: MaterialAssetLicense;
}

export type TextureAssetMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export const TEXTURE_ASSET_MIME_TYPES: readonly TextureAssetMimeType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
];

export interface TextureAssetSource {
  kind: 'procedural' | 'bitmap';
  /** Generator or import pipeline name, for provenance only. */
  generator?: string;
}

/**
 * Metadata for the bytes a `TextureAssetRef` points at. The bytes themselves
 * are not part of the material document; 4.1 only ships procedural sources.
 */
export interface TextureAsset {
  id: string;
  version: number;
  /** null for procedural textures: there is no encoded image file. */
  mimeType: TextureAssetMimeType | null;
  /** 0 for procedural textures (the size is chosen at build time). */
  width: number;
  height: number;
  byteSize: number;
  /** Content hash (e.g. `sha256:...`); null for procedural textures. */
  contentHash: string | null;
  source: TextureAssetSource;
}

export type MaterialAssetErrorCode =
  | 'not_an_object'
  | 'unsupported_version'
  | 'invalid_id'
  | 'invalid_label'
  | 'invalid_type'
  | 'invalid_color'
  | 'invalid_uv'
  | 'unknown_map_role'
  | 'unknown_texture';

export interface MaterialAssetValidationOptions {
  /**
   * When supplied, every texture reference must resolve to a known asset.
   * Registry boundaries pass this; ad-hoc validation can omit it.
   */
  knownTextureIds?: ReadonlySet<string>;
}

export type MaterialAssetValidationResult =
  | { ok: true; asset: MaterialAsset; warnings: string[] }
  | { ok: false; code: MaterialAssetErrorCode; message: string };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMaterialType(value: unknown): value is MaterialType {
  return typeof value === 'string' && (MATERIAL_TYPES as readonly string[]).includes(value);
}

function isLicenseKind(value: unknown): value is MaterialLicenseKind {
  return typeof value === 'string' && (MATERIAL_LICENSE_KINDS as readonly string[]).includes(value);
}

function isTextureWrap(value: unknown): value is TextureWrap {
  return typeof value === 'string' && (TEXTURE_WRAPS as readonly string[]).includes(value);
}

function clampNumber(value: unknown, range: NumericRange, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, range.min), range.max);
}

function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(trimmed) ? trimmed : null;
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  return trimmed.slice(0, maxLength);
}

function isValidAssetId(value: unknown): value is string {
  return typeof value === 'string' && MATERIAL_ASSET_ID_PATTERN.test(value);
}

function normalizePbr(value: unknown, warnings: string[]): MaterialAssetPbr {
  const record = isRecord(value) ? value : {};
  if (value !== undefined && !isRecord(value)) {
    warnings.push('pbr obyekt emas; standart qiymatlar ishlatildi.');
  }
  return {
    metalness: clampNumber(record.metalness, PBR_LIMITS.metalness, DEFAULT_PBR_MATERIAL.metalness),
    roughness: clampNumber(record.roughness, PBR_LIMITS.roughness, DEFAULT_PBR_MATERIAL.roughness),
    opacity: clampNumber(record.opacity, PBR_LIMITS.opacity, DEFAULT_PBR_MATERIAL.opacity),
    normalStrength: clampNumber(
      record.normalStrength,
      PBR_LIMITS.normalStrength,
      DEFAULT_PBR_MATERIAL.normalStrength,
    ),
    textureScale: clampNumber(
      record.textureScale,
      PBR_LIMITS.textureScale,
      DEFAULT_PBR_MATERIAL.textureScale,
    ),
    emissiveIntensity: clampNumber(
      record.emissiveIntensity,
      PBR_LIMITS.emissiveIntensity,
      DEFAULT_PBR_MATERIAL.emissiveIntensity,
    ),
    aoIntensity: clampNumber(
      record.aoIntensity,
      PBR_LIMITS.aoIntensity,
      DEFAULT_PBR_MATERIAL.aoIntensity,
    ),
  };
}

function normalizeUv(value: unknown): MaterialAssetUv | null {
  const record = isRecord(value) ? value : {};
  const mode = record.mode === undefined ? 'physical-box' : record.mode;
  if (!(UV_MODES as readonly unknown[]).includes(mode)) {
    return null;
  }
  return {
    mode: mode as UvMode,
    tileCm: clampNumber(record.tileCm, { min: 1, max: 1000, step: 1 }, DEFAULT_UV_TILE_CM),
  };
}

function normalizeLicense(value: unknown, warnings: string[]): MaterialAssetLicense {
  const record = isRecord(value) ? value : {};
  if (value !== undefined && !isRecord(value)) {
    warnings.push('license obyekt emas; "unknown" deb belgilandi.');
  }
  const kind = isLicenseKind(record.kind) ? record.kind : 'unknown';
  if (record.kind !== undefined && !isLicenseKind(record.kind)) {
    warnings.push('license.kind noma\u2019lum; "unknown" deb belgilandi.');
  }
  const license: MaterialAssetLicense = { kind };
  const source = normalizeText(record.source, 200);
  const attribution = normalizeText(record.attribution, 200);
  if (record.source !== undefined && source === null) {
    warnings.push('license.source bo\u2019sh yoki noto\u2019g\u2019ri; tashlab yuborildi.');
  }
  if (record.attribution !== undefined && attribution === null) {
    warnings.push('license.attribution bo\u2019sh yoki noto\u2019g\u2019ri; tashlab yuborildi.');
  }
  if (source) {
    license.source = source;
  }
  if (attribution) {
    license.attribution = attribution;
  }
  return license;
}

interface TextureRefOutcome {
  ref: TextureAssetRef | null;
  error?: { code: 'unknown_texture'; message: string };
}

function normalizeTextureRef(
  value: unknown,
  role: TextureMapRole,
  warnings: string[],
  knownTextureIds: ReadonlySet<string> | undefined,
): TextureRefOutcome {
  if (!isRecord(value)) {
    warnings.push(`"${role}" map yozuvi obyekt emas; tashlab yuborildi.`);
    return { ref: null };
  }
  if (!isValidAssetId(value.id)) {
    warnings.push(`"${role}" map id noto\u2019g\u2019ri; tashlab yuborildi.`);
    return { ref: null };
  }
  if (
    typeof value.version !== 'number' ||
    !Number.isInteger(value.version) ||
    value.version < 1
  ) {
    warnings.push(`"${role}" map versiyasi noto\u2019g\u2019ri; tashlab yuborildi.`);
    return { ref: null };
  }
  if (value.role !== undefined && value.role !== role) {
    warnings.push(`"${role}" map roli mos kelmadi; tashlab yuborildi.`);
    return { ref: null };
  }
  if (knownTextureIds && !knownTextureIds.has(value.id)) {
    return {
      ref: null,
      error: {
        code: 'unknown_texture',
        message: `"${role}" map "${value.id}" tekstura katalogida topilmadi.`,
      },
    };
  }
  const expectedColorSpace = TEXTURE_ROLE_COLOR_SPACE[role];
  if (value.colorSpace !== undefined && value.colorSpace !== expectedColorSpace) {
    warnings.push(
      `"${role}" map colorSpace "${String(value.colorSpace)}" emas, "${expectedColorSpace}" qilib tuzatildi.`,
    );
  }
  let wrap: TextureWrap = 'repeat';
  if (isTextureWrap(value.wrap)) {
    wrap = value.wrap;
  } else if (value.wrap !== undefined) {
    warnings.push(`"${role}" map wrap noto\u2019g\u2019ri; "repeat" ishlatildi.`);
  }
  return {
    ref: {
      id: value.id,
      version: value.version,
      role,
      colorSpace: expectedColorSpace,
      wrap,
    },
  };
}

interface MapNormalizationError {
  code: 'unknown_map_role' | 'unknown_texture';
  message: string;
}

function normalizeMaps(
  value: unknown,
  warnings: string[],
  knownTextureIds: ReadonlySet<string> | undefined,
): MaterialAssetMaps | { error: MapNormalizationError } {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    warnings.push('maps obyekt emas; bo\u2019sh deb qabul qilindi.');
    return {};
  }

  for (const key of Object.keys(value)) {
    if (!(TEXTURE_MAP_ROLES as readonly string[]).includes(key)) {
      return {
        error: {
          code: 'unknown_map_role',
          message: `"${key}" map roli MaterialAsset v1 da qo\u2019llab-quvvatlanmaydi. Ruxsat etilgan rollar: ${TEXTURE_MAP_ROLES.join(', ')}.`,
        },
      };
    }
  }

  const maps: MaterialAssetMaps = {};
  for (const role of TEXTURE_MAP_ROLES) {
    if (value[role] === undefined) {
      continue;
    }
    const outcome = normalizeTextureRef(value[role], role, warnings, knownTextureIds);
    if (outcome.error) {
      return { error: outcome.error };
    }
    if (outcome.ref) {
      maps[role] = outcome.ref;
    }
  }
  return maps;
}

export interface MaterialAssetMapsValidationOptions {
  knownTextureIds?: ReadonlySet<string>;
}

export type MaterialAssetMapsValidationResult =
  | { ok: true; maps: MaterialAssetMaps; warnings: string[] }
  | { ok: false; code: 'unknown_map_role' | 'unknown_texture'; message: string };

/**
 * Validate and normalize a map collection outside a full MaterialAsset.
 *
 * Scene storage uses this so a stored texture reference goes through exactly the
 * same role/color-space rules as a material asset, without synthesizing a whole
 * asset. Unknown roles and malformed references are handled identically to
 * `validateMaterialAsset()`.
 */
export function validateMaterialAssetMaps(
  value: unknown,
  options: MaterialAssetMapsValidationOptions = {},
): MaterialAssetMapsValidationResult {
  const warnings: string[] = [];
  const maps = normalizeMaps(value, warnings, options.knownTextureIds);
  if ('error' in maps) {
    return { ok: false, code: maps.error.code, message: maps.error.message };
  }
  return { ok: true, maps, warnings };
}

/**
 * Validate and normalize a raw material asset.
 *
 * Invalid required fields are rejected. Unsupported map roles are rejected so a
 * v1 reader can never accept data it does not understand. Other invalid optional
 * values are corrected or dropped and reported in `warnings`, so a caller never
 * receives a material that silently claims something different from what was
 * stored.
 */
export function validateMaterialAsset(
  input: unknown,
  options: MaterialAssetValidationOptions = {},
): MaterialAssetValidationResult {
  if (!isRecord(input)) {
    return { ok: false, code: 'not_an_object', message: 'Material asset obyekt emas.' };
  }
  if (input.version !== MATERIAL_ASSET_VERSION) {
    return {
      ok: false,
      code: 'unsupported_version',
      message: `Material asset versiyasi qo\u2019llab-quvvatlanmaydi: ${String(input.version)}.`,
    };
  }
  if (!isValidAssetId(input.id)) {
    return {
      ok: false,
      code: 'invalid_id',
      message: 'Material asset id bo\u2019sh yoki noto\u2019g\u2019ri formatda.',
    };
  }
  const label = normalizeText(input.label, MATERIAL_ASSET_LABEL_MAX_LENGTH);
  if (!label) {
    return { ok: false, code: 'invalid_label', message: 'Material asset nomi bo\u2019sh.' };
  }
  if (!isMaterialType(input.type)) {
    return {
      ok: false,
      code: 'invalid_type',
      message: `Material turi qo\u2019llab-quvvatlanmaydi: ${String(input.type)}.`,
    };
  }

  const warnings: string[] = [];
  if (typeof input.label === 'string' && input.label.trim().length > MATERIAL_ASSET_LABEL_MAX_LENGTH) {
    warnings.push(`Nom ${MATERIAL_ASSET_LABEL_MAX_LENGTH} belgidan qisqartirildi.`);
  }

  let colorPolicy: MaterialColorPolicy;
  if (
    typeof input.colorPolicy === 'string' &&
    (MATERIAL_COLOR_POLICIES as readonly string[]).includes(input.colorPolicy)
  ) {
    colorPolicy = input.colorPolicy as MaterialColorPolicy;
  } else {
    colorPolicy = normalizeHexColor(input.baseColor) ? 'fixed' : 'object';
    if (input.colorPolicy !== undefined) {
      warnings.push('colorPolicy noto\u2019g\u2019ri; baseColor\u2019dan aniqlandi.');
    }
  }

  let baseColor: string | null = null;
  if (colorPolicy === 'fixed') {
    baseColor = normalizeHexColor(input.baseColor);
    if (!baseColor) {
      return {
        ok: false,
        code: 'invalid_color',
        message: 'colorPolicy "fixed" uchun baseColor #rrggbb bo\u2019lishi kerak.',
      };
    }
  } else if (input.baseColor !== undefined && input.baseColor !== null) {
    warnings.push('colorPolicy "object" uchun baseColor e\u2019tiborsiz qoldirildi.');
  }

  const uv = normalizeUv(input.uv);
  if (!uv) {
    return { ok: false, code: 'invalid_uv', message: 'UV rejimi qo\u2019llab-kuvvatlanmaydi.' };
  }

  const maps = normalizeMaps(input.maps, warnings, options.knownTextureIds);
  if ('error' in maps) {
    return { ok: false, code: maps.error.code, message: maps.error.message };
  }

  const asset: MaterialAsset = {
    id: input.id,
    version: MATERIAL_ASSET_VERSION,
    label,
    type: input.type,
    colorPolicy,
    baseColor,
    pbr: normalizePbr(input.pbr, warnings),
    maps,
    uv,
    license: normalizeLicense(input.license, warnings),
  };

  return { ok: true, asset, warnings };
}

function canonicalTextureRef(ref: TextureAssetRef): TextureAssetRef {
  return {
    id: ref.id,
    version: ref.version,
    role: ref.role,
    colorSpace: ref.colorSpace,
    wrap: ref.wrap,
  };
}

/**
 * Rebuild an asset with a fixed key order. `validateMaterialAsset` already
 * produces this shape; the function keeps serialization deterministic even if
 * a caller builds an asset literal directly.
 */
export function canonicalMaterialAsset(asset: MaterialAsset): MaterialAsset {
  return {
    id: asset.id,
    version: MATERIAL_ASSET_VERSION,
    label: asset.label,
    type: asset.type,
    colorPolicy: asset.colorPolicy,
    baseColor: asset.baseColor,
    pbr: {
      metalness: asset.pbr.metalness,
      roughness: asset.pbr.roughness,
      opacity: asset.pbr.opacity,
      normalStrength: asset.pbr.normalStrength,
      textureScale: asset.pbr.textureScale,
      emissiveIntensity: asset.pbr.emissiveIntensity,
      aoIntensity: asset.pbr.aoIntensity,
    },
    maps: {
      ...(asset.maps.baseColor ? { baseColor: canonicalTextureRef(asset.maps.baseColor) } : {}),
      ...(asset.maps.normal ? { normal: canonicalTextureRef(asset.maps.normal) } : {}),
      ...(asset.maps.roughness ? { roughness: canonicalTextureRef(asset.maps.roughness) } : {}),
      ...(asset.maps.metalness ? { metalness: canonicalTextureRef(asset.maps.metalness) } : {}),
      ...(asset.maps.ao ? { ao: canonicalTextureRef(asset.maps.ao) } : {}),
      ...(asset.maps.orm ? { orm: canonicalTextureRef(asset.maps.orm) } : {}),
      ...(asset.maps.emissive ? { emissive: canonicalTextureRef(asset.maps.emissive) } : {}),
    },
    uv: { mode: asset.uv.mode, tileCm: asset.uv.tileCm },
    license: {
      kind: asset.license.kind,
      ...(asset.license.source === undefined ? {} : { source: asset.license.source }),
      ...(asset.license.attribution === undefined
        ? {}
        : { attribution: asset.license.attribution }),
    },
  };
}

/** Deterministic JSON for hashing, comparison and storage. */
export function serializeMaterialAsset(asset: MaterialAsset): string {
  return JSON.stringify(canonicalMaterialAsset(asset));
}

/** Parse a stored asset document and validate it. Never throws. */
export function parseMaterialAsset(text: string): MaterialAssetValidationResult {
  if (typeof text !== 'string') {
    return { ok: false, code: 'not_an_object', message: 'Material asset matni emas.' };
  }
  if (new TextEncoder().encode(text).length > MAX_MATERIAL_ASSET_BYTES) {
    return {
      ok: false,
      code: 'not_an_object',
      message: `Material asset fayli juda katta (maksimum ${MAX_MATERIAL_ASSET_BYTES} bayt).`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, code: 'not_an_object', message: 'Material asset JSON buzilgan.' };
  }
  return validateMaterialAsset(parsed);
}

export type MaterialAssetMigrationResult =
  | {
      ok: true;
      asset: MaterialAsset;
      fromVersion: number;
      toVersion: typeof MATERIAL_ASSET_VERSION;
      warnings: string[];
    }
  | { ok: false; code: 'unsupported_version' | MaterialAssetErrorCode; message: string };

/** Registered steps for versions that predate the current schema. */
const MATERIAL_ASSET_MIGRATIONS = new Map<
  number,
  (input: UnknownRecord) => UnknownRecord
>();

/**
 * Migration entry point. Version 1 is the first schema, so the only accepted
 * input is already current; a future version is rejected rather than guessed at.
 */
export function migrateMaterialAsset(input: unknown): MaterialAssetMigrationResult {
  if (!isRecord(input)) {
    return { ok: false, code: 'not_an_object', message: 'Material asset obyekt emas.' };
  }
  const version = input.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return {
      ok: false,
      code: 'unsupported_version',
      message: `Material asset versiyasi noto\u2019g\u2019ri: ${String(version)}.`,
    };
  }
  if (version > MATERIAL_ASSET_VERSION) {
    return {
      ok: false,
      code: 'unsupported_version',
      message: `Material asset versiyasi ${version} bu build\u2019da qo\u2019llab-kuvvatlanmaydi.`,
    };
  }

  let current = input;
  for (let from = version; from < MATERIAL_ASSET_VERSION; from += 1) {
    const step = MATERIAL_ASSET_MIGRATIONS.get(from);
    if (!step) {
      return {
        ok: false,
        code: 'unsupported_version',
        message: `v${from} -> v${from + 1} migratsiyasi mavjud emas.`,
      };
    }
    current = step(current);
  }

  const validated = validateMaterialAsset(current);
  if (!validated.ok) {
    return validated;
  }
  return {
    ok: true,
    asset: validated.asset,
    fromVersion: version,
    toVersion: MATERIAL_ASSET_VERSION,
    warnings: validated.warnings,
  };
}

export type TextureAssetValidationResult =
  | { ok: true; asset: TextureAsset; warnings: string[] }
  | {
      ok: false;
      code:
        | 'not_an_object'
        | 'unsupported_version'
        | 'invalid_id'
        | 'invalid_mime_type'
        | 'invalid_dimensions'
        | 'invalid_byte_size'
        | 'invalid_hash'
        | 'invalid_source';
      message: string;
    };

/**
 * Validate texture metadata. Bitmap assets must carry the facts a buyer needs
 * (MIME, dimensions, byte size, content hash); procedural assets must not
 * pretend to have an encoded file.
 */
export function validateTextureAsset(input: unknown): TextureAssetValidationResult {
  if (!isRecord(input)) {
    return { ok: false, code: 'not_an_object', message: 'Texture asset obyekt emas.' };
  }
  if (typeof input.version !== 'number' || !Number.isInteger(input.version) || input.version < 1) {
    return {
      ok: false,
      code: 'unsupported_version',
      message: 'Texture asset versiyasi noto\u2019g\u2019ri.',
    };
  }
  if (!isValidAssetId(input.id)) {
    return { ok: false, code: 'invalid_id', message: 'Texture asset id noto\u2019g\u2019ri.' };
  }
  const source = isRecord(input.source) ? input.source : null;
  if (!source || (source.kind !== 'procedural' && source.kind !== 'bitmap')) {
    return { ok: false, code: 'invalid_source', message: 'Texture asset manbasi noto\u2019g\u2019ri.' };
  }
  const warnings: string[] = [];

  const width = input.width;
  const height = input.height;
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 0 ||
    height < 0
  ) {
    return {
      ok: false,
      code: 'invalid_dimensions',
      message: 'Texture asset o\u2019lchamlari noto\u2019g\u2019ri.',
    };
  }
  if (typeof input.byteSize !== 'number' || !Number.isInteger(input.byteSize) || input.byteSize < 0) {
    return {
      ok: false,
      code: 'invalid_byte_size',
      message: 'Texture asset hajmi noto\u2019g\u2019ri.',
    };
  }

  const generator = normalizeText(source.generator, 120);
  if (source.kind === 'procedural') {
    if (input.mimeType !== null && input.mimeType !== undefined) {
      warnings.push('Procedural texture uchun mimeType null bo\u2019lishi kerak; null qilindi.');
    }
    if (width !== 0 || height !== 0) {
      warnings.push('Procedural texture o\u2019lchami build vaqtida tanlanadi; 0 qilindi.');
    }
    if (typeof input.byteSize === 'number' && input.byteSize !== 0) {
      warnings.push('Procedural texture fayl hajmiga ega emas; 0 qilindi.');
    }
    if (input.contentHash !== null && input.contentHash !== undefined) {
      warnings.push('Procedural texture content hash\u2019ga ega emas; null qilindi.');
    }
    return {
      ok: true,
      asset: {
        id: input.id,
        version: input.version,
        mimeType: null,
        width: 0,
        height: 0,
        byteSize: 0,
        contentHash: null,
        source: { kind: 'procedural', ...(generator ? { generator } : {}) },
      },
      warnings,
    };
  }

  if (
    typeof input.mimeType !== 'string' ||
    !(TEXTURE_ASSET_MIME_TYPES as readonly string[]).includes(input.mimeType)
  ) {
    return {
      ok: false,
      code: 'invalid_mime_type',
      message: 'Texture asset MIME turi qo\u2019llab-kuvvatlanmaydi.',
    };
  }
  if (width <= 0 || height <= 0) {
    return {
      ok: false,
      code: 'invalid_dimensions',
      message: 'Bitmap texture o\u2019lchami musbat bo\u2019lishi kerak.',
    };
  }
  if (input.byteSize <= 0) {
    return { ok: false, code: 'invalid_byte_size', message: 'Bitmap texture hajmi noto\u2019g\u2019ri.' };
  }
  const contentHash = normalizeText(input.contentHash, 128);
  if (!contentHash) {
    return {
      ok: false,
      code: 'invalid_hash',
      message: 'Bitmap texture content hash\u2019siz saqlanmaydi.',
    };
  }

  return {
    ok: true,
    asset: {
      id: input.id,
      version: input.version,
      mimeType: input.mimeType as TextureAssetMimeType,
      width,
      height,
      byteSize: input.byteSize,
      contentHash,
      source: { kind: 'bitmap', ...(generator ? { generator } : {}) },
    },
    warnings,
  };
}
