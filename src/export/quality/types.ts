import type { ExportFormatId } from '../exportFormats';

export type QualityProfileId = 'draft' | 'standard' | 'high' | 'custom';
export type QualityStatus = 'PASS' | 'WARNING' | 'BLOCK';
export type BudgetSeverity = 'WARNING' | 'BLOCK';
export type QualityCategory =
  | 'geometry'
  | 'fileSize'
  | 'textures'
  | 'uv'
  | 'normalsTangents'
  | 'materials';

export interface GeometryLimits {
  maxTriangles: number;
  maxVertices: number;
  maxMeshes: number;
  maxObjects: number;
  maxDegenerateTriangles: number;
  maxInvalidGeometries: number;
}

export interface FileSizeLimits {
  maxGlbBytes: number;
  maxGltfPackageBytes: number;
  maxTexturePayloadBytes: number;
}

export interface TextureLimits {
  maxWidth: number;
  maxHeight: number;
  maxTotalPixels: number;
  maxIndividualBytes: number;
  allowedFormats: readonly string[];
  allowMissingImages: boolean;
}

export interface UvLimits {
  requireForTexturedMaterials: boolean;
  maxAbs: number;
  allowNonFinite: boolean;
  allowCountMismatch: boolean;
}

export interface NormalTangentLimits {
  requireNormals: boolean;
  maxInvalidNormals: number;
  normalTolerance: number;
  requireTangentsForNormalMap: boolean;
  allowInvalidTangents: boolean;
}

export interface MaterialLimits {
  requireMaterialReferences: boolean;
  allowUnsupportedTypes: boolean;
  allowMissingTextures: boolean;
}

export interface QualityLimits {
  geometry: GeometryLimits;
  fileSize: FileSizeLimits;
  textures: TextureLimits;
  uv: UvLimits;
  normalsTangents: NormalTangentLimits;
  materials: MaterialLimits;
}

export type QualityLimitsOverride = {
  [K in keyof QualityLimits]?: Partial<QualityLimits[K]>;
};

export interface QualityProfile {
  id: QualityProfileId;
  label: string;
  description: string;
  limits: QualityLimits;
  /** Status used when a numeric budget is exceeded. Structural errors still block. */
  budgetSeverity: BudgetSeverity;
}

export type MeasurementCertainty = 'exact' | 'approximate' | 'not_verified';

export interface TextureMetric {
  id: string;
  name: string;
  width: number;
  height: number;
  estimatedBytes: number;
  payloadSource: 'exact' | 'estimated' | 'unavailable';
  format: string;
  missingImage: boolean;
}

export interface UvDensityMetric {
  min: number;
  max: number;
  average: number;
  certainty: MeasurementCertainty;
  unit: 'texels/cm';
}

export interface UvDiagnostic {
  geometryId: string;
  meshNames: string[];
  uvTriangles: number;
  degenerateTriangles: number;
  minU: number | null;
  maxU: number | null;
  minV: number | null;
  maxV: number | null;
  overlapCandidates: number;
  overlapStatus: MeasurementCertainty;
  overlapCapped: boolean;
  texelDensity: UvDensityMetric | null;
  notes: string[];
}

export interface QualityMetrics {
  /** Unique BufferGeometry metrics: storage/buffer complexity. */
  uniqueGeometries: number;
  uniqueGeometryTriangles: number;
  uniqueGeometryVertices: number;

  /** Exported scene-instance metrics: rendering/scene complexity. */
  meshNodes: number;
  sceneTriangles: number;
  sceneVertices: number;
  objectGroups: number;
  sceneNodes: number;
  instancedMeshNodes: number;
  instancedInstances: number;

  degenerateTriangles: number;
  invalidGeometries: number;
  nonFiniteVertices: number;

  textures: TextureMetric[];
  texturePayloadBytes: number;
  texturePayloadCertainty: MeasurementCertainty;
  texturePixels: number;
  maxTextureWidth: number;
  maxTextureHeight: number;

  materialCount: number;
  missingMaterialReferences: number;
  invalidTextureReferences: number;
  unsupportedMaterials: number;
  invalidBaseColors: number;
  invalidPbrMaterials: number;
  invalidAlphaMaterials: number;

  uvMissingForTextured: number;
  normalMappedWithoutUv: number;
  uvNonFinite: number;
  uvCountMismatch: number;
  uvMaxAbs: number;
  uvDegenerateTriangles: number;
  uvOverlapCandidates: number;
  uvOverlapStatus: MeasurementCertainty;
  uvTexelDensity: UvDensityMetric | null;
  uvDiagnostics: UvDiagnostic[];

  missingNormals: number;
  nonFiniteNormals: number;
  invalidNormalLengths: number;

  normalMappedMeshNodes: number;
  missingTangents: number;
  invalidTangents: number;

  estimatedFileBytes: number;
}

export interface QualityCheck {
  id: string;
  label: string;
  category: QualityCategory;
  status: QualityStatus;
  actual: number | string | null;
  limit: number | string | null;
  message: string;
  remediation: string;
  /** Distinguishes exact measurements from estimates and unavailable diagnostics. */
  certainty: MeasurementCertainty;
}

export interface QualitySummary {
  pass: number;
  warning: number;
  block: number;
  total: number;
}

export interface QualityPreflightResult {
  profile: {
    id: QualityProfileId;
    label: string;
    budgetSeverity: BudgetSeverity;
  };
  limits: QualityLimits;
  format: ExportFormatId;
  checks: QualityCheck[];
  status: QualityStatus;
  summary: QualitySummary;
  metrics: QualityMetrics;
  message: string;
  /** True when the file-size check used an estimate instead of produced bytes. */
  estimated: boolean;
}
