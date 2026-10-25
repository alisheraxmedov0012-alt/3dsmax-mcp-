/**
 * W8 unified data-export dispatch.
 *
 * One entry point (`exportSceneToFormat`) turns the scene into the requested
 * *file* format. Each format runs the geometry safety check and is produced by
 * the corresponding Three.js exporter, so no format is claimed that is not really
 * implemented.
 *
 * OBJ and STL export **geometry only**. Three.js' OBJExporter emits material
 * references (`usemtl`) when a mesh's material has a name — which the W4 material
 * model now does — so those references are stripped here to keep the documented
 * contract: the file never points at a `.mtl` that is not produced. STLExporter
 * carries no colour/material. The limitation is surfaced in the UI via
 * `exportFormats`.
 */
import type { SceneData } from '../scene/types';
import { buildExportScene, exportSceneToGlb, type BuildExportOptions } from './sceneExport';
import { EXPORT_FORMATS, type ExportFormatId } from './exportFormats';
import { assertFiniteGeometry } from './geometryGuard';
import { serializeSceneToJson } from './sceneJson';
import { buildExportFilename } from './exportNaming';
import { ExportError, type ExportArtifact, type ExportMetadata } from './exportTypes';

/**
 * Load an OBJ/STL exporter on demand.
 *
 * Both are small (~5-6 kB of source) but were still riding in the entry bundle,
 * so they move behind the export click like the glTF one. A failed chunk request
 * becomes a normal `ExportError` so the UI keeps its single error path.
 */
async function loadExporter<T>(load: () => Promise<T>, label: string): Promise<T> {
  try {
    return await load();
  } catch {
    throw new ExportError(
      'failed',
      `${label} eksport moduli yuklanmadi. Internet aloqasini tekshirib, qaytadan urinib ko'ring.`,
    );
  }
}

/** File formats produced by `exportSceneToFormat` (PNG is a render, not a file format here). */
export const DATA_EXPORT_FORMATS: readonly ExportFormatId[] = ['glb', 'json', 'obj', 'stl'];

/**
 * Remove OBJ material references so the export stays geometry-only by contract.
 * `usemtl <name>` lines are dropped; `mtllib` lines would point at an `.mtl` the
 * app never writes, so they are dropped too.
 */
function stripObjMaterialReferences(obj: string): string {
  return obj
    .split('\n')
    .filter((line) => !line.startsWith('usemtl ') && !line.startsWith('mtllib '))
    .join('\n');
}

function toBlob(data: string | ArrayBuffer | DataView, mimeType: string): Blob {
  if (typeof data === 'string') {
    return new Blob([data], { type: mimeType });
  }
  if (data instanceof DataView) {
    return new Blob([data.buffer as ArrayBuffer], { type: mimeType });
  }
  return new Blob([data], { type: mimeType });
}

/**
 * Export the scene to a file format. Throws `ExportError` on failure; the caller
 * shows the message and keeps the editor running.
 */
export async function exportSceneToFormat(
  format: ExportFormatId,
  data: SceneData,
  metadata: ExportMetadata,
  options: BuildExportOptions = {},
): Promise<ExportArtifact> {
  const spec = EXPORT_FORMATS[format];
  const filename = buildExportFilename(metadata, spec.extension);

  switch (format) {
    case 'glb': {
      const buffer = await exportSceneToGlb(data, options);
      return { blob: toBlob(buffer, spec.mimeType), filename, mimeType: spec.mimeType };
    }
    case 'json': {
      // JSON carries the parameters, not the mesh; it is built directly from the
      // scene data model (no geometry to guard).
      const json = serializeSceneToJson(data, metadata);
      return { blob: toBlob(json, spec.mimeType), filename, mimeType: spec.mimeType };
    }
    case 'obj': {
      const { scene, dispose } = buildExportScene(data, options);
      try {
        assertFiniteGeometry(scene);
        const { OBJExporter } = await loadExporter(
          () => import('three/examples/jsm/exporters/OBJExporter.js'),
          'OBJ',
        );
        const obj = stripObjMaterialReferences(new OBJExporter().parse(scene));
        return { blob: toBlob(obj, spec.mimeType), filename, mimeType: spec.mimeType };
      } finally {
        dispose();
      }
    }
    case 'stl': {
      const { scene, dispose } = buildExportScene(data, options);
      try {
        assertFiniteGeometry(scene);
        // Binary STL is compact; ASCII is available but rarely wanted for meshes.
        const { STLExporter } = await loadExporter(
          () => import('three/examples/jsm/exporters/STLExporter.js'),
          'STL',
        );
        const stl = new STLExporter().parse(scene, { binary: true });
        return { blob: toBlob(stl, spec.mimeType), filename, mimeType: spec.mimeType };
      } finally {
        dispose();
      }
    }
    default:
      throw new ExportError(
        'unsupported',
        `'${String(format)}' formati fayl eksportida qo'llab-quvvatlanmaydi.`,
      );
  }
}
