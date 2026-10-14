import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { buildRoom } from '../geometry/buildRoom';
import { buildSceneObject } from '../scene/buildSceneObject';
import type { SceneData } from '../scene/types';

export const SCENE_EXPORT_FILENAME = '3d-studio-ai-scene.glb';

export interface ExportScene {
  scene: THREE.Scene;
  dispose: () => void;
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
export function buildExportScene(data: SceneData): ExportScene {
  const scene = new THREE.Scene();
  scene.name = 'scene-export';

  const disposers: Array<() => void> = [];

  const room = buildRoom(data.room);
  scene.add(room.group);
  disposers.push(room.dispose);

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
 */
export async function exportSceneToGlb(data: SceneData): Promise<ArrayBuffer> {
  const { scene, dispose } = buildExportScene(data);

  try {
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
