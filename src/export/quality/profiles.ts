import type {
  BudgetSeverity,
  QualityLimits,
  QualityLimitsOverride,
  QualityProfile,
  QualityProfileId,
} from './types';

const MiB = 1024 * 1024;
const MP = 1_000_000;

export const QUALITY_PROFILE_ORDER: readonly QualityProfileId[] = [
  'draft',
  'standard',
  'high',
  'custom',
];

export const DEFAULT_QUALITY_PROFILE_ID: QualityProfileId = 'standard';

/**
 * Draft is deliberately generous: it blocks only structural breakage and reports
 * budget overruns as warnings. Standard is the safe default for normal work.
 * High Quality treats budget overruns as blocking because the point of the
 * profile is to keep the deliverable small and predictable.
 */
export const QUALITY_PROFILES: Readonly<
  Record<Exclude<QualityProfileId, 'custom'>, QualityProfile>
> = {
  draft: {
    id: 'draft',
    label: 'Qoralama',
    description: "Katta prototiplar uchun keng limitlar; budjet oshsa ogohlantiradi.",
    budgetSeverity: 'WARNING',
    limits: {
      geometry: {
        maxTriangles: 1_000_000,
        maxVertices: 2_000_000,
        maxMeshes: 2_000,
        maxObjects: 500,
        maxDegenerateTriangles: 0,
        maxInvalidGeometries: 0,
      },
      fileSize: {
        maxGlbBytes: 128 * MiB,
        maxGltfPackageBytes: 256 * MiB,
        maxTexturePayloadBytes: 128 * MiB,
      },
      textures: {
        maxWidth: 8192,
        maxHeight: 8192,
        maxTotalPixels: 64 * MP,
        maxIndividualBytes: 16 * MiB,
        allowedFormats: ['png', 'jpeg', 'webp'],
        allowMissingImages: false,
      },
      uv: {
        requireForTexturedMaterials: true,
        maxAbs: 10_000,
        allowNonFinite: false,
        allowCountMismatch: false,
      },
      normalsTangents: {
        requireNormals: true,
        maxInvalidNormals: 0,
        normalTolerance: 1e-3,
        requireTangentsForNormalMap: true,
        allowInvalidTangents: false,
      },
      materials: {
        requireMaterialReferences: true,
        allowUnsupportedTypes: false,
        allowMissingTextures: false,
      },
    },
  },
  standard: {
    id: 'standard',
    label: 'Standart',
    description: "Odatiy loyihalar uchun muvozanatli limitlar; budjet oshsa ogohlantiradi.",
    budgetSeverity: 'WARNING',
    limits: {
      geometry: {
        maxTriangles: 250_000,
        maxVertices: 500_000,
        maxMeshes: 500,
        maxObjects: 100,
        maxDegenerateTriangles: 0,
        maxInvalidGeometries: 0,
      },
      fileSize: {
        maxGlbBytes: 32 * MiB,
        maxGltfPackageBytes: 64 * MiB,
        maxTexturePayloadBytes: 32 * MiB,
      },
      textures: {
        maxWidth: 4096,
        maxHeight: 4096,
        maxTotalPixels: 32 * MP,
        maxIndividualBytes: 8 * MiB,
        allowedFormats: ['png', 'jpeg', 'webp'],
        allowMissingImages: false,
      },
      uv: {
        requireForTexturedMaterials: true,
        maxAbs: 1_000,
        allowNonFinite: false,
        allowCountMismatch: false,
      },
      normalsTangents: {
        requireNormals: true,
        maxInvalidNormals: 0,
        normalTolerance: 1e-3,
        requireTangentsForNormalMap: true,
        allowInvalidTangents: false,
      },
      materials: {
        requireMaterialReferences: true,
        allowUnsupportedTypes: false,
        allowMissingTextures: false,
      },
    },
  },
  high: {
    id: 'high',
    label: 'Yuqori sifat',
    description: "Yengil va toza yetkazib berish uchun qattiq limitlar; budjet oshsa bloklaydi.",
    budgetSeverity: 'BLOCK',
    limits: {
      geometry: {
        maxTriangles: 100_000,
        maxVertices: 200_000,
        maxMeshes: 250,
        maxObjects: 50,
        maxDegenerateTriangles: 0,
        maxInvalidGeometries: 0,
      },
      fileSize: {
        maxGlbBytes: 16 * MiB,
        maxGltfPackageBytes: 32 * MiB,
        maxTexturePayloadBytes: 16 * MiB,
      },
      textures: {
        maxWidth: 4096,
        maxHeight: 4096,
        maxTotalPixels: 16 * MP,
        maxIndividualBytes: 8 * MiB,
        allowedFormats: ['png', 'jpeg', 'webp'],
        allowMissingImages: false,
      },
      uv: {
        requireForTexturedMaterials: true,
        maxAbs: 100,
        allowNonFinite: false,
        allowCountMismatch: false,
      },
      normalsTangents: {
        requireNormals: true,
        maxInvalidNormals: 0,
        normalTolerance: 1e-3,
        requireTangentsForNormalMap: true,
        allowInvalidTangents: false,
      },
      materials: {
        requireMaterialReferences: true,
        allowUnsupportedTypes: false,
        allowMissingTextures: false,
      },
    },
  },
};

function cloneLimits(limits: QualityLimits): QualityLimits {
  return {
    geometry: { ...limits.geometry },
    fileSize: { ...limits.fileSize },
    textures: { ...limits.textures, allowedFormats: [...limits.textures.allowedFormats] },
    uv: { ...limits.uv },
    normalsTangents: { ...limits.normalsTangents },
    materials: { ...limits.materials },
  };
}

function mergeLimits(base: QualityLimits, overrides: QualityLimitsOverride): QualityLimits {
  const merged = cloneLimits(base);
  if (overrides.geometry) Object.assign(merged.geometry, overrides.geometry);
  if (overrides.fileSize) Object.assign(merged.fileSize, overrides.fileSize);
  if (overrides.textures) {
    Object.assign(merged.textures, overrides.textures);
    merged.textures.allowedFormats = [
      ...(overrides.textures.allowedFormats ?? merged.textures.allowedFormats),
    ];
  }
  if (overrides.uv) Object.assign(merged.uv, overrides.uv);
  if (overrides.normalsTangents) Object.assign(merged.normalsTangents, overrides.normalsTangents);
  if (overrides.materials) Object.assign(merged.materials, overrides.materials);
  return merged;
}

/** Build a runtime-editable profile without changing source code. */
export function createCustomProfile(
  overrides: QualityLimitsOverride = {},
  budgetSeverity: BudgetSeverity = 'WARNING',
  base: QualityProfile = QUALITY_PROFILES.standard,
): QualityProfile {
  return {
    id: 'custom',
    label: 'Maxsus',
    description: "Foydalanuvchi belgilagan limitlar; qiymatlarni UI’da o‘zgartirish mumkin.",
    budgetSeverity,
    limits: mergeLimits(base.limits, overrides),
  };
}

export function resolveQualityProfile(
  id: QualityProfileId,
  customProfile?: QualityProfile | null,
): QualityProfile {
  if (id === 'custom') {
    return customProfile?.id === 'custom' ? customProfile : createCustomProfile();
  }
  return QUALITY_PROFILES[id] ?? QUALITY_PROFILES.standard;
}
