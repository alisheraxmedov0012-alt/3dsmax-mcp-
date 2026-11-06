/**
 * Phase 6.2 — untrusted selection in, scene-ready model out.
 *
 * One pipeline serves all three formats, so the security properties cannot drift
 * apart:
 *
 *   selection limits → resource map → main file (magic bytes) → per-format policy
 *   → loader → unit scale → geometry sanity → bounds → metadata
 *
 * The per-format step only differs in *how* the document is validated and parsed;
 * everything after it (units, placement, measurement, ownership) is shared.
 *
 * Nothing is registered in the shared store here. The caller decides when the
 * model joins the scene, which keeps the "confirm import" step in the UI honest
 * and makes cancellation a plain `dispose()`.
 */
import * as THREE from 'three';
import { findGeometryIssues } from '../export/geometryGuard';
import {
  IMPORTED_BOUNDS_LIMIT_CM,
  type ImportedModelMeta,
  type Vec3,
} from '../scene/types';
import { sha256Hex } from '../util/sha256';
import { detectModelFormat, type ModelFormat } from './detectFormat';
import { inspectGlb } from './glbInspect';
import { inspectGltf } from './gltfInspect';
import { resolveGltfResources, stripDroppedImageReferences } from './gltfResources';
import { importFailure, ImportError } from './importErrors';
import { disposeImportedModel } from './importedModelStore';
import {
  DEFAULT_OBJ_UNIT,
  METERS_TO_CENTIMETERS,
  OBJ_UNIT_TO_CM,
  type ObjUnit,
} from './importLimits';
import { loadGltfScene } from './loadGltf';
import { loadObjScene } from './loadObj';
import { scanObj } from './objGuard';
import {
  buildResourceMap,
  describeResourceMapFailure,
  type ImportFile,
  type ResourceMap,
} from './resourceMap';
import type { TextureDecoder } from './textureDecode';

export const MAX_FILE_NAME_LENGTH = 255;

export type { ImportFile } from './resourceMap';

/** Extensions used only to pick the main file out of a selection. */
const MODEL_EXTENSIONS = /\.(glb|gltf|obj)$/iu;

export interface ParsedImport {
  /** Metadata that matches exactly the geometry in `root`. */
  readonly meta: ImportedModelMeta;
  /** Detached root: centimetres, centred on X/Z, base resting on Y = 0. */
  readonly root: THREE.Group;
  /** Releases every geometry, material and texture under `root`. Idempotent. */
  dispose: () => void;
}

export interface ImportReferences {
  readonly total: number;
  readonly resolved: number;
  readonly missing: readonly string[];
  readonly ambiguous: readonly string[];
}

export interface ImportReport {
  readonly format: ModelFormat;
  readonly mainFile: string;
  readonly totalFiles: number;
  readonly totalBytes: number;
  readonly references: ImportReferences;
  readonly warnings: readonly string[];
  /**
   * True when the model imported with something missing (textures, a declared
   * MTL). The UI must not proceed without an explicit confirmation in that case.
   */
  readonly requiresAcknowledgement: boolean;
}

export interface PreparedImport {
  readonly parsed: ParsedImport;
  readonly report: ImportReport;
}

export interface PrepareOptions {
  readonly signal?: AbortSignal;
  /** OBJ only: the linear unit of the source file. Defaults to centimetres. */
  readonly objUnit?: ObjUnit;
  /**
   * Textures are decoded with `createImageBitmap`, which Node has no equivalent
   * for; tests inject this so every other line stays real.
   */
  readonly decodeTexture?: TextureDecoder;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw importFailure('aborted');
  }
}

function safeFileName(name: string): string {
  // A picker can hand back a path on some platforms; only the leaf is a name.
  const leaf = name.split(/[\\/]/u).pop()?.trim() ?? '';
  const cleaned = leaf.slice(0, MAX_FILE_NAME_LENGTH);
  return cleaned === '' ? 'model' : cleaned;
}

function toVec3(point: THREE.Vector3): Vec3 {
  return { x: point.x, y: point.y, z: point.z };
}

/**
 * Recomputes every geometry's bounding box from its actual vertices.
 *
 * `GLTFLoader` seeds `geometry.boundingBox` from the accessor's declared `min` and
 * `max`, which an untrusted file can set to anything. Framing, the size limits and
 * the reported envelope all read that box, so a file declaring a 1 m model while
 * carrying 2 km of vertices would pass every check. Recomputing from the buffers
 * makes the measurement independent of what the file claims.
 */
function recomputeGeometryBounds(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      mesh.geometry.computeBoundingBox();
    }
  });
}

/**
 * Rejects geometry the viewer and the exporters could not handle.
 *
 * The shared export guard is reused rather than reimplemented, but degenerate
 * triangles are tolerated: they are common in real exports and harm nothing here,
 * while a NaN coordinate or an out-of-range index would corrupt every later step.
 */
function assertUsableGeometry(root: THREE.Object3D): void {
  const issues = findGeometryIssues(root).filter(
    (issue) => issue.reason !== 'degenerate_triangle',
  );
  if (issues.length > 0) {
    throw importFailure('invalid_geometry', `${issues[0].objectName}: ${issues[0].reason}.`);
  }
}

interface RawModel {
  /** Parsed hierarchy in the source file's own units. */
  readonly scene: THREE.Object3D;
  /** One conversion to centimetres, applied at the root. */
  readonly scaleToCm: number;
  readonly stats: {
    readonly meshes: number;
    readonly triangles: number;
    readonly materials: number;
    readonly textures: number;
  };
}

interface FormatResult extends RawModel {
  readonly report: Omit<ImportReport, 'format' | 'mainFile' | 'totalFiles' | 'totalBytes'>;
}

/**
 * Turns a raw model into the scene-ready form: centimetres, centred on X/Z with its
 * base on the floor, measured and validated.
 */
function finalize(
  raw: RawModel,
  meta: Pick<ImportedModelMeta, 'format' | 'fileName' | 'sourceBytes' | 'sourceHash'>,
): ParsedImport {
  const root = new THREE.Group();
  root.name = 'imported-model';

  const scaler = new THREE.Group();
  scaler.name = 'imported-scale-cm';
  scaler.scale.setScalar(raw.scaleToCm);
  scaler.add(raw.scene);
  root.add(scaler);
  root.updateMatrixWorld(true);

  try {
    recomputeGeometryBounds(root);
    assertUsableGeometry(root);

    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) {
      throw importFailure('invalid_geometry', 'Modelda ko‘rinadigan geometriya yo‘q.');
    }

    // Placement is a scene decision, not a geometry edit: centre the model on X/Z
    // and stand it on the floor, so an imported piece lands where the user is
    // looking and can be moved from the object panel afterwards.
    const centre = box.getCenter(new THREE.Vector3());
    scaler.position.set(-centre.x, -box.min.y, -centre.z);
    root.updateMatrixWorld(true);

    const placed = new THREE.Box3().setFromObject(root);
    const size = placed.getSize(new THREE.Vector3());
    const limit = IMPORTED_BOUNDS_LIMIT_CM;
    if (
      !Number.isFinite(size.x) ||
      !Number.isFinite(size.y) ||
      !Number.isFinite(size.z) ||
      size.x > limit ||
      size.y > limit ||
      size.z > limit
    ) {
      throw importFailure(
        'too_complex',
        `Model o‘lchami ${size.x.toFixed(1)}×${size.y.toFixed(1)}×${size.z.toFixed(1)} sm ` +
          `(limit ${limit} sm).`,
      );
    }
    if (size.x <= 0 && size.y <= 0 && size.z <= 0) {
      throw importFailure('invalid_geometry', 'Model nol o‘lchamga ega.');
    }

    const fullMeta: ImportedModelMeta = {
      ...meta,
      meshes: raw.stats.meshes,
      triangles: raw.stats.triangles,
      materials: raw.stats.materials,
      textures: raw.stats.textures,
      boundsCm: { min: toVec3(placed.min), max: toVec3(placed.max) },
    };

    return {
      meta: fullMeta,
      root,
      dispose: () => disposeImportedModel(root),
    };
  } catch (error) {
    // A rejected import must not leave a parsed model holding GPU memory.
    disposeImportedModel(root);
    throw error instanceof ImportError ? error : importFailure('failed');
  }
}

async function buildGlb(
  bytes: ArrayBuffer,
  signal: AbortSignal | undefined,
): Promise<FormatResult> {
  const inspection = inspectGlb(bytes);
  assertNotAborted(signal);
  // A GLB is self-contained by policy: the inspection above rejects any file
  // reference, so the loader never needs a resource map.
  const scene = await loadGltfScene(bytes, { resources: null, signal });
  return {
    scene,
    scaleToCm: METERS_TO_CENTIMETERS,
    stats: {
      meshes: inspection.stats.meshes,
      triangles: inspection.stats.triangles,
      materials: inspection.stats.materials,
      textures: inspection.stats.textures,
    },
    report: {
      references: { total: 0, resolved: 0, missing: [], ambiguous: [] },
      warnings: [],
      requiresAcknowledgement: false,
    },
  };
}

async function buildGltf(
  bytes: ArrayBuffer,
  resources: ResourceMap,
  signal: AbortSignal | undefined,
): Promise<FormatResult> {
  const inspection = inspectGltf(bytes);
  assertNotAborted(signal);

  const resolved = resolveGltfResources(inspection.stats.externalReferences, resources);
  // A texture that could not be used is removed from the material references, so
  // the model still loads with factor colours instead of failing outright.
  const document = stripDroppedImageReferences(inspection.json, resolved.droppedImages);

  const scene = await loadGltfScene(JSON.stringify(document), { resources, signal });

  const warnings = resolved.droppedImages.map((image) =>
    image.reason === 'ambiguous'
      ? `"${image.uri}" bir nechta faylga mos keladi — tekstura qo‘llanmadi.`
      : `"${image.uri}" teksturasi ishlatilmadi (${image.reason}) — material rangsiz qoldirildi.`,
  );

  const unusableImages = resolved.droppedImages.filter((image) => image.reason !== 'ambiguous');
  const ambiguousImages = resolved.droppedImages.filter((image) => image.reason === 'ambiguous');

  return {
    scene,
    scaleToCm: METERS_TO_CENTIMETERS,
    stats: {
      meshes: inspection.stats.meshes,
      triangles: inspection.stats.triangles,
      materials: inspection.stats.materials,
      // Only the textures that survived contribute to the model.
      textures: Math.max(0, inspection.stats.textures - resolved.droppedImages.length),
    },
    report: {
      references: {
        total: resolved.total,
        resolved: resolved.resolved,
        missing: [...resolved.missing, ...unusableImages.map((image) => image.uri)],
        ambiguous: [...resolved.ambiguous, ...ambiguousImages.map((image) => image.uri)],
      },
      warnings,
      requiresAcknowledgement: resolved.droppedImages.length > 0,
    },
  };
}

async function buildObj(
  bytes: ArrayBuffer,
  resources: ResourceMap,
  unit: ObjUnit,
  options: PrepareOptions,
): Promise<FormatResult> {
  const text = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  const scan = scanObj(text);
  assertNotAborted(options.signal);

  const loaded = await loadObjScene(text, {
    resources,
    mtlLibraries: scan.mtlLibraries,
    decode: options.decodeTexture,
    signal: options.signal,
  });

  const missingLibraries = scan.mtlLibraries.filter((path) => !resources.has(path));
  const warnings = [...loaded.warnings];

  if (scan.hasMaterials && scan.mtlLibraries.length === 0) {
    warnings.push(
      'OBJ material kutubxonasini (mtllib) ko‘rsatmagan — model standart material bilan import qilindi.',
    );
  }
  if (missingLibraries.length > 0) {
    warnings.push(
      `Material fayli tanlanmagan: ${missingLibraries.join(', ')}. Model rangsiz import qilindi.`,
    );
  }

  // Both material libraries and textures are resources the user had to supply;
  // the report counts them together so nothing is quietly unaccounted for.
  const totalResources = scan.mtlLibraries.length + loaded.expectedTextureCount;
  const resolvedResources =
    scan.mtlLibraries.length - missingLibraries.length + loaded.textureCount;

  return {
    scene: loaded.group,
    // OBJ has no unit of its own; the caller's choice is the only conversion.
    scaleToCm: OBJ_UNIT_TO_CM[unit],
    stats: {
      meshes: loaded.meshCount,
      triangles: scan.triangles,
      materials: loaded.materialCount,
      textures: loaded.textureCount,
    },
    report: {
      references: {
        total: totalResources,
        resolved: resolvedResources,
        missing: missingLibraries,
        ambiguous: [],
      },
      warnings,
      // A missing map changes what the user sees, so it needs an explicit
      // acknowledgement just like a missing MTL.
      requiresAcknowledgement:
        missingLibraries.length > 0 || loaded.missingTextureCount > 0,
    },
  };
}

/** Picks the one model file out of the selection. */
function pickMainFile(files: readonly ImportFile[]): ImportFile {
  const named = files.filter((file) => MODEL_EXTENSIONS.test(file.path ?? file.name));
  if (named.length === 1) {
    return named[0];
  }
  if (named.length > 1) {
    throw importFailure(
      'unsupported_format',
      `Bir vaqtda bir nechta model fayli tanlandi (${named
        .map((file) => safeFileName(file.name))
        .join(', ')}). Faqat bittasini tanlang.`,
    );
  }
  if (files.length === 1) {
    // A renamed file has no usable extension; its content decides.
    return files[0];
  }
  throw importFailure(
    'unsupported_format',
    "Tanlangan fayllar orasida model fayli yo‘q (.glb, .gltf yoki .obj).",
  );
}

/**
 * Validates and parses a whole selection, without touching the scene.
 *
 * The returned model is detached and owned by the caller; `report` describes what
 * was resolved and what was missing, so the UI can ask for confirmation before the
 * model is registered.
 */
export async function prepareImport(
  files: readonly ImportFile[],
  options: PrepareOptions = {},
): Promise<PreparedImport> {
  const { signal } = options;
  assertNotAborted(signal);

  if (files.length === 0) {
    throw importFailure('empty', 'Hech qanday fayl tanlanmagan.');
  }

  // A picker normally reports a leaf name, but a dropped directory entry or a
  // non-browser caller can hand over a path; only the leaf may become a resource
  // key, and anything else would be rejected as an absolute path.
  const selection = files.map((file) => ({
    name: safeFileName(file.name),
    ...(file.path === undefined ? {} : { path: file.path }),
    bytes: file.bytes,
  }));

  const built = buildResourceMap(selection);
  if (!built.ok) {
    throw importFailure('too_complex', describeResourceMapFailure(built.failure));
  }
  const resources = built.map;

  const main = pickMainFile(selection);
  const format = detectModelFormat(main.bytes);
  assertNotAborted(signal);

  const formatResult =
    format === 'glb'
      ? await buildGlb(main.bytes, signal)
      : format === 'gltf'
        ? await buildGltf(main.bytes, resources, signal)
        : await buildObj(main.bytes, resources, options.objUnit ?? DEFAULT_OBJ_UNIT, options);

  const parsed = finalize(formatResult, {
    format,
    fileName: safeFileName(main.name),
    // The whole selection is what the user imported, so the size reported is the
    // size of everything they handed over.
    sourceBytes: resources.totalBytes,
    // The main document identifies the import; companion files cannot change the
    // object's identity without a new import anyway.
    sourceHash: sha256Hex(new Uint8Array(main.bytes)),
  });

  return {
    parsed,
    report: {
      format,
      mainFile: safeFileName(main.name),
      totalFiles: selection.length,
      totalBytes: resources.totalBytes,
      ...formatResult.report,
    },
  };
}

/**
 * Single-file convenience wrapper, kept for the GLB flow and its tests.
 *
 * It is exactly `prepareImport` with one file, so a caller cannot accidentally
 * take a less strict path.
 */
export async function parseModelFile(
  file: ImportFile,
  options: { signal?: AbortSignal } = {},
): Promise<ParsedImport> {
  const { parsed } = await prepareImport([file], options);
  return parsed;
}
