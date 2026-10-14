import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { buildTable } from '../geometry/buildTable';
import type { TableParams } from '../geometry/tableParams';

export const TABLE_EXPORT_FILENAME = '3d-studio-ai-table.glb';

export interface ExportScene {
  scene: THREE.Scene;
  dispose: () => void;
}

/**
 * Builds a standalone scene for export from the given parameters.
 *
 * It always builds a fresh model with `buildTable`, so the visible viewer model
 * and the UI parameters are never touched. Kept separate from the download step
 * so it can be tested without a browser.
 */
export function buildExportScene(params: TableParams): ExportScene {
  const table = buildTable(params);

  const scene = new THREE.Scene();
  scene.name = 'table-export';
  scene.add(table.group);

  return {
    scene,
    dispose: () => table.dispose(),
  };
}

/**
 * Serialises the table described by `params` to binary glTF (.glb) bytes.
 *
 * Uses Three.js' official GLTFExporter with `binary: true`, which embeds the
 * geometry buffer and the material/colour into the file. No backend or external
 * API is involved. The temporary export scene is disposed afterwards.
 */
export async function exportTableToGlb(params: TableParams): Promise<ArrayBuffer> {
  const { scene, dispose } = buildExportScene(params);

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
