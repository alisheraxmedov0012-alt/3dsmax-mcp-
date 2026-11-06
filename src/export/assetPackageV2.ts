/**
 * Phase 6.1-A — asset package v2 builder and verifier.
 *
 * v1 (`assetPackage.ts`) remains the working GLB marketplace package. This module
 * adds the versioned, multi-model manifest that Phase 6.1-B will fill with more
 * formats. It does not reinterpret or rewrite v1 archives: the two versions have
 * separate builders and verifiers.
 *
 * Integrity rules:
 * - every path is normalized and rejected when absolute/traversing/duplicated;
 * - every record's size and SHA-256 are re-computed from the archive bytes;
 * - `metadata.json` is itself covered by `checksums.txt`;
 * - a model's stats are re-read from its actual format bytes (GLB, OBJ/MTL, STL, 3MF).
 */
import { unzipSync, zipSync } from 'fflate';
import { sha256Hex } from '../util/sha256';
import { PRODUCT_PREVIEW_FILENAMES } from '../viewer/productPreviewViews';
import type { TextureProvider } from '../materials/textureRegistry';
import { nameDigest, slugifyName } from './exportNaming';
import { summarizeGlb } from './glbSummary';
import { isPng, pngSize } from './pngSize';
import {
  ASSET_PACKAGE_FORMAT,
  type AssetPreviewImage,
  type AssetVerification,
} from './assetPackage';
import {
  ASSET_PACKAGE_V2_CHECKSUMS,
  ASSET_PACKAGE_V2_LICENSE,
  ASSET_PACKAGE_V2_METADATA,
  ASSET_PACKAGE_V2_MODEL_FORMATS,
  ASSET_PACKAGE_V2_PREVIEW_PREFIX,
  ASSET_PACKAGE_V2_README,
  ASSET_PACKAGE_V2_VERSION,
  ASSET_PACKAGE_V2_LIMITS,
  archivePath,
  expectedMimeForPath,
  isSha256,
  limitForPath,
  normalizeAssetPath,
  objMtlPath,
  sanitizeArchiveRoot,
  validateArchivePlan,
  validateAssetPackageV2Metadata,
  validatePreviewInputs,
  validateProductInput,
  type AssetPackageV2,
  type AssetPackageV2File,
  type AssetPackageV2Input,
  type AssetPackageV2License,
  type AssetPackageV2Limits,
  type AssetPackageV2Metadata,
  type AssetPackageV2Model,
  type AssetPackageV2ModelFormat,
  type AssetPackageV2ModelStats,
  type AssetPackageV2Outcome,
  type AssetPackageV2Preview,
  type AssetPackageV2Product,
  type AssetPackageV2Texture,
} from './assetPackageV2Schema';
import {
  glbStats,
  compareModelStats,
  inspectObjBytes,
  inspectStlBytes,
  inspectThreeMfBytes,
  objMtlTextureRefs,
} from './modelFormatStats';
import { buildV2Models } from './assetPackageV2Models';
import type { TexturePngEncoder } from './texturePng';

export * from './assetPackageV2Schema';

const encoder = new TextEncoder();

function recordFile(path: string, bytes: Uint8Array): AssetPackageV2File {
  const mimeType = expectedMimeForPath(path);
  if (!mimeType) {
    throw new Error(`Qo'llab-quvvatlanmaydigan path: "${path}".`);
  }
  return { path, bytes: bytes.byteLength, sha256: sha256Hex(bytes), mimeType };
}

function readme(metadata: AssetPackageV2Metadata): string {
  const { product, units, models, textures, previews } = metadata;
  const lines = [
    'AI 3D Studio — 3D aktiv paketi (v2)',
    '',
    `Format: ${metadata.format} v${metadata.formatVersion}`,
    `Nomi: ${product.title}`,
  ];
  if (product.sku) lines.push(`SKU: ${product.sku}`);
  if (product.author) lines.push(`Muallif: ${product.author}`);
  if (product.description) lines.push(`Tavsif: ${product.description}`);
  if (product.license) {
    const license = product.license;
    lines.push(
      `Litsenziya: ${license.name}` +
        (license.spdx ? ` (${license.spdx})` : '') +
        (license.textFile ? ` — ${license.textFile}` : ''),
    );
    lines.push(`  Attribution: ${yesNoUnknown(license.attributionRequired, 'talab qilinadi', 'talab qilinmaydi')}`);
    lines.push(
      `  Tijoriy foydalanish: ${yesNoUnknown(license.commercialUseAllowed, 'ruxsat etilgan', 'ruxsat etilmagan')}`,
    );
    if (license.terms) {
      lines.push(`  Shartlar: ${license.terms}`);
    }
    if (license.attributionRequired === undefined || license.commercialUseAllowed === undefined) {
      lines.push(
        "  Diqqat: ko'rsatilmagan shartlar Tasdiqlanmagan hisoblanadi — sotuvchi bilan aniqlashtiring.",
      );
    }
  } else {
    // The explicit fallback: an unlicensed package grants nothing by default.
    lines.push(
      "Litsenziya: ko'rsatilmagan — ushbu paketdagi aktivlar uchun foydalanish huquqi berilmagan.",
      "  Tijoriy foydalanish, qayta tarqatish va attribution talabi Tasdiqlanmagan.",
      '  Ishlatishdan oldin sotuvchi bilan yozma kelishuv talab qilinadi.',
    );
  }
  lines.push(
    '',
    "Birliklar:",
    `  Uzunlik: ${units.length}`,
    `  Koordinatalar: ${units.coordinates ?? "ko'rsatilmagan"}`,
    '',
    'Modellar:',
  );
  for (const model of models) {
    lines.push(
      `  ${model.file} — ${model.format}, unit ${model.unit ?? '—'}, ${model.bytes} bayt, SHA-256 ${model.sha256}`,
      `    Meshlar: ${model.stats.meshes ?? '—'} · uchburchaklar: ${model.stats.triangles ?? '—'} · materiallar: ${
        model.stats.materials?.join(', ') || '—'
      }`,
    );
    if (model.stats.boundsMm) {
      lines.push(
        `    Bounds (mm): min [${model.stats.boundsMm.min.join(', ')}], ` +
          `max [${model.stats.boundsMm.max.join(', ')}]`,
      );
    }
  }
  lines.push(
    '',
    'Boshqa fayllar:',
    '  README.txt — ushbu tavsif.',
    '  metadata.json — mashina o‘qiydigan manifest.',
    '  checksums.txt — har bir faylning SHA-256 qiymati.',
    ...(product.license?.textFile
      ? [`  ${product.license.textFile} — litsenziya matni.`]
      : []),
  );
  lines.push('', 'Teksturalar:');
  if (textures.length === 0) {
    lines.push('  Alohida tekstura fayllari yo‘q (GLB embed yoki materialda map yo‘q).');
  } else {
    for (const texture of textures) {
      lines.push(`  ${texture.file} — ${texture.role}, ${texture.mimeType}, ${texture.bytes} bayt`);
    }
  }
  lines.push('', 'Preview rasmlari:');
  if (previews.length === 0) {
    lines.push("  Preview rasmlari bu paketga qo'shilmagan.");
  } else {
    for (const preview of previews) {
      lines.push(
        `  ${preview.file} — ${preview.width}×${preview.height} px, ${preview.bytes} bayt`,
      );
    }
  }
  lines.push(
    '',
    'Format cheklovlari:',
    '  GLB — metr; PBR materiallar va teksturalar fayl ichida embed.',
    "  OBJ/MTL — millimetr; baseColor va normal map sidecar. Roughness, metalness, AO va emissive faqat GLB'da.",
    "  STL — millimetr, faqat geometriya; units metadata yo'q.",
    "  3MF — millimetr, faqat geometriya; watertight/manifold kafolatlanmagan.",
    '',
    'Tavsiya:',
    '  GLB — web/real-time va PBR materiallar uchun.',
    '  OBJ+MTL — DCC (Blender/3ds Max) tahriri uchun.',
    '  STL/3MF — slicer yoki print preview uchun; printability tekshirilmagan.',
    '',
    'Tekshirish:',
    '  checksums.txt dagi SHA-256 qiymatlarini har bir fayl bilan solishtiring.',
    '  metadata.json o‘zi ham checksums.txt ichida.',
    '',
  );
  return lines.join('\n');
}

/**
 * Renders a tri-state licensing flag.
 *
 * `undefined` is deliberately not "no": a licensor who never answered is not the
 * same as one who refused, and the README must not silently read one as the other.
 */
function yesNoUnknown(value: boolean | undefined, yes: string, no: string): string {
  if (value === true) return yes;
  if (value === false) return no;
  return "ko'rsatilmagan";
}

function checksumsText(records: readonly AssetPackageV2File[]): string {
  return [...records]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((record) => `${record.sha256}  ${record.path}`)
    .join('\n') + '\n';
}

export function assetPackageV2Filename(projectName: string): string {
  return `${slugifyName(projectName, 'model')}-${nameDigest(projectName)}-asset-v2.zip`;
}

function buildAssets(
  input: AssetPackageV2Input,
  models: readonly AssetPackageV2Model[],
  modelFiles: Record<string, Uint8Array>,
  textures: readonly AssetPackageV2Texture[],
  previews: readonly AssetPreviewImage[],
  generatedAt: Date,
  limits: AssetPackageV2Limits,
  archiveRoot: string,
): { metadata: AssetPackageV2Metadata; archive: Record<string, Uint8Array> } {
  const previewRecords: AssetPackageV2Preview[] = previews
    .slice()
    .sort(
      (a, b) =>
        PRODUCT_PREVIEW_FILENAMES.indexOf(a.name) - PRODUCT_PREVIEW_FILENAMES.indexOf(b.name),
    )
    .map((preview) => {
      const size = pngSize(preview.bytes);
      if (!size) {
        throw new Error(`"${preview.name}" o'lchami o'qilmadi.`);
      }
      return {
        file: `${ASSET_PACKAGE_V2_PREVIEW_PREFIX}${preview.name}`,
        width: size.widthPx,
        height: size.heightPx,
        sha256: sha256Hex(preview.bytes),
        bytes: preview.bytes.byteLength,
      };
    });

  const licenseText = input.product.license?.text;
  const licensePath = licenseText !== undefined ? ASSET_PACKAGE_V2_LICENSE : null;
  const licenseInput = input.product.license;
  const productLicense: AssetPackageV2License | undefined = licenseInput
    ? {
        name: licenseInput.name.trim(),
        ...(licenseInput.spdx ? { spdx: licenseInput.spdx } : {}),
        ...(licensePath ? { textFile: licensePath } : {}),
        ...(licenseInput.attributionRequired === undefined
          ? {}
          : { attributionRequired: licenseInput.attributionRequired }),
        ...(licenseInput.commercialUseAllowed === undefined
          ? {}
          : { commercialUseAllowed: licenseInput.commercialUseAllowed }),
        ...(licenseInput.terms?.trim() ? { terms: licenseInput.terms.trim() } : {}),
      }
    : undefined;

  const product: AssetPackageV2Product = {
    title: input.product.title.trim(),
    ...(input.product.sku?.trim() ? { sku: input.product.sku.trim() } : {}),
    ...(input.product.description?.trim()
      ? { description: input.product.description.trim() }
      : {}),
    ...(input.product.author?.trim() ? { author: input.product.author.trim() } : {}),
    ...(productLicense ? { license: productLicense } : {}),
  };

  const licenseBytes = licenseText !== undefined ? encoder.encode(licenseText) : null;
  const previewBytes = previews.map((preview) => ({
    path: `${ASSET_PACKAGE_V2_PREVIEW_PREFIX}${preview.name}`,
    bytes: preview.bytes,
  }));
  const previewBytesByPath = new Map(previewBytes.map((entry) => [entry.path, entry.bytes]));

  // README is written before the manifest it describes; its own digest is then
  // included in `files`, so no self-reference is needed.
  const metadataWithoutFiles: Omit<AssetPackageV2Metadata, 'files'> = {
    format: ASSET_PACKAGE_FORMAT,
    formatVersion: ASSET_PACKAGE_V2_VERSION,
    ...(archiveRoot ? { archiveRoot } : {}),
    generatedAt: generatedAt.toISOString(),
    product,
    units: { length: 'mm', coordinates: 'Y_UP_RIGHT_HANDED' },
    models: [...models],
    textures: [...textures],
    previews: previewRecords,
  };
  const readmeBytes = encoder.encode(readme({ ...metadataWithoutFiles, files: [] }));

  const files: AssetPackageV2File[] = [
    recordFile(ASSET_PACKAGE_V2_README, readmeBytes),
    ...(licenseBytes && licensePath ? [recordFile(licensePath, licenseBytes)] : []),
    ...Object.entries(modelFiles).map(([path, bytes]) => recordFile(path, bytes)),
    ...previewRecords.map((preview) => {
      const bytes = previewBytesByPath.get(preview.file);
      if (!bytes) {
        throw new Error(`Preview bytes topilmadi: "${preview.file}".`);
      }
      return recordFile(preview.file, bytes);
    }),
  ];

  const metadata: AssetPackageV2Metadata = {
    ...metadataWithoutFiles,
    files,
  };
  const metadataBytes = encoder.encode(JSON.stringify(metadata, null, 2));
  const checksumRecords = [...files, recordFile(ASSET_PACKAGE_V2_METADATA, metadataBytes)];
  const checksumsBytes = encoder.encode(checksumsText(checksumRecords));

  const relativeArchive: Record<string, Uint8Array> = {
    [ASSET_PACKAGE_V2_README]: readmeBytes,
    ...(licenseBytes && licensePath ? { [licensePath]: licenseBytes } : {}),
    [ASSET_PACKAGE_V2_METADATA]: metadataBytes,
    ...modelFiles,
  };
  for (const preview of previewBytes) {
    relativeArchive[preview.path] = preview.bytes;
  }
  relativeArchive[ASSET_PACKAGE_V2_CHECKSUMS] = checksumsBytes;

  const planProblem = validateArchivePlan(
    Object.entries(relativeArchive).map(([path, bytes]) => ({
      path,
      bytes: bytes.byteLength,
    })),
    limits,
  );
  if (planProblem) {
    throw new Error(`Paket hajmi limitidan oshdi: ${planProblem}`);
  }

  const archive: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(relativeArchive)) {
    archive[archivePath(archiveRoot, path)] = bytes;
  }

  return { metadata, archive };
}

/**
 * Build a v2 package. Only GLB is produced in Phase 6.1-A; the `models` array is
 * ready for additional formats in a later phase.
 */
export interface AssetPackageV2BuildOptions {
  /** Defaults to ['glb'] so the existing v2 API stays GLB-only. */
  formats?: readonly AssetPackageV2ModelFormat[];
  /** Optional enclosing folder, e.g. `OAK-001`; defaults to no folder. */
  archiveRoot?: string;
  textureSize?: 128 | 512;
  textureProvider?: TextureProvider;
  textureEncoder?: TexturePngEncoder;
  onProgress?: (progress: { format?: AssetPackageV2ModelFormat }) => void;
}

function selectFormats(
  requested: readonly AssetPackageV2ModelFormat[],
): { ok: true; formats: AssetPackageV2ModelFormat[] } | { ok: false; reason: string } {
  if (requested.length === 0) {
    return { ok: false, reason: "Kamida bitta model formati tanlanishi kerak." };
  }
  const seen = new Set<string>();
  for (const format of requested) {
    if (!(ASSET_PACKAGE_V2_MODEL_FORMATS as readonly string[]).includes(format)) {
      return { ok: false, reason: `Qo'llab-quvvatlanmaydigan model formati: "${String(format)}".` };
    }
    if (seen.has(format)) {
      return { ok: false, reason: `Model formati takrorlangan: "${format}".` };
    }
    seen.add(format);
  }
  return {
    ok: true,
    formats: ASSET_PACKAGE_V2_MODEL_FORMATS.filter((format) => seen.has(format)),
  };
}

/**
 * Build a v2 package. The default is still GLB-only for backward compatibility;
 * pass `options.formats` or use {@link buildAssetPackageV2MultiFormat} for all
 * four formats.
 */
export async function buildAssetPackageV2(
  input: AssetPackageV2Input,
  limits: AssetPackageV2Limits = ASSET_PACKAGE_V2_LIMITS,
  options: AssetPackageV2BuildOptions = {},
): Promise<AssetPackageV2Outcome> {
  const productProblem = validateProductInput(input.product);
  if (productProblem) {
    return { ok: false, reason: productProblem };
  }
  const previews = input.previews ?? [];
  const previewProblem = validatePreviewInputs(previews, limits);
  if (previewProblem) {
    return { ok: false, reason: previewProblem };
  }
  const formats = selectFormats(options.formats ?? ['glb']);
  if (!formats.ok) {
    return { ok: false, reason: formats.reason };
  }
  let archiveRoot = '';
  if (options.archiveRoot !== undefined) {
    const safeRoot = sanitizeArchiveRoot(options.archiveRoot);
    if (!safeRoot) {
      return { ok: false, reason: "archiveRoot xavfsiz papka nomi bo'lishi kerak." };
    }
    archiveRoot = safeRoot;
  }

  let bundle: Awaited<ReturnType<typeof buildV2Models>>;
  try {
    bundle = await buildV2Models(input, {
      formats: formats.formats,
      ...(options.textureSize ? { textureSize: options.textureSize } : {}),
      ...(options.textureProvider ? { textureProvider: options.textureProvider } : {}),
      ...(options.textureEncoder ? { textureEncoder: options.textureEncoder } : {}),
      ...(options.onProgress
        ? { onProgress: (format) => options.onProgress?.({ format }) }
        : {}),
    });
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error && error.message
          ? `Model eksporti amalga oshmadi: ${error.message}`
          : 'Model eksporti amalga oshmadi.',
    };
  }

  const generatedAt = input.generatedAt ?? new Date();
  options.onProgress?.({});
  let built: { metadata: AssetPackageV2Metadata; archive: Record<string, Uint8Array> };
  try {
    built = buildAssets(
      input,
      bundle.models,
      bundle.modelFiles,
      bundle.textures,
      previews,
      generatedAt,
      limits,
      archiveRoot,
    );
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Paket metadata yigilmadi.',
    };
  }

  const validation = validateAssetPackageV2Metadata(built.metadata);
  if (!validation.ok) {
    return {
      ok: false,
      reason: `Paket metadata tekshiruvdan o'tmadi: ${validation.problems[0]}`,
    };
  }

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = zipSync(built.archive, { level: 6, mtime: generatedAt }) as Uint8Array<ArrayBuffer>;
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error && error.message
          ? `Arxiv yaratilmadi: ${error.message}`
          : 'Arxiv yaratilmadi.',
    };
  }
  if (bytes.byteLength === 0) {
    return { ok: false, reason: 'Arxiv bo‘sh.' };
  }
  if (bytes.byteLength > limits.archiveBytes) {
    return {
      ok: false,
      reason: `Arxiv hajmi ${bytes.byteLength} bayt; limit ${limits.archiveBytes} bayt.`,
    };
  }

  const asset: AssetPackageV2 = {
    bytes,
    filename: assetPackageV2Filename(input.projectName),
    mimeType: 'application/zip',
    metadata: built.metadata,
    entries: Object.keys(built.archive).map((path) => ({
      path,
      bytes: built.archive[path].byteLength,
    })),
  };

  const verification = verifyAssetPackageV2({ bytes }, limits);
  if (!verification.ok) {
    return {
      ok: false,
      reason: `Paket tekshiruvdan o'tmadi: ${verification.problems[0]}`,
    };
  }
  return { ok: true, asset };
}

/** Explicit multi-format entry point: GLB + OBJ/MTL + STL + 3MF. */
export async function buildAssetPackageV2MultiFormat(
  input: AssetPackageV2Input,
  limits: AssetPackageV2Limits = ASSET_PACKAGE_V2_LIMITS,
  options: Omit<AssetPackageV2BuildOptions, 'formats'> = {},
): Promise<AssetPackageV2Outcome> {
  return buildAssetPackageV2(input, limits, {
    ...options,
    formats: ASSET_PACKAGE_V2_MODEL_FORMATS,
  });
}

interface ScannedArchiveEntry {
  path: string;
  originalBytes: number;
}

class ArchiveLimitError extends Error {}

interface ScannedArchive {
  entries: Map<string, ScannedArchiveEntry>;
}

function scanArchive(
  bytes: Uint8Array,
  limits: AssetPackageV2Limits,
): { ok: true; scan: ScannedArchive } | { ok: false; problem: string } {
  if (bytes.byteLength === 0) {
    return { ok: false, problem: 'Arxiv bo‘sh.' };
  }
  if (bytes.byteLength < 22) {
    return { ok: false, problem: 'Arxiv juda kichik yoki malformed.' };
  }
  if (bytes.byteLength > limits.archiveBytes) {
    return {
      ok: false,
      problem: `Arxiv hajmi ${bytes.byteLength} bayt; limit ${limits.archiveBytes} bayt.`,
    };
  }

  let count = 0;
  let totalOriginalBytes = 0;
  const entries = new Map<string, ScannedArchiveEntry>();

  try {
    // The filter receives central-directory metadata and returns false, so
    // unzipSync parses names/sizes without allocating decompressed entry data.
    unzipSync(bytes, {
      filter: (info) => {
        count += 1;
        if (count > limits.entries) {
          throw new ArchiveLimitError(
            `Arxivda ${count} ta entry bor; maksimum ${limits.entries}.`,
          );
        }
        const normalized = normalizeAssetPath(info.name);
        if (!normalized.ok) {
          throw new ArchiveLimitError(`Arxivdagi path xavfli: ${normalized.problem}`);
        }
        if (normalized.path !== info.name) {
          throw new ArchiveLimitError(`Arxivdagi path normallashtirilmagan: "${info.name}".`);
        }
        if (entries.has(normalized.path)) {
          throw new ArchiveLimitError(`Arxivdagi path takrorlangan: "${normalized.path}".`);
        }
        if (!Number.isInteger(info.originalSize) || info.originalSize < 0) {
          throw new ArchiveLimitError(
            `"${info.name}" uchun originalSize noto'g'ri.`,
          );
        }
        if (
          !Number.isInteger(info.size) ||
          info.size < 0 ||
          info.size > bytes.byteLength
        ) {
          throw new ArchiveLimitError(`"${info.name}" uchun compressed size noto'g'ri.`);
        }
        if (info.compression !== 0 && info.compression !== 8) {
          throw new ArchiveLimitError(
            `"${info.name}" compression turi qo'llab-quvvatlanmaydi (${info.compression}).`,
          );
        }
        const entryLimit = limitForPath(normalized.path, limits);
        if (info.originalSize > entryLimit) {
          throw new ArchiveLimitError(
            `"${info.name}" ochilgan hajmi ${info.originalSize} bayt; limit ${entryLimit} bayt.`,
          );
        }
        totalOriginalBytes += info.originalSize;
        if (totalOriginalBytes > limits.totalDecompressedBytes) {
          throw new ArchiveLimitError(
            `Arxivning ochilgan hajmi ${totalOriginalBytes} bayt; ` +
              `limit ${limits.totalDecompressedBytes} bayt.`,
          );
        }
        entries.set(normalized.path, {
          path: normalized.path,
          originalBytes: info.originalSize,
        });
        return false;
      },
    });
  } catch (error) {
    if (error instanceof ArchiveLimitError) {
      return { ok: false, problem: error.message };
    }
    return {
      ok: false,
      problem:
        error instanceof Error ? `Arxiv ochilmadi: ${error.message}` : 'Arxiv ochilmadi.',
    };
  }

  if (entries.size === 0) {
    return { ok: false, problem: 'Arxiv bo‘sh yoki entry yo‘q.' };
  }
  return { ok: true, scan: { entries } };
}

/** Reuse the archive-backed buffer when it already covers the whole range. */
function glbArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
  ) {
    return bytes.buffer;
  }
  return new Uint8Array(bytes).buffer;
}

/**
 * Re-open a v2 archive and verify it from the bytes, not from the metadata it
 * carries. Limits are enforced from the central directory before any entry is
 * inflated; only after that preflight is the payload decompressed.
 *
 * Version-specific: a v1 archive is rejected because it has neither `models/`
 * nor a v2 `metadata.json`.
 */
export function verifyAssetPackageV2(
  asset: { bytes: Uint8Array },
  limits: AssetPackageV2Limits = ASSET_PACKAGE_V2_LIMITS,
): AssetVerification {
  const problems: string[] = [];
  const scanned = scanArchive(asset.bytes, limits);
  if (!scanned.ok) {
    return { ok: false, problems: [scanned.problem] };
  }
  const { entries: scannedEntries } = scanned.scan;

  const metadataCandidates = [...scannedEntries.keys()].filter(
    (path) =>
      path === ASSET_PACKAGE_V2_METADATA ||
      /^[^/]+\/metadata\.json$/u.test(path),
  );
  if (metadataCandidates.length !== 1) {
    return {
      ok: false,
      problems: [
        metadataCandidates.length === 0
          ? "metadata.json arxivda yo'q (v2 paket emas)."
          : "Arxivda bir nechta metadata.json topildi.",
      ],
    };
  }
  const metadataPath = metadataCandidates[0];
  const metadataEntry = scannedEntries.get(metadataPath);
  if (!metadataEntry) {
    return { ok: false, problems: ["metadata.json arxivda yo'q (v2 paket emas)."] };
  }
  const archiveRoot =
    metadataPath === ASSET_PACKAGE_V2_METADATA
      ? ''
      : metadataPath.slice(0, metadataPath.length - ASSET_PACKAGE_V2_METADATA.length - 1);

  // Only metadata is inflated in this pass; its size was already capped by scan.
  let metadataFiles: Record<string, Uint8Array>;
  try {
    metadataFiles = unzipSync(asset.bytes, {
      filter: (info) => info.name === metadataPath,
    });
  } catch (error) {
    return {
      ok: false,
      problems: [
        error instanceof Error
          ? `metadata.json ochilmadi: ${error.message}`
          : 'metadata.json ochilmadi.',
      ],
    };
  }
  const metadataBytes = metadataFiles[metadataPath];
  if (!metadataBytes) {
    return { ok: false, problems: ["metadata.json arxivda yo'q."] };
  }
  if (metadataBytes.byteLength > limits.metadataBytes) {
    return {
      ok: false,
      problems: [
        `metadata.json hajmi ${metadataBytes.byteLength} bayt; ` +
          `limit ${limits.metadataBytes} bayt.`,
      ],
    };
  }
  if (metadataBytes.byteLength !== metadataEntry.originalBytes) {
    return {
      ok: false,
      problems: ["metadata.json hajmi central directory bilan mos emas."],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(metadataBytes));
  } catch {
    return { ok: false, problems: ['metadata.json o‘qilmadi.'] };
  }
  const validation = validateAssetPackageV2Metadata(parsed);
  if (!validation.ok || !validation.metadata) {
    return { ok: false, problems: validation.problems };
  }
  const metadata = validation.metadata;
  if ((metadata.archiveRoot ?? '') !== archiveRoot) {
    return {
      ok: false,
      problems: [
        `metadata.archiveRoot "${metadata.archiveRoot ?? ''}" arxiv papkasi "${archiveRoot}" bilan mos emas.`,
      ],
    };
  }

  const expectedPaths = new Set<string>([
    ...metadata.files.map((file) => archivePath(archiveRoot, file.path)),
    metadataPath,
    archivePath(archiveRoot, ASSET_PACKAGE_V2_CHECKSUMS),
  ]);
  for (const path of expectedPaths) {
    if (!scannedEntries.has(path)) {
      problems.push(`"${path}" arxivda yo'q.`);
    }
  }
  for (const path of scannedEntries.keys()) {
    if (!expectedPaths.has(path)) {
      problems.push(`Arxivda kutilmagan fayl: "${path}".`);
    }
  }
  if (problems.length > 0) {
    return { ok: false, problems };
  }

  // Preflight passed: only now inflate the declared payload.
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(asset.bytes, {
      filter: (info) => scannedEntries.has(info.name),
    });
  } catch (error) {
    return {
      ok: false,
      problems: [
        error instanceof Error ? `Arxiv ochilmadi: ${error.message}` : 'Arxiv ochilmadi.',
      ],
    };
  }

  let actualTotalBytes = 0;
  for (const [path, entry] of scannedEntries) {
    const actual = files[path];
    if (!actual) {
      problems.push(`"${path}" arxivda yo'q.`);
      continue;
    }
    if (actual.byteLength !== entry.originalBytes) {
      problems.push(`"${path}" hajmi central directory bilan mos emas.`);
    }
    const entryLimit = limitForPath(path, limits);
    if (actual.byteLength > entryLimit) {
      problems.push(`"${path}" hajmi ${actual.byteLength} bayt; limit ${entryLimit} bayt.`);
    }
    actualTotalBytes += actual.byteLength;
  }
  if (actualTotalBytes > limits.totalDecompressedBytes) {
    problems.push(
      `Arxivning ochilgan hajmi ${actualTotalBytes} bayt; ` +
        `limit ${limits.totalDecompressedBytes} bayt.`,
    );
  }

  for (const record of metadata.files) {
    const actual = files[archivePath(archiveRoot, record.path)];
    if (!actual) {
      problems.push(`"${record.path}" metadata ro'yxatida bor, arxivda yo'q.`);
      continue;
    }
    if (actual.byteLength !== record.bytes) {
      problems.push(`"${record.path}" hajmi metadata bilan mos emas.`);
    }
    if (sha256Hex(actual) !== record.sha256) {
      problems.push(`"${record.path}" SHA-256 metadata bilan mos emas.`);
    }
  }

  for (const model of metadata.models) {
    const actual = files[archivePath(archiveRoot, model.file)];
    if (!actual) {
      continue;
    }
    let stats: AssetPackageV2ModelStats | null = null;
    try {
      if (model.format === 'glb') {
        const summarized = summarizeGlb(glbArrayBuffer(actual));
        if (!summarized.ok) {
          problems.push(`"${model.file}" GLB sifatida o‘qilmadi: ${summarized.reason}`);
          continue;
        }
        stats = glbStats(summarized.summary);
      } else if (model.format === 'obj') {
        const mtl = files[archivePath(archiveRoot, objMtlPath(model.file))];
        if (!mtl) {
          problems.push(`"${model.file}" uchun MTL fayli yo‘q.`);
          continue;
        }
        const refs = objMtlTextureRefs(mtl);
        for (const ref of refs) {
          if (!files[archivePath(archiveRoot, ref)]) {
            problems.push(`MTL "${ref}" teksturasini talab qiladi, fayl yo‘q.`);
          }
          if (!metadata.textures.some((texture) => texture.file === ref)) {
            problems.push(`MTL "${ref}" metadata.textures ro‘yxatida yo‘q.`);
          }
        }
        stats = inspectObjBytes(actual, mtl);
      } else if (model.format === 'stl') {
        stats = inspectStlBytes(actual);
      } else if (model.format === '3mf') {
        stats = inspectThreeMfBytes(actual);
      } else {
        problems.push(`"${model.file}" formati qo‘llab-quvvatlanmaydi.`);
        continue;
      }
    } catch (error) {
      problems.push(
        `"${model.file}" tekshirilmadi: ` +
          (error instanceof Error ? error.message : "noma'lum xato"),
      );
      continue;
    }
    if (!stats) {
      continue;
    }
    const expectedUnit = model.format === 'glb' ? 'm' : 'mm';
    if (model.unit !== undefined && model.unit !== expectedUnit) {
      problems.push(`"${model.file}" unit "${expectedUnit}" bo'lishi kerak.`);
    }
    problems.push(...compareModelStats(model.stats, stats, model.file));
  }

  for (const texture of metadata.textures) {
    const actual = files[archivePath(archiveRoot, texture.file)];
    if (!actual) continue;
    if (!isPng(actual)) {
      problems.push(`"${texture.file}" haqiqiy PNG emas.`);
    }
    if (actual.byteLength !== texture.bytes || sha256Hex(actual) !== texture.sha256) {
      problems.push(`"${texture.file}" texture yozuvi bilan mos emas.`);
    }
  }

  for (const preview of metadata.previews) {
    const actual = files[archivePath(archiveRoot, preview.file)];
    if (!actual) continue;
    const size = pngSize(actual);
    if (!size) {
      problems.push(`"${preview.file}" haqiqiy PNG emas.`);
      continue;
    }
    if (size.widthPx !== preview.width || size.heightPx !== preview.height) {
      problems.push(`"${preview.file}" o'lchami metadata bilan mos emas.`);
    }
    if (actual.byteLength !== preview.bytes || sha256Hex(actual) !== preview.sha256) {
      problems.push(`"${preview.file}" preview yozuvi bilan mos emas.`);
    }
  }

  const checksumPath = archivePath(archiveRoot, ASSET_PACKAGE_V2_CHECKSUMS);
  const checksums = files[checksumPath];
  if (!checksums) {
    problems.push('checksums.txt arxivda yo‘q.');
  } else {
    const lines = new TextDecoder()
      .decode(checksums)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    const checksumPaths = new Set<string>();
    for (const line of lines) {
      const parts = line.split(/\s+/u);
      if (parts.length !== 2 || !isSha256(parts[0])) {
        problems.push(`checksums.txt noto'g'ri qator: "${line}".`);
        continue;
      }
      const [digest, name] = parts;
      const normalized = normalizeAssetPath(name);
      if (!normalized.ok) {
        problems.push(`checksums.txt path xavfli: ${normalized.problem}`);
        continue;
      }
      if (normalized.path !== name) {
        problems.push(`checksums.txt path normallashtirilmagan: "${name}".`);
      }
      const actualPath = archivePath(archiveRoot, normalized.path);
      if (checksumPaths.has(actualPath)) {
        problems.push(`checksums.txt path takrorlangan: "${normalized.path}".`);
        continue;
      }
      checksumPaths.add(actualPath);
      const actual = files[actualPath];
      if (!actual) {
        problems.push(`checksums.txt "${normalized.path}" ni sanaydi, fayl yo'q.`);
        continue;
      }
      if (sha256Hex(actual) !== digest) {
        problems.push(`checksums.txt "${normalized.path}" uchun SHA-256 mos emas.`);
      }
    }
    const expectedChecksummed = new Set(
      Object.keys(files).filter((path) => path !== checksumPath),
    );
    for (const path of expectedChecksummed) {
      if (!checksumPaths.has(path)) {
        problems.push(`checksums.txt "${path}" ni qamramagan.`);
      }
    }
    for (const path of checksumPaths) {
      if (!files[path]) {
        problems.push(`checksums.txt ortiqcha path sanaydi: "${path}".`);
      }
    }
  }

  return { ok: problems.length === 0, problems };
}
