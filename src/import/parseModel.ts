/**
 * Phase 6.2 — untrusted file in, scene-ready model out.
 *
 * The pipeline is deliberately linear and refuses at the first problem, so a
 * caller either gets a complete, measured model or a typed `ImportError` and
 * nothing allocated:
 *
 *   size → format (magic bytes) → container → document policy → loader
 *        → unit scale → geometry sanity → bounds → metadata
 *
 * Units: glTF linear distances are metres and the editor stores centimetres, so
 * the model is scaled once at the root (×100). Vertices are never rewritten, so
 * the conversion stays reversible and the stored bounds describe exactly what was
 * loaded.
 */
import * as THREE from 'three';
import { findGeometryIssues } from '../export/geometryGuard';
import {
  IMPORTED_BOUNDS_LIMIT_CM,
  type ImportedModelMeta,
  type Vec3,
} from '../scene/types';
import { sha256Hex } from '../util/sha256';
import { detectModelFormat } from './detectFormat';
import { inspectGlb } from './glbInspect';
import { importFailure, ImportError } from './importErrors';
import { disposeImportedModel } from './importedModelStore';
import { METERS_TO_CENTIMETERS } from './importLimits';
import { loadGlbScene } from './loadGltf';

export const MAX_FILE_NAME_LENGTH = 255;

export interface ImportFile {
  readonly name: string;
  readonly bytes: ArrayBuffer;
}

export interface ParsedImport {
  /** Metadata that matches exactly the geometry in `root`. */
  readonly meta: ImportedModelMeta;
  /** Detached root: centimetres, centred on X/Z, base resting on Y = 0. */
  readonly root: THREE.Group;
  /** Releases every geometry, material and texture under `root`. Idempotent. */
  dispose: () => void;
}

function safeFileName(name: string): string {
  // A picker can hand back a path on some platforms; only the leaf is a name.
  const leaf = name.split(/[\\/]/u).pop()?.trim() ?? '';
  const cleaned = leaf.slice(0, MAX_FILE_NAME_LENGTH);
  return cleaned === '' ? 'model.glb' : cleaned;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw importFailure('aborted');
  }
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
    throw importFailure(
      'invalid_geometry',
      `${issues[0].objectName}: ${issues[0].reason}.`,
    );
  }
}

/**
 * Parses one `.glb` file into a scene-ready model.
 *
 * Nothing is registered in the shared store here: the caller decides when the
 * model becomes part of the scene, which keeps the "confirm import" step in the
 * UI honest.
 */
export async function parseModelFile(
  file: ImportFile,
  options: { signal?: AbortSignal } = {},
): Promise<ParsedImport> {
  const fileName = safeFileName(file.name);
  const { signal } = options;

  assertNotAborted(signal);
  detectModelFormat(file.bytes);
  const inspection = inspectGlb(file.bytes);
  assertNotAborted(signal);

  const model = await loadGlbScene(file.bytes, signal);

  const root = new THREE.Group();
  root.name = 'imported-model';

  // One scale for the whole model: metres → centimetres.
  const scaler = new THREE.Group();
  scaler.name = 'imported-scale-cm';
  scaler.scale.setScalar(METERS_TO_CENTIMETERS);
  scaler.add(model);
  root.add(scaler);
  root.updateMatrixWorld(true);

  try {
    recomputeGeometryBounds(root);
    assertUsableGeometry(root);

    const raw = new THREE.Box3().setFromObject(root);
    if (raw.isEmpty()) {
      throw importFailure('invalid_geometry', 'Modelda ko‘rinadigan geometriya yo‘q.');
    }

    // Placement is a scene decision, not a geometry edit: centre the model on
    // X/Z and stand it on the floor, so an imported piece lands where the user is
    // looking and can be moved from the object panel afterwards.
    const centre = raw.getCenter(new THREE.Vector3());
    scaler.position.set(-centre.x, -raw.min.y, -centre.z);
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

    const meta: ImportedModelMeta = {
      format: 'glb',
      fileName,
      sourceBytes: file.bytes.byteLength,
      meshes: inspection.stats.meshes,
      triangles: inspection.stats.triangles,
      materials: inspection.stats.materials,
      textures: inspection.stats.textures,
      sourceHash: sha256Hex(new Uint8Array(file.bytes)),
      boundsCm: { min: toVec3(placed.min), max: toVec3(placed.max) },
    };

    return {
      meta,
      root,
      dispose: () => disposeImportedModel(root),
    };
  } catch (error) {
    // A rejected import must not leave a parsed model holding GPU memory.
    disposeImportedModel(root);
    throw error instanceof ImportError ? error : importFailure('failed');
  }
}
