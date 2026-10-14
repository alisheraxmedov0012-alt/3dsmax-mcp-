import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { buildRoom } from '../geometry/buildRoom';
import { buildSceneObject } from '../scene/buildSceneObject';
import type { SceneData } from '../scene/types';
import { assertFiniteGeometry } from './geometryGuard';

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
  const scene = new THREE.Scene();
  scene.name = 'scene-export';

  const disposers: Array<() => void> = [];

  if (options.includeRoom !== false) {
    const room = buildRoom(data.room, data.settings.roomMaterials);
    scene.add(room.group);
    disposers.push(room.dispose);
  }

  data.objects.forEach((object) => {
    const built = buildSceneObject(object);
    scene.add(built.group);
    disposers.push(built.dispose);
  });

  return {
    scene,
    dispose: () => disposers.forEach((dispose) => dispose()),
  };
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
    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(scene, { binary: true });

    if (!(result instanceof ArrayBuffer)) {
      throw new Error('GLB eksport natijasi kutilgan ikkilik formatda emas.');
    }

    return result;
  } finally {
    dispose();
  }
}
