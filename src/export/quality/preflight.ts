import type { SceneData } from '../../scene/types';
import type { ExportFormatId } from '../exportFormats';
import { buildExportScene, type BuildExportOptions } from '../sceneExport';
import { collectQualityMetrics } from './metrics';
import type {
  QualityCheck,
  QualityCategory,
  QualityLimits,
  QualityMetrics,
  QualityPreflightResult,
  QualityProfile,
  QualityStatus,
  QualitySummary,
} from './types';

interface CheckInput {
  id: string;
  label: string;
  category: QualityCategory;
  status: QualityStatus;
  actual: number | string | null;
  limit: number | string | null;
  message: string;
  remediation: string;
}

export interface PreflightOptions {
  format: ExportFormatId;
  /** Exact produced size, when called after the artifact exists. */
  actualFileBytes?: number;
  /** Exact image payload parsed from the exported GLB/glTF. */
  actualTexturePayloadBytes?: number;
}

function check(input: CheckInput): QualityCheck {
  return input;
}

function budgetStatus(exceeded: boolean, profile: QualityProfile): QualityStatus {
  return exceeded ? profile.budgetSeverity : 'PASS';
}

function structuralStatus(
  failed: boolean,
  profile: QualityProfile,
  allow: boolean,
): QualityStatus {
  if (!failed) return 'PASS';
  return allow ? profile.budgetSeverity : 'BLOCK';
}

function summaryOf(checks: readonly QualityCheck[]): QualitySummary {
  return {
    pass: checks.filter((entry) => entry.status === 'PASS').length,
    warning: checks.filter((entry) => entry.status === 'WARNING').length,
    block: checks.filter((entry) => entry.status === 'BLOCK').length,
    total: checks.length,
  };
}

function overallStatus(summary: QualitySummary): QualityStatus {
  if (summary.block > 0) return 'BLOCK';
  if (summary.warning > 0) return 'WARNING';
  return 'PASS';
}

function overallMessage(status: QualityStatus, summary: QualitySummary): string {
  if (status === 'BLOCK') {
    return `Eksport bloklandi: ${summary.block} ta majburiy sifat muammosi bor.`;
  }
  if (status === 'WARNING') {
    return `Eksport mumkin, lekin ${summary.warning} ta sifat ogohlantirishi bor.`;
  }
  return "Barcha sifat tekshiruvlari o'tdi.";
}

function fileLimitFor(format: ExportFormatId, limits: QualityLimits): number {
  return format === 'glb' ? limits.fileSize.maxGlbBytes : limits.fileSize.maxGltfPackageBytes;
}

function formatLimitLabel(format: ExportFormatId): string {
  return format === 'glb' ? 'GLB hajmi' : `${format.toUpperCase()} paket hajmi`;
}

/**
 * Evaluate a measured scene against a profile. This function is pure: it never
 * touches the scene or the profile.
 */
export function evaluateQualityPreflight(
  metrics: QualityMetrics,
  profile: QualityProfile,
  options: PreflightOptions,
): QualityPreflightResult {
  const { limits } = profile;
  const { format } = options;
  const fileLimit = fileLimitFor(format, limits);
  const fileActual = options.actualFileBytes ?? metrics.estimatedFileBytes;
  const fileIsEstimated = options.actualFileBytes === undefined;
  const texturePayload = options.actualTexturePayloadBytes ?? metrics.texturePayloadBytes;
  const textureIsEstimated = options.actualTexturePayloadBytes === undefined;
  const estimated = fileIsEstimated || textureIsEstimated;
  const checks: QualityCheck[] = [];

  checks.push(
    check({
      id: 'geometry.triangles',
      label: 'Uchburchaklar soni',
      category: 'geometry',
      status: budgetStatus(metrics.triangles > limits.geometry.maxTriangles, profile),
      actual: metrics.triangles,
      limit: limits.geometry.maxTriangles,
      message:
        metrics.triangles > limits.geometry.maxTriangles
          ? `Uchburchaklar limitdan oshdi: ${metrics.triangles} > ${limits.geometry.maxTriangles}.`
          : `Uchburchaklar limit ichida: ${metrics.triangles}.`,
      remediation: "Detallarni soddalashtiring yoki kattaroq limitli profil tanlang.",
    }),
    check({
      id: 'geometry.vertices',
      label: 'Vertexlar soni',
      category: 'geometry',
      status: budgetStatus(metrics.vertices > limits.geometry.maxVertices, profile),
      actual: metrics.vertices,
      limit: limits.geometry.maxVertices,
      message:
        metrics.vertices > limits.geometry.maxVertices
          ? `Vertexlar limitdan oshdi: ${metrics.vertices} > ${limits.geometry.maxVertices}.`
          : `Vertexlar limit ichida: ${metrics.vertices}.`,
      remediation: "Geometriyani yengillashtiring yoki kattaroq limitli profil tanlang.",
    }),
    check({
      id: 'geometry.meshes',
      label: 'Mesh obyektlari',
      category: 'geometry',
      status: budgetStatus(metrics.meshes > limits.geometry.maxMeshes, profile),
      actual: metrics.meshes,
      limit: limits.geometry.maxMeshes,
      message:
        metrics.meshes > limits.geometry.maxMeshes
          ? `Mesh soni limitdan oshdi: ${metrics.meshes} > ${limits.geometry.maxMeshes}.`
          : `Mesh soni limit ichida: ${metrics.meshes}.`,
      remediation: "Detallarni birlashtiring yoki kattaroq limitli profil tanlang.",
    }),
    check({
      id: 'geometry.objects',
      label: 'Sahna obyektlari',
      category: 'geometry',
      status: budgetStatus(metrics.objects > limits.geometry.maxObjects, profile),
      actual: metrics.objects,
      limit: limits.geometry.maxObjects,
      message:
        metrics.objects > limits.geometry.maxObjects
          ? `Obyektlar soni limitdan oshdi: ${metrics.objects} > ${limits.geometry.maxObjects}.`
          : `Obyektlar soni limit ichida: ${metrics.objects}.`,
      remediation: "Ortiqcha obyektlarni olib tashlang yoki kattaroq profil tanlang.",
    }),
    check({
      id: 'geometry.degenerate',
      label: 'Degenerativ uchburchaklar',
      category: 'geometry',
      status: metrics.degenerateTriangles > limits.geometry.maxDegenerateTriangles ? 'BLOCK' : 'PASS',
      actual: metrics.degenerateTriangles,
      limit: limits.geometry.maxDegenerateTriangles,
      message:
        metrics.degenerateTriangles > limits.geometry.maxDegenerateTriangles
          ? `${metrics.degenerateTriangles} degenerativ uchburchak topildi.`
          : "Degenerativ uchburchak yo'q.",
      remediation: "Nol maydonli yoki takroriy uchburchaklarni olib tashlang.",
    }),
    check({
      id: 'geometry.invalid',
      label: "Noto'g'ri geometriya",
      category: 'geometry',
      status: metrics.invalidGeometries > limits.geometry.maxInvalidGeometries ? 'BLOCK' : 'PASS',
      actual: metrics.invalidGeometries,
      limit: limits.geometry.maxInvalidGeometries,
      message:
        metrics.invalidGeometries > limits.geometry.maxInvalidGeometries
          ? `${metrics.invalidGeometries} geometriya strukturaviy xatoga ega.`
          : "Geometriya strukturaviy xatosiz.",
      remediation: "Index, atribut va uchburchak sonini tekshiring.",
    }),
    check({
      id: 'geometry.non_finite',
      label: 'Cheksiz koordinatalar',
      category: 'geometry',
      status: metrics.nonFiniteVertices > 0 ? 'BLOCK' : 'PASS',
      actual: metrics.nonFiniteVertices,
      limit: 0,
      message:
        metrics.nonFiniteVertices > 0
          ? `${metrics.nonFiniteVertices} vertex NaN yoki Infinity qiymatiga ega.`
          : "Barcha vertex koordinatalari chekli.",
      remediation: "NaN/Infinity koordinatalarni tuzating; eksport ular bilan xavfli.",
    }),
  );

  checks.push(
    check({
      id: 'file.size',
      label: formatLimitLabel(format),
      category: 'fileSize',
      status:
        fileIsEstimated && fileActual > fileLimit
          ? 'WARNING'
          : budgetStatus(fileActual > fileLimit, profile),
      actual: fileActual,
      limit: fileLimit,
      message:
        fileActual > fileLimit
          ? `${formatLimitLabel(format)} limitdan oshdi: ${fileActual} > ${fileLimit} bayt.`
          : `${formatLimitLabel(format)} limit ichida: ${fileActual} bayt${
              fileIsEstimated ? " (taxminiy)" : ''
            }.`,
      remediation: "Tekstura yoki geometriyani yengillashtiring, yoki kattaroq profil tanlang.",
    }),
    check({
      id: 'file.texture_payload',
      label: 'Tekstura payload hajmi',
      category: 'fileSize',
      status:
        textureIsEstimated && texturePayload > limits.fileSize.maxTexturePayloadBytes
          ? 'WARNING'
          : budgetStatus(texturePayload > limits.fileSize.maxTexturePayloadBytes, profile),
      actual: texturePayload,
      limit: limits.fileSize.maxTexturePayloadBytes,
      message:
        texturePayload > limits.fileSize.maxTexturePayloadBytes
          ? `Tekstura payload limitdan oshdi: ${texturePayload} > ${limits.fileSize.maxTexturePayloadBytes} bayt.`
          : `Tekstura payload limit ichida: ${texturePayload} bayt${
              textureIsEstimated ? " (taxminiy)" : ''
            }.`,
      remediation: "Katta teksturalarni kichraytiring yoki kattaroq profil tanlang.",
    }),
  );

  const textures = metrics.textures;
  const maxWidth = metrics.maxTextureWidth;
  const maxHeight = metrics.maxTextureHeight;
  const maxIndividual = textures.reduce(
    (max, texture) => Math.max(max, texture.estimatedBytes),
    0,
  );
  const formats = [...new Set(textures.map((texture) => texture.format))];
  const unsupportedFormats = formats.filter((formatName) => !limits.textures.allowedFormats.includes(formatName));

  checks.push(
    check({
      id: 'textures.width',
      label: 'Tekstura kengligi',
      category: 'textures',
      status: budgetStatus(maxWidth > limits.textures.maxWidth, profile),
      actual: maxWidth,
      limit: limits.textures.maxWidth,
      message:
        maxWidth > limits.textures.maxWidth
          ? `Eng katta tekstura kengligi ${maxWidth}px, limit ${limits.textures.maxWidth}px.`
          : `Tekstura kengligi limit ichida: ${maxWidth}px.`,
      remediation: "Teksturani kichraytiring yoki kattaroq profil tanlang.",
    }),
    check({
      id: 'textures.height',
      label: 'Tekstura balandligi',
      category: 'textures',
      status: budgetStatus(maxHeight > limits.textures.maxHeight, profile),
      actual: maxHeight,
      limit: limits.textures.maxHeight,
      message:
        maxHeight > limits.textures.maxHeight
          ? `Eng katta tekstura balandligi ${maxHeight}px, limit ${limits.textures.maxHeight}px.`
          : `Tekstura balandligi limit ichida: ${maxHeight}px.`,
      remediation: "Teksturani kichraytiring yoki kattaroq profil tanlang.",
    }),
    check({
      id: 'textures.total_pixels',
      label: 'Umumiy tekstura piksellari',
      category: 'textures',
      status: budgetStatus(metrics.texturePixels > limits.textures.maxTotalPixels, profile),
      actual: metrics.texturePixels,
      limit: limits.textures.maxTotalPixels,
      message:
        metrics.texturePixels > limits.textures.maxTotalPixels
          ? `Tekstura piksellari limitdan oshdi: ${metrics.texturePixels} > ${limits.textures.maxTotalPixels}.`
          : `Tekstura piksellari limit ichida: ${metrics.texturePixels}.`,
      remediation: "Ortiqcha yoki katta teksturalarni kamaytiring.",
    }),
    check({
      id: 'textures.individual_bytes',
      label: "Bitta tekstura hajmi",
      category: 'textures',
      status: budgetStatus(maxIndividual > limits.textures.maxIndividualBytes, profile),
      actual: maxIndividual,
      limit: limits.textures.maxIndividualBytes,
      message:
        maxIndividual > limits.textures.maxIndividualBytes
          ? `Bitta tekstura hajmi limitdan oshdi: ${maxIndividual} > ${limits.textures.maxIndividualBytes} bayt.`
          : `Bitta tekstura hajmi limit ichida: ${maxIndividual} bayt.`,
      remediation: "Eng katta teksturani kichraytiring yoki siqilgan formatdan foydalaning.",
    }),
    check({
      id: 'textures.formats',
      label: 'Tekstura formatlari',
      category: 'textures',
      status:
        unsupportedFormats.length > 0
          ? structuralStatus(true, profile, false)
          : 'PASS',
      actual: formats.join(', ') || 'yo‘q',
      limit: limits.textures.allowedFormats.join(', '),
      message:
        unsupportedFormats.length > 0
          ? `Qo‘llab-quvvatlanmaydigan formatlar: ${unsupportedFormats.join(', ')}.`
          : `Tekstura formatlari qo‘llab-quvvatlanadi: ${formats.join(', ') || 'yo‘q'}.`,
      remediation: "PNG, JPEG yoki WebP formatidan foydalaning.",
    }),
    check({
      id: 'textures.missing_images',
      label: 'Yetishmayotgan tekstura rasmlari',
      category: 'textures',
      status:
        metrics.invalidTextureReferences > 0
          ? structuralStatus(true, profile, limits.textures.allowMissingImages)
          : 'PASS',
      actual: metrics.invalidTextureReferences,
      limit: 0,
      message:
        metrics.invalidTextureReferences > 0
          ? `${metrics.invalidTextureReferences} teksturada o‘lchamsiz yoki yetishmayotgan rasm bor.`
          : "Barcha tekstura rasmlari mavjud.",
      remediation: "Tekstura faylini qayta yuklang yoki materialdan olib tashlang.",
    }),
  );

  checks.push(
    check({
      id: 'uv.missing',
      label: 'Teksturali materiallar uchun UV',
      category: 'uv',
      status:
        metrics.uvMissingForTextured > 0 && limits.uv.requireForTexturedMaterials
          ? 'BLOCK'
          : 'PASS',
      actual: metrics.uvMissingForTextured,
      limit: 0,
      message:
        metrics.uvMissingForTextured > 0
          ? `${metrics.uvMissingForTextured} teksturali geometriyada UV yo‘q.`
          : "Teksturali geometriyalarda UV mavjud.",
      remediation: "UV yaratish yoki teksturasiz materialdan foydalanish.",
    }),
    check({
      id: 'uv.non_finite',
      label: 'Cheksiz UV qiymatlari',
      category: 'uv',
      status:
        metrics.uvNonFinite > 0 && !limits.uv.allowNonFinite ? 'BLOCK' : 'PASS',
      actual: metrics.uvNonFinite,
      limit: 0,
      message:
        metrics.uvNonFinite > 0
          ? `${metrics.uvNonFinite} UV qiymati NaN yoki Infinity.`
          : "UV qiymatlari chekli.",
      remediation: "UV atributidagi NaN/Infinity qiymatlarini tuzating.",
    }),
    check({
      id: 'uv.count',
      label: 'UV atribut soni',
      category: 'uv',
      status:
        metrics.uvCountMismatch > 0 && !limits.uv.allowCountMismatch ? 'BLOCK' : 'PASS',
      actual: metrics.uvCountMismatch,
      limit: 0,
      message:
        metrics.uvCountMismatch > 0
          ? `${metrics.uvCountMismatch} geometriyada UV va vertex soni mos emas.`
          : "UV va vertex soni mos.",
      remediation: "UV atributini qayta yarating yoki noto‘g‘ri geometriyani tuzating.",
    }),
    check({
      id: 'uv.range',
      label: 'UV qiymatlar diapazoni',
      category: 'uv',
      status: budgetStatus(metrics.uvMaxAbs > limits.uv.maxAbs, profile),
      actual: metrics.uvMaxAbs,
      limit: limits.uv.maxAbs,
      message:
        metrics.uvMaxAbs > limits.uv.maxAbs
          ? `UV absolut qiymati limitdan oshdi: ${metrics.uvMaxAbs} > ${limits.uv.maxAbs}.`
          : `UV absolut qiymati limit ichida: ${metrics.uvMaxAbs}.`,
      remediation: "UV masshtabini kamaytiring yoki kattaroq profil tanlang.",
    }),
  );

  checks.push(
    check({
      id: 'normals.missing',
      label: 'Normal atributlari',
      category: 'normalsTangents',
      status:
        metrics.missingNormals > 0 && limits.normalsTangents.requireNormals
          ? 'BLOCK'
          : 'PASS',
      actual: metrics.missingNormals,
      limit: 0,
      message:
        metrics.missingNormals > 0
          ? `${metrics.missingNormals} geometriyada normal yo‘q.`
          : "Barcha geometriyalarda normal mavjud.",
      remediation: "Normal atributini yarating yoki geometriyani qayta quring.",
    }),
    check({
      id: 'normals.non_finite',
      label: 'Cheksiz normal qiymatlari',
      category: 'normalsTangents',
      status: metrics.nonFiniteNormals > 0 ? 'BLOCK' : 'PASS',
      actual: metrics.nonFiniteNormals,
      limit: 0,
      message:
        metrics.nonFiniteNormals > 0
          ? `${metrics.nonFiniteNormals} normal NaN yoki Infinity.`
          : "Normal qiymatlari chekli.",
      remediation: "Normal atributidagi NaN/Infinity qiymatlarini tuzating.",
    }),
    check({
      id: 'normals.length',
      label: 'Normal uzunligi',
      category: 'normalsTangents',
      status: budgetStatus(
        metrics.invalidNormalLengths > limits.normalsTangents.maxInvalidNormals,
        profile,
      ),
      actual: metrics.invalidNormalLengths,
      limit: limits.normalsTangents.maxInvalidNormals,
      message:
        metrics.invalidNormalLengths > limits.normalsTangents.maxInvalidNormals
          ? `${metrics.invalidNormalLengths} normal unit uzunlikda emas yoki nolga teng.`
          : "Normal uzunliklari tolerantlik ichida.",
      remediation: "Normallarni normalizatsiya qiling.",
    }),
    check({
      id: 'tangents.missing',
      label: 'Normal map uchun tangentlar',
      category: 'normalsTangents',
      status:
        metrics.missingTangents > 0 && limits.normalsTangents.requireTangentsForNormalMap
          ? 'BLOCK'
          : metrics.missingTangents > 0
            ? 'WARNING'
            : 'PASS',
      actual: metrics.missingTangents,
      limit: 0,
      message:
        metrics.missingTangents > 0
          ? `${metrics.missingTangents} normal-mapped geometriya uchun tangent yaratib bo‘lmaydi.`
          : metrics.normalMappedMeshes > 0
            ? "Tangentlar mavjud yoki eksportda avtomatik yaratiladi."
            : "Normal map ishlatilmaydi; tangent talab qilinmaydi.",
      remediation: "Geometriyani indexed qiling va position/normal/UV atributlarini ta’minlang.",
    }),
    check({
      id: 'tangents.invalid',
      label: 'Tangent qiymatlari',
      category: 'normalsTangents',
      status:
        metrics.invalidTangents > 0 && !limits.normalsTangents.allowInvalidTangents
          ? 'BLOCK'
          : 'PASS',
      actual: metrics.invalidTangents,
      limit: 0,
      message:
        metrics.invalidTangents > 0
          ? `${metrics.invalidTangents} geometriyada noto‘g‘ri tangent atributi bor.`
          : "Mavjud tangentlar to‘g‘ri yoki hali yaratilmagan.",
      remediation: "Tangentlarni qayta yarating yoki noto‘g‘ri atributni olib tashlang.",
    }),
  );

  checks.push(
    check({
      id: 'materials.missing',
      label: 'Material havolalari',
      category: 'materials',
      status:
        metrics.missingMaterialReferences > 0 && limits.materials.requireMaterialReferences
          ? 'BLOCK'
          : 'PASS',
      actual: metrics.missingMaterialReferences,
      limit: 0,
      message:
        metrics.missingMaterialReferences > 0
          ? `${metrics.missingMaterialReferences} meshda material havolasi yo‘q.`
          : "Barcha meshlarda material mavjud.",
      remediation: "Material biriktiring yoki meshni olib tashlang.",
    }),
    check({
      id: 'materials.unsupported',
      label: 'Material turlari',
      category: 'materials',
      status:
        metrics.unsupportedMaterials > 0 && !limits.materials.allowUnsupportedTypes
          ? 'BLOCK'
          : 'PASS',
      actual: metrics.unsupportedMaterials,
      limit: limits.materials.allowUnsupportedTypes ? 1 : 0,
      message:
        metrics.unsupportedMaterials > 0
          ? `${metrics.unsupportedMaterials} material turi GLB eksporti uchun qo‘llab-quvvatlanmaydi.`
          : "Material turlari qo‘llab-quvvatlanadi.",
      remediation: "MeshStandardMaterial yoki MeshBasicMaterial ishlatilsin.",
    }),
  );

  const summary = summaryOf(checks);
  const status = overallStatus(summary);

  return {
    profile: {
      id: profile.id,
      label: profile.label,
      budgetSeverity: profile.budgetSeverity,
    },
    limits,
    format,
    checks,
    status,
    summary,
    metrics,
    message: overallMessage(status, summary),
    estimated,
  };
}

export interface PreflightExportOptions extends BuildExportOptions {
  profile: QualityProfile;
  format: ExportFormatId;
}

/**
 * Build the same export scene the file exporters will build, measure it, and
 * dispose it. Used by the UI "Tekshirish" action. The export functions repeat
 * the check on the scene they actually write, so a stale preview can never
 * bypass a block.
 */
export function preflightExportScene(
  data: SceneData,
  options: PreflightExportOptions,
): QualityPreflightResult {
  const { profile, format, ...buildOptions } = options;
  const { scene, dispose } = buildExportScene(data, buildOptions);
  try {
    return evaluateQualityPreflight(collectQualityMetrics(scene), profile, { format });
  } finally {
    dispose();
  }
}
