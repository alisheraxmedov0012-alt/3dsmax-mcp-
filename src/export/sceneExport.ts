import * as THREE from 'three';
import { buildRoom } from '../geometry/buildRoom';
import { applyTextureResolution } from '../materials/buildMaterial';
import { buildSceneObject } from '../scene/buildSceneObject';
import type { SceneData, SceneObject } from '../scene/types';
import { assertFiniteGeometry } from './geometryGuard';
import { ExportError } from './exportTypes';

export const SCENE_EXPORT_FILENAME = '3d-studio-ai-scene.glb';

export interface ExportScene {
  scene: THREE.Scene;
  dispose: () => void;
}

export interface BuildExportOptions {
  /**
   * Include the room (floor/walls/ceiling) in the export. Defaults to true so
   * existing GLB behaviour is unchanged; marketplace furniture exports set it to
   * false to ship the piece alone.
   */
  includeRoom?: boolean;
  /**
   * Export-only procedural map size. Omitted keeps the 128 px default that the
   * interactive preview also uses; 512 is an explicit opt-in. This is never
   * persisted in scene data and the viewer never reads it.
   */
  textureSize?: 128 | 512;
}

/**
 * Swap the procedural maps on the freshly built export materials for maps at the
 * requested size. Only maps change: colour, PBR scalars, opacity, normalScale and
 * render state stay on the existing material, so no property has to be copied.
 *
 * Materials are collected by identity, so a material shared by several meshes is
 * retargeted once, and array materials are handled. Non-standard materials are
 * left alone; the furniture builders only produce MeshStandardMaterial.
 */
function retargetExportTextures(
  root: THREE.Object3D,
  object: SceneObject,
  textureSize: 128 | 512,
): Array<() => void> {
  const seen = new Set<THREE.Material>();
  const disposers: Array<() => void> = [];

  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (seen.has(material)) {
        continue;
      }
      seen.add(material);
      if (!(material instanceof THREE.MeshStandardMaterial)) {
        continue;
      }
      const dispose = applyTextureResolution(material, object.material, textureSize);
      if (dispose) {
        disposers.push(dispose);
      }
    }
  });

  return disposers;
}

/**
 * Builds a standalone Three.js scene for export from the scene data model:
 * the room plus every visible object, with their geometry, transforms and
 * materials. Always builds fresh objects, so the visible viewer and the scene
 * data are never touched. Kept separate from the download step so it can be
 * tested without a browser.
 *
 * Note: objects marked `visible: false` are omitted from the export (the
 * exporter skips invisible objects by default).
 */
export function buildExportScene(data: SceneData, options: BuildExportOptions = {}): ExportScene {
  const requested = options.textureSize as unknown;
  if (requested !== undefined && requested !== 128 && requested !== 512) {
    throw new ExportError(
      'failed',
      "Tekstura o'lchami faqat 128 yoki 512 bo'lishi mumkin.",
    );
  }

  const scene = new THREE.Scene();
  scene.name = 'scene-export';

  const disposers: Array<() => void> = [];

  try {
    if (options.includeRoom !== false) {
      const room = buildRoom(data.room, data.settings.roomMaterials);
      scene.add(room.group);
      disposers.push(room.dispose);
    }

    data.objects.forEach((object) => {
      const built = buildSceneObject(object);
      scene.add(built.group);
      disposers.push(built.dispose);
      if (options.textureSize === 512 && object.visible) {
        disposers.push(...retargetExportTextures(built.group, object, 512));
      }
    });
  } catch (error) {
    disposers.forEach((dispose) => dispose());
    throw error;
  }

  return {
    scene,
    dispose: () => disposers.forEach((dispose) => dispose()),
  };
}

/**
 * Load the glTF exporter on demand.
 *
 * `GLTFExporter` is ~94 kB of source and is only needed when someone actually
 * exports a GLB, so it is fetched as its own chunk instead of riding along in
 * the entry bundle. This function is already async, so the extra hop costs
 * nothing at the call sites (the C1 package and the export button both await it).
 */
async function loadGltfExporter() {
  try {
    const module = await import('three/examples/jsm/exporters/GLTFExporter.js');
    return module.GLTFExporter;
  } catch {
    // A failed chunk request is a real, recoverable condition (offline, a stale
    // deployment). Report it as an export error with the same message shape as
    // any other failure so the UI keeps its single error path.
    throw new ExportError(
      'failed',
      "GLB eksport moduli yuklanmadi. Internet aloqasini tekshirib, qaytadan urinib ko'ring.",
    );
  }
}

/**
 * Serialises the whole scene to binary glTF (.glb) bytes using Three.js'
 * official GLTFExporter. No backend or external API is involved. The temporary
 * export scene is disposed afterwards.
 *
 * A geometry safety check runs first: a NaN/Infinity coordinate is rejected with
 * `ExportError('invalid_geometry')` rather than written into a corrupt file.
 */
export async function exportSceneToGlb(
  data: SceneData,
  options: BuildExportOptions = {},
): Promise<ArrayBuffer> {
  const { scene, dispose } = buildExportScene(data, options);

  try {
    assertFiniteGeometry(scene);
    const GltfExporter = await loadGltfExporter();
    const exporter = new GltfExporter();
    const result = await exporter.parseAsync(scene, { binary: true });

    if (!(result instanceof ArrayBuffer)) {
      throw new Error('GLB eksport natijasi kutilgan ikkilik formatda emas.');
    }

    return result;
  } finally {
    dispose();
  }
}
