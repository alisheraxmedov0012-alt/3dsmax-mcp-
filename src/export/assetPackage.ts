/**
 * A4 — the marketplace asset package.
 *
 * The C8 product bundle is a *manufacturing* deliverable: BOM, cut list, PDF,
 * assembly. A 3D asset buyer needs a different archive — the model, real preview
 * shots, and metadata that can be checked against the file — so this is a
 * separate bundle rather than more entries in the shop ZIP.
 *
 * Honesty rules:
 *
 * - Metadata describes the bytes in the archive. Geometry counts, material names
 *   and texture sizes are parsed from the GLB with `summarizeGlb`, not copied from
 *   the scene we hoped to export.
 * - Every entry carries a SHA-256 digest in `checksums.txt`, and the builder
 *   re-opens the archive it just produced. `fflate` verifies each entry's CRC while
 *   inflating, so a corrupt bundle fails here instead of at the buyer.
 * - Nothing is invented: dimensions are measured by the caller, license/seller
 *   fields stay absent unless supplied, and a missing preview is stated rather
 *   than replaced by a placeholder.
 */
import { unzipSync, zipSync } from 'fflate';
import { FURNITURE_TYPE_LABELS, type FurnitureType } from '../geometry/furniture/types';
import { describeUvLayout, type UvLayoutSummary } from '../materials/uv';
import { sceneForObject } from '../scene/sceneSelection';
import type { SceneData, SceneObject } from '../scene/types';
import { sha256Hex } from '../util/sha256';
import { PRODUCT_PREVIEW_FILENAMES, isProductPreviewFilename } from '../viewer/productPreviewViews';
import { nameDigest, slugifyName } from './exportNaming';
import { exportSceneToGlb } from './sceneExport';
import { summarizeGlb, type GlbSummary } from './glbSummary';
import { isPng, pngSize, type PngSize } from './pngSize';
import { buildProductListing, type ProductListingInput, type ProductListingMetadata } from '../manufacturing/productListing';

export const ASSET_PACKAGE_FORMAT = '3d-studio-ai-asset-package';
export const ASSET_PACKAGE_VERSION = 1;

/** Fixed entries; preview images, when present, are inserted before checksums. */
export const ASSET_PACKAGE_ENTRIES = [
  'README.txt',
  'metadata.json',
  'model.glb',
  'checksums.txt',
] as const;

export type AssetPackageEntry = (typeof ASSET_PACKAGE_ENTRIES)[number];

export interface AssetPreviewImage {
  /** One of `PRODUCT_PREVIEW_FILENAMES`; arbitrary names are refused. */
  name: string;
  bytes: Uint8Array;
}

export interface AssetDimensionsMm {
  widthMm: number;
  heightMm: number;
  depthMm: number;
}

export interface AssetFileRecord {
  name: string;
  bytes: number;
  sha256: string;
}

export interface AssetPreviewRecord extends AssetFileRecord {
  size: PngSize | null;
}

export interface AssetMetadata {
  format: typeof ASSET_PACKAGE_FORMAT;
  formatVersion: number;
  generatedAt: string;
  asset: {
    title: string;
    furnitureType: FurnitureType;
    furnitureTypeLabel: string;
    units: { scene: 'cm'; metadata: 'mm' };
    dimensionsMm: AssetDimensionsMm;
    model: {
      file: 'model.glb';
      bytes: number;
      sha256: string;
      glbVersion: number;
      meshes: number;
      primitives: number;
      triangles: number;
      materials: string[];
      textures: number;
      imageSizes: PngSize[];
      externalUris: number;
      generator: string | null;
    };
    uv: UvLayoutSummary;
  };
  previews: AssetPreviewRecord[];
  listing: ProductListingMetadata;
  /** Digests of every entry except `metadata.json` (self) and `checksums.txt`. */
  files: AssetFileRecord[];
}

export interface AssetPackageInput {
  scene: SceneData;
  object: SceneObject;
  projectName: string;
  /**
   * Measured overall size (mm), supplied by the caller. The manufacturing layer
   * already measures it once (`technicalDrawing`); accepting it keeps one
   * measurement instead of two implementations that can disagree.
   */
  overallMm: AssetDimensionsMm;
  previews?: readonly AssetPreviewImage[] | null;
  listing?: ProductListingInput | null;
  /** Export-only map size; omitted keeps the 128 px default. */
  textureSize?: 128 | 512;
  generatedAt?: Date;
}

export interface AssetPackage {
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
  mimeType: 'application/zip';
  entries: Array<{ name: string; bytes: number }>;
  expectedEntries: readonly string[];
  glb: GlbSummary;
  metadata: AssetMetadata;
}

export type AssetPackageOutcome =
  | { ok: true; asset: AssetPackage }
  | { ok: false; reason: string };

export interface AssetVerification {
  ok: boolean;
  problems: string[];
}

const encoder = new TextEncoder();

function digestOf(bytes: Uint8Array): string {
  return sha256Hex(bytes);
}

function record(name: string, bytes: Uint8Array): AssetFileRecord {
  return { name, bytes: bytes.byteLength, sha256: digestOf(bytes) };
}

export function assetPackageFilename(projectName: string): string {
  return `${slugifyName(projectName, 'model')}-${nameDigest(projectName)}-asset.zip`;
}

function entriesWithPreviews(previews: readonly AssetPreviewImage[]): string[] {
  const names = new Set(previews.map((preview) => preview.name));
  const ordered = PRODUCT_PREVIEW_FILENAMES.filter((name) => names.has(name));
  return ['README.txt', 'metadata.json', 'model.glb', ...ordered, 'checksums.txt'];
}

function checksumsText(files: readonly AssetFileRecord[]): string {
  return files.map((file) => `${file.sha256}  ${file.name}`).join('\n') + '\n';
}

function readme(metadata: AssetMetadata): string {
  const { asset } = metadata;
  const sizes = asset.model.imageSizes
    .map((size) => `${size.widthPx}×${size.heightPx}`)
    .filter((value, index, all) => all.indexOf(value) === index);
  return [
    'AI 3D Studio — 3D aktiv paketi',
    '',
    `Format: ${ASSET_PACKAGE_FORMAT} v${ASSET_PACKAGE_VERSION}`,
    `Nomi: ${asset.title}`,
    `Mebel turi: ${asset.furnitureTypeLabel} (${asset.furnitureType})`,
    `Yaratilgan: ${metadata.generatedAt}`,
    '',
    "O'lchamlar (mm, o'lchangan):",
    `  Kenglik: ${asset.dimensionsMm.widthMm}`,
    `  Balandlik: ${asset.dimensionsMm.heightMm}`,
    `  Chuqurlik: ${asset.dimensionsMm.depthMm}`,
    "Sahna ichida birlik: sm. Metadata va o'lchamlar: mm.",
    '',
    'Paket tarkibi:',
    '  model.glb      — glTF 2.0 binary, geometriya va PBR materiallar',
    '  metadata.json  — fayl, geometriya, material, tekstura va UV ma’lumotlari',
    '  checksums.txt  — har bir faylning SHA-256 qiymati',
    metadata.previews.length > 0
      ? `  ${metadata.previews.map((preview) => preview.name).join(', ')} — brauzerdagi 3D ko‘rinish (PNG)`
      : "  Preview rasmlari bu paketga qo'shilmagan.",
    '',
    "3D ma'lumotlari:",
    `  Meshlar: ${asset.model.meshes} · primitivlar: ${asset.model.primitives} · uchburchaklar: ${asset.model.triangles}`,
    `  Materiallar: ${asset.model.materials.join(', ') || "yo'q"}`,
    `  Teksturalar: ${asset.model.textures}${sizes.length > 0 ? ` (${sizes.join(', ')} px)` : ''}`,
    `  UV: ${asset.uv.layout}, kafel ${asset.uv.tileCm} sm; textureScale koeffitsiyenti qo'llanadi.`,
    `  Tashqi URI: ${asset.model.externalUris} (0 — hamma ma'lumot fayl ichida).`,
    '',
    'Cheklovlar:',
    '  Teksturalar protsedural (generativ) bitmap; ORM (occlusion/roughness/metalness) xaritasi yo‘q.',
    "  Preview rasmlari brauzer viewport'idan olingan — fotosurat yoki fotorealistik render emas.",
    `  Litsenziya: ${metadata.listing.license ?? "ko'rsatilmagan"}.`,
    '',
    'Tekshirish:',
    '  checksums.txt dagi SHA-256 qiymatlarini har bir fayl bilan solishtiring.',
    `  model.glb SHA-256: ${asset.model.sha256}`,
    '',
  ].join('\n');
}

function validatePreview(preview: AssetPreviewImage, seen: Set<string>): string | null {
  if (!isProductPreviewFilename(preview.name)) {
    return `Noma'lum preview fayli: "${preview.name}". Ruxsat etilganlar: ${PRODUCT_PREVIEW_FILENAMES.join(', ')}.`;
  }
  if (seen.has(preview.name)) {
    return `Preview fayli takrorlangan: "${preview.name}".`;
  }
  seen.add(preview.name);
  if (!isPng(preview.bytes) || !pngSize(preview.bytes)) {
    return `"${preview.name}" haqiqiy PNG emas yoki sarlavhasi o'qilmadi.`;
  }
  return null;
}

/** Throw away the zip-local copies so the caller only keeps the archive bytes. */
function archiveRead(bytes: Uint8Array<ArrayBuffer>): Record<string, Uint8Array> {
  return unzipSync(bytes);
}

/**
 * Build the archive and verify the bytes just written.
 *
 * The GLB is produced by the same A1 exporter the rest of the app uses; the
 * summary and every digest are computed from the resulting bytes.
 */
export async function buildAssetPackage(input: AssetPackageInput): Promise<AssetPackageOutcome> {
  const { widthMm, heightMm, depthMm } = input.overallMm;
  if (![widthMm, heightMm, depthMm].every((value) => Number.isFinite(value) && value > 0)) {
    return {
      ok: false,
      reason: "O'lchamlar (mm) o'lchanmagan — aktiv paketi yaratilmadi.",
    };
  }

  const previews = input.previews ?? [];
  const seen = new Set<string>();
  for (const preview of previews) {
    const problem = validatePreview(preview, seen);
    if (problem) {
      return { ok: false, reason: problem };
    }
  }

  let glb: ArrayBuffer;
  try {
    glb = await exportSceneToGlb(sceneForObject(input.scene, input.object), {
      includeRoom: false,
      ...(input.textureSize ? { textureSize: input.textureSize } : {}),
    });
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error && error.message
          ? `3D modelni eksport qilib bo'lmadi: ${error.message}`
          : "3D modelni eksport qilib bo'lmadi.",
    };
  }

  const summarized = summarizeGlb(glb);
  if (!summarized.ok) {
    return { ok: false, reason: `GLB tekshiruvdan o'tmadi: ${summarized.reason}` };
  }
  const summary = summarized.summary;

  const glbBytes = new Uint8Array(glb);
  const previewFiles = previews.map((preview) => ({
    name: preview.name,
    bytes: preview.bytes,
    size: pngSize(preview.bytes),
  }));

  const generatedAt = input.generatedAt ?? new Date();
  const expectedEntries = entriesWithPreviews(previews);
  const imageSizes = summary.images
    .map((image) => image.size)
    .filter((size): size is PngSize => size !== null);
  const maxTextureWidth = imageSizes.reduce((max, size) => Math.max(max, size.widthPx), 0);

  const listing = buildProductListing({
    projectName: input.projectName,
    type: input.object.type,
    overallMm: { widthMm, heightMm, depthMm },
    entries: expectedEntries,
    listing: {
      ...input.listing,
      ...(input.listing?.textureResolutionPx === undefined && maxTextureWidth > 0
        ? { textureResolutionPx: maxTextureWidth }
        : {}),
    },
  });

  const fileRecords: AssetFileRecord[] = [
    record('model.glb', glbBytes),
    ...previewFiles.map((preview) => record(preview.name, preview.bytes)),
  ];

  const metadataBase: Omit<AssetMetadata, 'files'> = {
    format: ASSET_PACKAGE_FORMAT,
    formatVersion: ASSET_PACKAGE_VERSION,
    generatedAt: generatedAt.toISOString(),
    asset: {
      title: listing.title,
      furnitureType: input.object.type,
      furnitureTypeLabel: FURNITURE_TYPE_LABELS[input.object.type],
      units: { scene: 'cm', metadata: 'mm' },
      dimensionsMm: { widthMm, heightMm, depthMm },
      model: {
        file: 'model.glb',
        bytes: summary.bytes,
        sha256: digestOf(glbBytes),
        glbVersion: summary.version,
        meshes: summary.meshes,
        primitives: summary.primitives,
        triangles: summary.triangles,
        materials: summary.materials,
        textures: summary.textures,
        imageSizes,
        externalUris: summary.externalUris,
        generator: summary.generator,
      },
      uv: describeUvLayout(),
    },
    previews: previewFiles.map((preview) => ({
      ...record(preview.name, preview.bytes),
      size: preview.size,
    })),
    listing,
  };

  // README contains the metadata it describes, so build metadata first with a
  // placeholder digest set, render the README, then re-render metadata with the
  // README digest included. Both steps are pure string work.
  const metadataDraft: AssetMetadata = { ...metadataBase, files: fileRecords };
  const readmeText = readme(metadataDraft);
  const readmeBytes = encoder.encode(readmeText);
  const readmeRecord = record('README.txt', readmeBytes);
  const filesWithReadme: AssetFileRecord[] = [readmeRecord, ...fileRecords];
  const metadata: AssetMetadata = { ...metadataBase, files: filesWithReadme };

  const metadataBytes = encoder.encode(JSON.stringify(metadata, null, 2));
  const checksummed = [...filesWithReadme, record('metadata.json', metadataBytes)];
  const checksumsBytes = encoder.encode(checksumsText(checksummed));

  const archive: Record<string, Uint8Array> = {
    'README.txt': readmeBytes,
    'metadata.json': metadataBytes,
    'model.glb': glbBytes,
    'checksums.txt': checksumsBytes,
  };
  for (const preview of previews) {
    archive[preview.name] = preview.bytes;
  }

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = zipSync(archive, { level: 6, mtime: generatedAt }) as Uint8Array<ArrayBuffer>;
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error && error.message
          ? `Arxiv yaratilmadi: ${error.message}`
          : 'Arxiv yaratilmadi.',
    };
  }

  const asset: AssetPackage = {
    bytes,
    filename: assetPackageFilename(input.projectName),
    mimeType: 'application/zip',
    entries: expectedEntries.map((name) => ({
      name,
      bytes: archive[name].byteLength,
    })),
    expectedEntries,
    glb: summary,
    metadata,
  };

  const verification = verifyAssetPackage(asset);
  if (!verification.ok) {
    return { ok: false, reason: `Paket tekshiruvdan o'tmadi: ${verification.problems[0]}` };
  }
  return { ok: true, asset };
}

/**
 * Re-open the archive and check entry list, byte lengths and every digest.
 *
 * This is what turns "the builder returned" into evidence: a truncated zip, a
 * dropped preview or a digest mismatch is reported here.
 */
export function verifyAssetPackage(asset: AssetPackage): AssetVerification {
  const problems: string[] = [];
  let files: Record<string, Uint8Array>;
  try {
    files = archiveRead(asset.bytes);
  } catch (error) {
    return {
      ok: false,
      problems: [
        error instanceof Error ? `Arxiv ochilmadi: ${error.message}` : 'Arxiv ochilmadi.',
      ],
    };
  }

  const names = Object.keys(files).sort();
  const expected = [...asset.expectedEntries].sort();
  if (names.join('|') !== expected.join('|')) {
    problems.push(`Arxiv tarkibi kutilgandan farq qiladi: ${names.join(', ')}.`);
  }

  for (const entry of asset.entries) {
    const actual = files[entry.name];
    if (!actual) {
      problems.push(`"${entry.name}" arxivda yo'q.`);
      continue;
    }
    if (actual.byteLength !== entry.bytes) {
      problems.push(`"${entry.name}" hajmi mos emas.`);
    }
  }

  const metadataBytes = files['metadata.json'];
  if (!metadataBytes) {
    problems.push('metadata.json arxivda yo‘q.');
    return { ok: problems.length === 0, problems };
  }

  let metadata: AssetMetadata | null = null;
  try {
    metadata = JSON.parse(new TextDecoder().decode(metadataBytes)) as AssetMetadata;
  } catch {
    problems.push('metadata.json o‘qilmadi.');
  }

  if (metadata) {
    for (const file of metadata.files) {
      const actual = files[file.name];
      if (!actual) {
        problems.push(`"${file.name}" metadata ro'yxatida bor, arxivda yo'q.`);
        continue;
      }
      if (digestOf(actual) !== file.sha256) {
        problems.push(`"${file.name}" SHA-256 mos emas.`);
      }
    }
    const glb = files['model.glb'];
    if (glb && digestOf(glb) !== metadata.asset.model.sha256) {
      problems.push('model.glb SHA-256 metadata bilan mos emas.');
    }
  }

  const checksums = files['checksums.txt'];
  if (!checksums) {
    problems.push('checksums.txt arxivda yo‘q.');
  } else {
    const lines = new TextDecoder()
      .decode(checksums)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    for (const line of lines) {
      const [digest, name] = line.split(/\s+/u);
      const actual = files[name];
      if (!actual) {
        problems.push(`checksums.txt "${name}" ni sanaydi, fayl yo'q.`);
        continue;
      }
      if (digestOf(actual) !== digest) {
        problems.push(`checksums.txt "${name}" uchun SHA-256 mos emas.`);
      }
    }
  }

  return { ok: problems.length === 0, problems };
}
