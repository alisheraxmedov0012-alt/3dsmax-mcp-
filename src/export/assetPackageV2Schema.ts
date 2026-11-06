/**
 * Phase 6.1-A — asset package v2 schema and runtime validation.
 *
 * Kept separate from the builder/verifier so the manifest contract can be
 * reviewed and tested without importing the export pipeline.
 */
import { isPng, pngSize } from './pngSize';
import { isProductPreviewFilename } from '../viewer/productPreviewViews';
import type { SceneData, SceneObject } from '../scene/types';
import {
  ASSET_PACKAGE_FORMAT,
  type AssetPreviewImage,
} from './assetPackage';

export const ASSET_PACKAGE_V2_VERSION = 2;
export const ASSET_PACKAGE_V2_README = 'README.txt';
export const ASSET_PACKAGE_V2_LICENSE = 'LICENSE.txt';
export const ASSET_PACKAGE_V2_METADATA = 'metadata.json';
export const ASSET_PACKAGE_V2_CHECKSUMS = 'checksums.txt';
export const ASSET_PACKAGE_V2_MODEL = 'models/model.glb';
export const ASSET_PACKAGE_V2_PREVIEW_PREFIX = 'previews/';

/** Companion MTL path for an OBJ entry (`models/model.obj` → `models/model.mtl`). */
export function objMtlPath(objFile: string): string {
  return objFile.replace(/\.obj$/u, '.mtl');
}

/** Normalize a single archive folder name; `null` means no enclosing folder. */
export function sanitizeArchiveRoot(value: string): string | null {
  const normalized = value
    .normalize('NFC')
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^[-.]+|[-.]+$/gu, '')
    .slice(0, 64);
  if (normalized === '' || normalized === '.' || normalized === '..') {
    return null;
  }
  return normalized;
}

/** Prefix a root-relative package path with the optional archive folder. */
export function archivePath(root: string, path: string): string {
  return root === '' ? path : `${root}/${path}`;
}

export const ASSET_PACKAGE_V2_SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SPDX_PATTERN = /^[A-Za-z0-9.+-]{1,64}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Resource limits for a v2 archive.
 *
 * Rationale: the current GLB package is a few hundred kilobytes and a 4K preview
 * is well under 2 MB. These caps leave generous room for future OBJ/STL/3MF
 * models and texture sidecars while keeping a single browser tab bounded. The
 * limits are also used by the builder, so it cannot emit an archive that its own
 * verifier rejects.
 */
export interface AssetPackageV2Limits {
  /** Compressed ZIP bytes accepted by the verifier. */
  archiveBytes: number;
  /** Sum of central-directory original sizes (decompression budget). */
  totalDecompressedBytes: number;
  /** Generic fallback for a single entry. */
  entryBytes: number;
  /** ZIP entries, including metadata.json and checksums.txt. */
  entries: number;
  metadataBytes: number;
  readmeBytes: number;
  licenseBytes: number;
  checksumsBytes: number;
  modelBytes: number;
  mtlBytes: number;
  textureBytes: number;
  previewBytes: number;
}

export const ASSET_PACKAGE_V2_LIMITS: AssetPackageV2Limits = {
  archiveBytes: 64 * 1024 * 1024,
  totalDecompressedBytes: 128 * 1024 * 1024,
  entryBytes: 64 * 1024 * 1024,
  // 256 payload files + metadata.json + checksums.txt.
  entries: 258,
  metadataBytes: 1024 * 1024,
  readmeBytes: 256 * 1024,
  licenseBytes: 512 * 1024,
  checksumsBytes: 256 * 1024,
  modelBytes: 64 * 1024 * 1024,
  mtlBytes: 4 * 1024 * 1024,
  textureBytes: 16 * 1024 * 1024,
  previewBytes: 16 * 1024 * 1024,
};

const MAX_PATH_LENGTH = 200;
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_AUTHOR_LENGTH = 120;
const MAX_LICENSE_NAME_LENGTH = 120;
const MAX_LICENSE_TEXT_LENGTH = 100_000;
const MAX_MODELS = 16;
const MAX_TEXTURES = 128;
const MAX_PREVIEWS = 32;
const MAX_FILES = 256;

export type AssetPackageV2ModelFormat = 'glb' | 'obj' | 'stl' | '3mf';
export const ASSET_PACKAGE_V2_MODEL_FORMATS: readonly AssetPackageV2ModelFormat[] = [
  'glb',
  'obj',
  'stl',
  '3mf',
];
export type AssetPackageV2LengthUnit = 'mm' | 'cm' | 'm';
export type AssetPackageV2CoordinateConvention = 'Y_UP_RIGHT_HANDED';

export interface AssetPackageV2BoundsMm {
  min: [number, number, number];
  max: [number, number, number];
}

export interface AssetPackageV2License {
  name: string;
  spdx?: string;
  /** Present only when the archive contains the license text file. */
  textFile?: string;
}

export interface AssetPackageV2Product {
  title: string;
  sku?: string;
  description?: string;
  author?: string;
  license?: AssetPackageV2License;
}

export interface AssetPackageV2Units {
  length: AssetPackageV2LengthUnit;
  coordinates?: AssetPackageV2CoordinateConvention;
}

export interface AssetPackageV2ModelStats {
  meshes?: number;
  primitives?: number;
  triangles?: number;
  vertices?: number;
  faces?: number;
  objects?: number;
  materials?: string[];
  textures?: number;
  externalUris?: number;
  generator?: string | null;
  boundsMm?: AssetPackageV2BoundsMm;
}

export interface AssetPackageV2Model {
  format: AssetPackageV2ModelFormat;
  file: string;
  bytes: number;
  sha256: string;
  /** File coordinate unit. GLB is metres; OBJ/STL/3MF are millimetres. */
  unit?: AssetPackageV2LengthUnit;
  stats: AssetPackageV2ModelStats;
}

export interface AssetPackageV2Texture {
  file: string;
  role: string;
  sourceId?: string;
  sha256: string;
  bytes: number;
  mimeType: 'image/png';
}

export interface AssetPackageV2Preview {
  file: string;
  width: number;
  height: number;
  sha256: string;
  bytes: number;
}

export interface AssetPackageV2File {
  path: string;
  bytes: number;
  sha256: string;
  mimeType: string;
}

export interface AssetPackageV2Metadata {
  format: typeof ASSET_PACKAGE_FORMAT;
  formatVersion: typeof ASSET_PACKAGE_V2_VERSION;
  /** Optional single archive folder, e.g. `OAK-001`. Files stay root-relative. */
  archiveRoot?: string;
  generatedAt?: string;
  product: AssetPackageV2Product;
  units: AssetPackageV2Units;
  models: AssetPackageV2Model[];
  textures: AssetPackageV2Texture[];
  previews: AssetPackageV2Preview[];
  /**
   * Every payload entry except `metadata.json` (self) and `checksums.txt`
   * (which is written after this document). `checksums.txt` covers both.
   */
  files: AssetPackageV2File[];
}

export interface AssetPackageV2LicenseInput {
  name: string;
  spdx?: string;
  /** When supplied, written verbatim to LICENSE.txt and linked from metadata. */
  text?: string;
}

export interface AssetPackageV2ProductInput {
  title: string;
  sku?: string;
  description?: string;
  author?: string;
  license?: AssetPackageV2LicenseInput;
}

export interface AssetPackageV2Input {
  scene: SceneData;
  object: SceneObject;
  projectName: string;
  product: AssetPackageV2ProductInput;
  previews?: readonly AssetPreviewImage[] | null;
  /** Export-only map size; omitted keeps the 128 px default. */
  textureSize?: 128 | 512;
  generatedAt?: Date;
}

export interface AssetPackageV2 {
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
  mimeType: 'application/zip';
  metadata: AssetPackageV2Metadata;
  entries: Array<{ path: string; bytes: number }>;
}

export type AssetPackageV2Outcome =
  | { ok: true; asset: AssetPackageV2 }
  | { ok: false; reason: string };

export interface AssetPackageV2Validation {
  ok: boolean;
  problems: string[];
  metadata: AssetPackageV2Metadata | null;
}

interface PathOk {
  ok: true;
  path: string;
}
interface PathFailure {
  ok: false;
  problem: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= max;
}

function isOptionalString(value: unknown, max: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= max);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

/**
 * Normalize a ZIP entry path and reject anything that could escape the archive.
 * Backslashes are rejected rather than rewritten so a Windows-style traversal is
 * never silently turned into a valid path.
 */
export function normalizeAssetPath(value: unknown): PathOk | PathFailure {
  if (typeof value !== 'string') {
    return { ok: false, problem: 'Path matn emas.' };
  }
  const raw = value.normalize('NFC');
  if (raw.length === 0 || raw.length > MAX_PATH_LENGTH) {
    return { ok: false, problem: `Path uzunligi 1..${MAX_PATH_LENGTH} bo'lishi kerak.` };
  }
  if (raw.includes('\\')) {
    return { ok: false, problem: `Pathda "\\" bo'lmasligi kerak: "${raw}".` };
  }
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return { ok: false, problem: `Pathda boshqaruv belgisi bor: "${raw}".` };
    }
  }
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
    return { ok: false, problem: `Absolyut path taqiqlangan: "${raw}".` };
  }
  const segments = raw.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      return { ok: false, problem: `Path traversal yoki bo'sh segment: "${raw}".` };
    }
    if (/\s/u.test(segment)) {
      return { ok: false, problem: `Path segmentida bo'shliq bor: "${segment}".` };
    }
    if (/[. ]$/u.test(segment)) {
      return { ok: false, problem: `Path segmenti nuqta yoki bo'shliq bilan tugaydi: "${segment}".` };
    }
  }
  return { ok: true, path: segments.join('/') };
}

function stripOptionalRoot(path: string): string {
  if (
    path === ASSET_PACKAGE_V2_README ||
    path === ASSET_PACKAGE_V2_LICENSE ||
    path === ASSET_PACKAGE_V2_METADATA ||
    path === ASSET_PACKAGE_V2_CHECKSUMS ||
    path.startsWith('models/') ||
    path.startsWith('textures/') ||
    path.startsWith('previews/')
  ) {
    return path;
  }
  const slash = path.indexOf('/');
  if (slash > 0) {
    const rest = path.slice(slash + 1);
    if (
      rest === ASSET_PACKAGE_V2_README ||
      rest === ASSET_PACKAGE_V2_LICENSE ||
      rest === ASSET_PACKAGE_V2_METADATA ||
      rest === ASSET_PACKAGE_V2_CHECKSUMS ||
      rest.startsWith('models/') ||
      rest.startsWith('textures/') ||
      rest.startsWith('previews/')
    ) {
      return rest;
    }
  }
  return path;
}

export function expectedMimeForPath(path: string): string | null {
  const relative = stripOptionalRoot(path);
  if (
    relative === ASSET_PACKAGE_V2_README ||
    relative === ASSET_PACKAGE_V2_LICENSE ||
    relative === ASSET_PACKAGE_V2_CHECKSUMS
  ) {
    return 'text/plain';
  }
  if (relative === ASSET_PACKAGE_V2_METADATA) {
    return 'application/json';
  }
  if (/^models\/[^/]+\.glb$/u.test(relative)) {
    return 'model/gltf-binary';
  }
  if (/^models\/[^/]+\.obj$/u.test(relative)) {
    return 'model/obj';
  }
  if (/^models\/[^/]+\.mtl$/u.test(relative)) {
    return 'model/mtl';
  }
  if (/^models\/[^/]+\.stl$/u.test(relative)) {
    return 'model/stl';
  }
  if (/^models\/[^/]+\.3mf$/u.test(relative)) {
    return 'model/3mf';
  }
  if (/^textures\/[^/]+\.png$/u.test(relative)) {
    return 'image/png';
  }
  if (/^previews\/[^/]+\.png$/u.test(relative)) {
    return 'image/png';
  }
  return null;
}

/** Per-entry cap for a path, before the archive is inflated. */
export function limitForPath(
  path: string,
  limits: AssetPackageV2Limits = ASSET_PACKAGE_V2_LIMITS,
): number {
  const relative = stripOptionalRoot(path);
  if (relative === ASSET_PACKAGE_V2_METADATA) return limits.metadataBytes;
  if (relative === ASSET_PACKAGE_V2_README) return limits.readmeBytes;
  if (relative === ASSET_PACKAGE_V2_LICENSE) return limits.licenseBytes;
  if (relative === ASSET_PACKAGE_V2_CHECKSUMS) return limits.checksumsBytes;
  if (/^models\/[^/]+\.mtl$/u.test(relative)) return limits.mtlBytes;
  if (/^models\/[^/]+\.(glb|obj|stl|3mf)$/u.test(relative)) return limits.modelBytes;
  if (/^textures\/[^/]+\.png$/u.test(relative)) return limits.textureBytes;
  if (/^previews\/[^/]+\.png$/u.test(relative)) return limits.previewBytes;
  return limits.entryBytes;
}

export interface ArchivePlanEntry {
  path: string;
  bytes: number;
}

/**
 * Validate a set of archive entries before a ZIP is allocated. Shared by the
 * builder so it cannot produce an archive its verifier would reject.
 */
export function validateArchivePlan(
  entries: readonly ArchivePlanEntry[],
  limits: AssetPackageV2Limits = ASSET_PACKAGE_V2_LIMITS,
): string | null {
  if (entries.length > limits.entries) {
    return `Arxivda ${entries.length} ta entry bor; maksimum ${limits.entries}.`;
  }
  const seen = new Set<string>();
  let total = 0;
  for (const entry of entries) {
    const normalized = normalizeAssetPath(entry.path);
    if (!normalized.ok) {
      return normalized.problem;
    }
    if (normalized.path !== entry.path) {
      return `Path normallashtirilmagan: "${entry.path}".`;
    }
    if (seen.has(entry.path)) {
      return `Path takrorlangan: "${entry.path}".`;
    }
    seen.add(entry.path);
    if (!expectedMimeForPath(entry.path)) {
      return `Qo'llab-quvvatlanmaydigan path: "${entry.path}".`;
    }
    if (!isPositiveInteger(entry.bytes)) {
      return `"${entry.path}" hajmi musbat butun son bo'lishi kerak.`;
    }
    const limit = limitForPath(entry.path, limits);
    if (entry.bytes > limit) {
      return `"${entry.path}" hajmi ${entry.bytes} bayt; limit ${limit} bayt.`;
    }
    total += entry.bytes;
    if (total > limits.totalDecompressedBytes) {
      return `Arxivning ochilgan hajmi ${total} bayt; limit ${limits.totalDecompressedBytes} bayt.`;
    }
  }
  return null;
}

function normalizeOrProblem(value: unknown, problems: string[], label: string): string | null {
  const normalized = normalizeAssetPath(value);
  if (!normalized.ok) {
    problems.push(`${label}: ${normalized.problem}`);
    return null;
  }
  return normalized.path;
}

function validateProduct(value: unknown, problems: string[]): value is AssetPackageV2Product {
  if (!isRecord(value)) {
    problems.push('product obyekt emas.');
    return false;
  }
  if (!isNonEmptyString(value.title, MAX_TITLE_LENGTH)) {
    problems.push(`product.title 1..${MAX_TITLE_LENGTH} belgidan iborat bo'lishi kerak.`);
  }
  if (
    value.sku !== undefined &&
    (typeof value.sku !== 'string' || !ASSET_PACKAGE_V2_SKU_PATTERN.test(value.sku))
  ) {
    problems.push('product.sku faqat harf, raqam, ".", "_" va "-" dan iborat bo\'lishi kerak.');
  }
  if (!isOptionalString(value.description, MAX_DESCRIPTION_LENGTH)) {
    problems.push(`product.description ${MAX_DESCRIPTION_LENGTH} belgidan oshmasligi kerak.`);
  }
  if (!isOptionalString(value.author, MAX_AUTHOR_LENGTH)) {
    problems.push(`product.author ${MAX_AUTHOR_LENGTH} belgidan oshmasligi kerak.`);
  }
  if (value.license !== undefined) {
    if (!isRecord(value.license)) {
      problems.push('product.license obyekt emas.');
    } else {
      if (!isNonEmptyString(value.license.name, MAX_LICENSE_NAME_LENGTH)) {
        problems.push('product.license.name majburiy va bo\'sh bo\'lmasligi kerak.');
      }
      if (
        value.license.spdx !== undefined &&
        (typeof value.license.spdx !== 'string' || !SPDX_PATTERN.test(value.license.spdx))
      ) {
        problems.push('product.license.spdx formati noto\'g\'ri.');
      }
      if (value.license.textFile !== undefined) {
        const textFile = normalizeAssetPath(value.license.textFile);
        if (!textFile.ok || textFile.path !== ASSET_PACKAGE_V2_LICENSE) {
          problems.push('product.license.textFile faqat LICENSE.txt bo\'lishi mumkin.');
        }
      }
    }
  }
  return true;
}

function validateUnits(value: unknown, problems: string[]): value is AssetPackageV2Units {
  if (!isRecord(value)) {
    problems.push('units obyekt emas.');
    return false;
  }
  if (!['mm', 'cm', 'm'].includes(String(value.length))) {
    problems.push('units.length "mm", "cm" yoki "m" bo\'lishi kerak.');
  }
  if (
    value.coordinates !== undefined &&
    value.coordinates !== 'Y_UP_RIGHT_HANDED'
  ) {
    problems.push('units.coordinates faqat "Y_UP_RIGHT_HANDED" bo\'lishi mumkin.');
  }
  return true;
}

function validateModelStats(value: unknown, problems: string[], label: string): boolean {
  if (!isRecord(value)) {
    problems.push(`${label}.stats obyekt emas.`);
    return false;
  }
  for (const key of [
    'meshes',
    'primitives',
    'triangles',
    'vertices',
    'faces',
    'objects',
    'textures',
    'externalUris',
  ] as const) {
    if (value[key] !== undefined && !isNonNegativeInteger(value[key])) {
      problems.push(`${label}.stats.${key} manfiy bo'lmagan butun son bo'lishi kerak.`);
    }
  }
  if (value.materials !== undefined) {
    if (!Array.isArray(value.materials) || !value.materials.every((item) => typeof item === 'string')) {
      problems.push(`${label}.stats.materials matnlar massivi bo'lishi kerak.`);
    }
  }
  if (value.generator !== undefined && value.generator !== null && typeof value.generator !== 'string') {
    problems.push(`${label}.stats.generator matn yoki null bo'lishi kerak.`);
  }
  if (value.boundsMm !== undefined) {
    if (!isRecord(value.boundsMm)) {
      problems.push(`${label}.stats.boundsMm obyekt emas.`);
    } else {
      const min = value.boundsMm.min;
      const max = value.boundsMm.max;
      const isTriple = (entry: unknown): entry is number[] =>
        Array.isArray(entry) && entry.length === 3 && entry.every((item) => Number.isFinite(item));
      if (!isTriple(min) || !isTriple(max)) {
        problems.push(`${label}.stats.boundsMm min/max 3 ta son bo'lishi kerak.`);
      } else if (min.some((valueAt, axis) => valueAt > max[axis])) {
        problems.push(`${label}.stats.boundsMm min maxdan katta bo'lmasligi kerak.`);
      }
    }
  }
  return true;
}

function validateModels(value: unknown, problems: string[]): value is AssetPackageV2Model[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MODELS) {
    problems.push(`models 1..${MAX_MODELS} elementdan iborat massiv bo'lishi kerak.`);
    return false;
  }
  for (const [index, entry] of value.entries()) {
    const label = `models[${index}]`;
    if (!isRecord(entry)) {
      problems.push(`${label} obyekt emas.`);
      continue;
    }
    if (!(ASSET_PACKAGE_V2_MODEL_FORMATS as readonly unknown[]).includes(entry.format)) {
      problems.push(
        `${label}.format "glb", "obj", "stl" yoki "3mf" bo'lishi kerak.`,
      );
    }
    if (entry.unit !== undefined && !['mm', 'cm', 'm'].includes(String(entry.unit))) {
      problems.push(`${label}.unit "mm", "cm" yoki "m" bo'lishi kerak.`);
    }
    const file = normalizeOrProblem(entry.file, problems, `${label}.file`);
    if (file) {
      const format = typeof entry.format === 'string' ? entry.format : '';
      const expected = new RegExp(`^models/[^/]+\\.${format}$`, 'u');
      if (!expected.test(file)) {
        problems.push(`${label}.file "models/*.${format}" bo'lishi kerak.`);
      }
    }
    if (!isPositiveInteger(entry.bytes)) {
      problems.push(`${label}.bytes musbat butun son bo'lishi kerak.`);
    }
    if (!isSha256(entry.sha256)) {
      problems.push(`${label}.sha256 64 ta kichik hex belgidan iborat bo'lishi kerak.`);
    }
    validateModelStats(entry.stats, problems, label);
  }
  return true;
}

function validateTextures(value: unknown, problems: string[]): value is AssetPackageV2Texture[] {
  if (!Array.isArray(value) || value.length > MAX_TEXTURES) {
    problems.push(`textures 0..${MAX_TEXTURES} elementdan iborat massiv bo'lishi kerak.`);
    return false;
  }
  for (const [index, entry] of value.entries()) {
    const label = `textures[${index}]`;
    if (!isRecord(entry)) {
      problems.push(`${label} obyekt emas.`);
      continue;
    }
    const file = normalizeOrProblem(entry.file, problems, `${label}.file`);
    if (file && !/^textures\/[^/]+\.png$/u.test(file)) {
      problems.push(`${label}.file "textures/*.png" bo'lishi kerak.`);
    }
    if (!isNonEmptyString(entry.role, 64)) {
      problems.push(`${label}.role majburiy va bo'sh bo'lmasligi kerak.`);
    }
    if (entry.sourceId !== undefined && typeof entry.sourceId !== 'string') {
      problems.push(`${label}.sourceId matn bo'lishi kerak.`);
    }
    if (!isSha256(entry.sha256)) {
      problems.push(`${label}.sha256 64 ta kichik hex belgidan iborat bo'lishi kerak.`);
    }
    if (!isPositiveInteger(entry.bytes)) {
      problems.push(`${label}.bytes musbat butun son bo'lishi kerak.`);
    }
    if (entry.mimeType !== 'image/png') {
      problems.push(`${label}.mimeType hozircha faqat "image/png" bo'lishi mumkin.`);
    }
  }
  return true;
}

function validatePreviews(value: unknown, problems: string[]): value is AssetPackageV2Preview[] {
  if (!Array.isArray(value) || value.length > MAX_PREVIEWS) {
    problems.push(`previews 0..${MAX_PREVIEWS} elementdan iborat massiv bo'lishi kerak.`);
    return false;
  }
  for (const [index, entry] of value.entries()) {
    const label = `previews[${index}]`;
    if (!isRecord(entry)) {
      problems.push(`${label} obyekt emas.`);
      continue;
    }
    const file = normalizeOrProblem(entry.file, problems, `${label}.file`);
    if (file) {
      const basename = file.slice(ASSET_PACKAGE_V2_PREVIEW_PREFIX.length);
      if (
        !file.startsWith(ASSET_PACKAGE_V2_PREVIEW_PREFIX) ||
        !isProductPreviewFilename(basename)
      ) {
        problems.push(`${label}.file "previews/preview-*.png" bo'lishi kerak.`);
      }
    }
    if (!isPositiveInteger(entry.width) || !isPositiveInteger(entry.height)) {
      problems.push(`${label}.width/height musbat butun son bo'lishi kerak.`);
    }
    if (!isSha256(entry.sha256)) {
      problems.push(`${label}.sha256 64 ta kichik hex belgidan iborat bo'lishi kerak.`);
    }
    if (!isPositiveInteger(entry.bytes)) {
      problems.push(`${label}.bytes musbat butun son bo'lishi kerak.`);
    }
  }
  return true;
}

function validateFiles(value: unknown, problems: string[]): value is AssetPackageV2File[] {
  if (!Array.isArray(value) || value.length > MAX_FILES) {
    problems.push(`files 0..${MAX_FILES} elementdan iborat massiv bo'lishi kerak.`);
    return false;
  }
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const label = `files[${index}]`;
    if (!isRecord(entry)) {
      problems.push(`${label} obyekt emas.`);
      continue;
    }
    const path = normalizeOrProblem(entry.path, problems, `${label}.path`);
    if (!path) {
      continue;
    }
    if (path === ASSET_PACKAGE_V2_METADATA || path === ASSET_PACKAGE_V2_CHECKSUMS) {
      problems.push(`${label}.path o'z-o'zini tavsiflay olmaydi: "${path}".`);
    }
    if (seen.has(path)) {
      problems.push(`Path takrorlangan: "${path}".`);
    }
    seen.add(path);
    const expectedMime = expectedMimeForPath(path);
    if (!expectedMime) {
      problems.push(`${label}.path qo'llab-quvvatlanmaydigan joylashuv: "${path}".`);
    } else if (entry.mimeType !== expectedMime) {
      problems.push(`${label}.mimeType "${path}" uchun "${expectedMime}" bo'lishi kerak.`);
    }
    if (!isPositiveInteger(entry.bytes)) {
      problems.push(`${label}.bytes musbat butun son bo'lishi kerak.`);
    }
    if (!isSha256(entry.sha256)) {
      problems.push(`${label}.sha256 64 ta kichik hex belgidan iborat bo'lishi kerak.`);
    }
  }
  return true;
}

function crossCheck(
  references: ReadonlyArray<{ file: string; bytes: number; sha256: string; label: string }>,
  files: readonly AssetPackageV2File[],
  problems: string[],
): void {
  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const reference of references) {
    const record = byPath.get(reference.file);
    if (!record) {
      problems.push(`${reference.label} "${reference.file}" files ro'yxatida yo'q.`);
      continue;
    }
    if (record.bytes !== reference.bytes) {
      problems.push(`${reference.label} hajmi files ro'yxatidagi hajm bilan mos emas.`);
    }
    if (record.sha256 !== reference.sha256) {
      problems.push(`${reference.label} SHA-256 qiymati files ro'yxati bilan mos emas.`);
    }
  }
}

/**
 * Strict runtime validation for the v2 manifest. It validates the document's own
 * structure and internal consistency; archive-byte verification is done by
 * {@link verifyAssetPackageV2}.
 */
export function validateAssetPackageV2Metadata(value: unknown): AssetPackageV2Validation {
  const problems: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, problems: ['metadata.json obyekt emas.'], metadata: null };
  }
  if (value.format !== ASSET_PACKAGE_FORMAT) {
    problems.push(`format "${ASSET_PACKAGE_FORMAT}" bo'lishi kerak.`);
  }
  if (value.formatVersion !== ASSET_PACKAGE_V2_VERSION) {
    problems.push(`formatVersion ${ASSET_PACKAGE_V2_VERSION} bo'lishi kerak.`);
  }
  if (value.archiveRoot !== undefined) {
    if (
      typeof value.archiveRoot !== 'string' ||
      sanitizeArchiveRoot(value.archiveRoot) !== value.archiveRoot
    ) {
      problems.push('archiveRoot bitta xavfsiz papka nomi bo\'lishi kerak.');
    }
  }
  if (value.generatedAt !== undefined) {
    if (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))) {
      problems.push('generatedAt ISO sana bo\'lishi kerak.');
    }
  }

  validateProduct(value.product, problems);
  validateUnits(value.units, problems);
  validateModels(value.models, problems);
  validateTextures(value.textures, problems);
  validatePreviews(value.previews, problems);
  validateFiles(value.files, problems);

  if (problems.length > 0) {
    return { ok: false, problems, metadata: null };
  }

  const metadata = value as unknown as AssetPackageV2Metadata;
  const seen = new Set<string>();
  const register = (path: string): void => {
    if (seen.has(path)) {
      problems.push(`Path takrorlangan: "${path}".`);
    }
    seen.add(path);
  };
  // `files` intentionally repeats the model/texture/preview paths; duplicates
  // inside `files` are rejected by validateFiles, while duplicate content
  // references across the typed arrays are rejected here.
  for (const model of metadata.models) register(model.file);
  for (const texture of metadata.textures) register(texture.file);
  for (const preview of metadata.previews) register(preview.file);

  crossCheck(
    [
      ...metadata.models.map((model, index) => ({
        file: model.file,
        bytes: model.bytes,
        sha256: model.sha256,
        label: `models[${index}]`,
      })),
      ...metadata.textures.map((texture, index) => ({
        file: texture.file,
        bytes: texture.bytes,
        sha256: texture.sha256,
        label: `textures[${index}]`,
      })),
      ...metadata.previews.map((preview, index) => ({
        file: preview.file,
        bytes: preview.bytes,
        sha256: preview.sha256,
        label: `previews[${index}]`,
      })),
    ],
    metadata.files,
    problems,
  );

  const filePaths = new Set(metadata.files.map((file) => file.path));
  if (!filePaths.has(ASSET_PACKAGE_V2_README)) {
    problems.push(`files ro'yxatida "${ASSET_PACKAGE_V2_README}" yo'q.`);
  }
  const licenseFile = metadata.product.license?.textFile;
  if (licenseFile && !filePaths.has(licenseFile)) {
    problems.push(`Litsenziya matni "${licenseFile}" files ro'yxatida yo'q.`);
  }
  if (!licenseFile && filePaths.has(ASSET_PACKAGE_V2_LICENSE)) {
    problems.push('LICENSE.txt bor, lekin product.license.textFile ko\'rsatilmagan.');
  }

  const expectedPaths = new Set<string>([
    ASSET_PACKAGE_V2_README,
    ...(licenseFile ? [licenseFile] : []),
    ...metadata.models.map((model) => model.file),
    ...metadata.models
      .filter((model) => model.format === 'obj')
      .map((model) => objMtlPath(model.file)),
    ...metadata.textures.map((texture) => texture.file),
    ...metadata.previews.map((preview) => preview.file),
  ]);
  for (const path of expectedPaths) {
    if (!filePaths.has(path)) {
      problems.push(`files ro'yxatida "${path}" yo'q.`);
    }
  }
  for (const file of metadata.files) {
    if (!expectedPaths.has(file.path)) {
      problems.push(`files ro'yxatida kutilmagan path: "${file.path}".`);
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    metadata: problems.length === 0 ? metadata : null,
  };
}

export function validateProductInput(
  product: AssetPackageV2ProductInput,
): string | null {
  if (!product || !isNonEmptyString(product.title, MAX_TITLE_LENGTH)) {
    return `product.title 1..${MAX_TITLE_LENGTH} belgidan iborat bo'lishi kerak.`;
  }
  if (
    product.sku !== undefined &&
    (typeof product.sku !== 'string' || !ASSET_PACKAGE_V2_SKU_PATTERN.test(product.sku))
  ) {
    return 'product.sku faqat harf, raqam, ".", "_" va "-" dan iborat bo\'lishi kerak.';
  }
  if (product.description !== undefined && !isOptionalString(product.description, MAX_DESCRIPTION_LENGTH)) {
    return `product.description ${MAX_DESCRIPTION_LENGTH} belgidan oshmasligi kerak.`;
  }
  if (product.author !== undefined && !isOptionalString(product.author, MAX_AUTHOR_LENGTH)) {
    return `product.author ${MAX_AUTHOR_LENGTH} belgidan oshmasligi kerak.`;
  }
  if (product.license) {
    if (!isNonEmptyString(product.license.name, MAX_LICENSE_NAME_LENGTH)) {
      return 'product.license.name majburiy va bo\'sh bo\'lmasligi kerak.';
    }
    if (
      product.license.spdx !== undefined &&
      (typeof product.license.spdx !== 'string' || !SPDX_PATTERN.test(product.license.spdx))
    ) {
      return "product.license.spdx formati noto'g'ri.";
    }
    if (product.license.text !== undefined) {
      if (
        typeof product.license.text !== 'string' ||
        product.license.text.trim() === '' ||
        product.license.text.length > MAX_LICENSE_TEXT_LENGTH
      ) {
        return `product.license.text 1..${MAX_LICENSE_TEXT_LENGTH} belgidan iborat bo'lishi kerak.`;
      }
    }
  }
  return null;
}

export function validatePreviewInputs(
  previews: readonly AssetPreviewImage[],
  limits: AssetPackageV2Limits = ASSET_PACKAGE_V2_LIMITS,
): string | null {
  const seen = new Set<string>();
  for (const preview of previews) {
    if (!isProductPreviewFilename(preview.name)) {
      return `Noma'lum preview fayli: "${preview.name}".`;
    }
    if (seen.has(preview.name)) {
      return `Preview fayli takrorlangan: "${preview.name}".`;
    }
    seen.add(preview.name);
    if (!isPng(preview.bytes) || !pngSize(preview.bytes)) {
      return `"${preview.name}" haqiqiy PNG emas yoki sarlavhasi o'qilmadi.`;
    }
    if (preview.bytes.byteLength > limits.previewBytes) {
      return `"${preview.name}" hajmi ${preview.bytes.byteLength} bayt; limit ${limits.previewBytes} bayt.`;
    }
  }
  return null;
}
