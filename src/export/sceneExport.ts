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

  pruneInvisible(scene);

  return {
    scene,
    dispose: () => disposers.forEach((dispose) => dispose()),
  };
}

/**
 * Remove invisible subtrees before any exporter sees them.
 *
 * GLTFExporter already defaults to `onlyVisible: true`, but OBJExporter and
 * STLExporter traverse every mesh regardless of visibility. Pruning here gives
 * all three formats the same policy: a hidden parent removes its whole subtree,
 * and a hidden child is removed from a visible parent.
 */
export function pruneInvisible(root: THREE.Object3D): void {
  for (const child of root.children.slice()) {
    if (!child.visible) {
      child.removeFromParent();
      continue;
    }
    pruneInvisible(child);
  }
}

/** Reject a scene with no visible mesh geometry before writing a file. */
export function assertExportableScene(root: THREE.Object3D): void {
  let meshes = 0;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const position = (mesh.geometry as THREE.BufferGeometry | undefined)?.getAttribute?.('position');
    if (position && position.count > 0) meshes += 1;
  });
  if (meshes === 0) {
    throw new ExportError(
      'empty_scene',
      "Eksport qilish uchun ko'rinadigan geometriya yo'q. Obyektni ko'rsating yoki xonani eksportga qo'shing.",
    );
  }
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

const GLB_JSON_CHUNK = 0x4e4f534a;

/**
 * Give glTF meshes stable, readable names without touching geometry or buffers.
 *
 * Three.js r186 only writes node names, so `mesh.name` is null in the file. The
 * node names are already meaningful (`table-top`, `table-leg-1`, ...), so the
 * names are derived from them. A mesh shared by several nodes (all table legs)
 * uses their common prefix plus a collision suffix, never one arbitrary node.
 * Only the JSON chunk is rewritten; the BIN chunk and every bufferView offset
 * stay byte-identical.
 */
export function nameExportedMeshes(glb: ArrayBuffer): ArrayBuffer {
  try {
    const view = new DataView(glb);
    if (view.getUint32(0, true) !== 0x46546c67) return glb;

    const totalLength = view.getUint32(8, true);
    const chunks: Array<{ type: number; bytes: Uint8Array }> = [];
    let offset = 12;
    while (offset + 8 <= totalLength) {
      const length = view.getUint32(offset, true);
      const type = view.getUint32(offset + 4, true);
      chunks.push({ type, bytes: new Uint8Array(glb, offset + 8, length) });
      offset += 8 + length;
    }

    const jsonChunk = chunks.find((chunk) => chunk.type === GLB_JSON_CHUNK);
    if (!jsonChunk) return glb;
    const json = JSON.parse(new TextDecoder().decode(jsonChunk.bytes)) as {
      meshes?: Array<{ name?: string }>;
      nodes?: Array<{ name?: string; mesh?: number }>;
    };
    const meshes = json.meshes ?? [];
    const nodes = json.nodes ?? [];

    const nodesByMesh = new Map<number, string[]>();
    for (const node of nodes) {
      if (typeof node.mesh !== 'number') continue;
      const names = nodesByMesh.get(node.mesh) ?? [];
      if (typeof node.name === 'string' && node.name.trim() !== '') names.push(node.name);
      nodesByMesh.set(node.mesh, names);
    }

    const commonPrefix = (values: string[]): string => {
      if (values.length === 0) return '';
      let prefix = values[0];
      for (const value of values.slice(1)) {
        while (!value.startsWith(prefix)) prefix = prefix.slice(0, -1);
      }
      return prefix.replace(/[-_.\s]+$/, '');
    };

    const used = new Set<string>();
    meshes.forEach((mesh, index) => {
      if (typeof mesh.name === 'string' && mesh.name.trim() !== '') {
        used.add(mesh.name);
        return;
      }
      const names = nodesByMesh.get(index) ?? [];
      let candidate = names.length === 1 ? names[0] : commonPrefix(names);
      if (candidate.length < 3) candidate = `mesh-${index}`;
      let unique = candidate;
      let suffix = 2;
      while (used.has(unique)) unique = `${candidate}-${suffix++}`;
      mesh.name = unique;
      used.add(unique);
    });

    const encoded = new TextEncoder().encode(JSON.stringify(json));
    const rebuilt: Array<{ type: number; bytes: Uint8Array }> = chunks.map((chunk) =>
      chunk.type === GLB_JSON_CHUNK ? { type: chunk.type, bytes: encoded } : chunk,
    );
    const padded = rebuilt.map((chunk) => {
      const pad = (4 - (chunk.bytes.length % 4)) % 4;
      const bytes = new Uint8Array(chunk.bytes.length + pad);
      bytes.set(chunk.bytes);
      if (chunk.type === GLB_JSON_CHUNK) bytes.fill(0x20, chunk.bytes.length);
      return { type: chunk.type, bytes };
    });
    const length = 12 + padded.reduce((sum, chunk) => sum + 8 + chunk.bytes.length, 0);
    const output = new ArrayBuffer(length);
    const out = new DataView(output);
    const outBytes = new Uint8Array(output);
    out.setUint32(0, 0x46546c67, true);
    out.setUint32(4, 2, true);
    out.setUint32(8, length, true);
    let cursor = 12;
    for (const chunk of padded) {
      out.setUint32(cursor, chunk.bytes.length, true);
      out.setUint32(cursor + 4, chunk.type, true);
      outBytes.set(chunk.bytes, cursor + 8);
      cursor += 8 + chunk.bytes.length;
    }
    return output;
  } catch (error) {
    // Naming is an interoperability improvement; never fail an otherwise valid
    // export because the post-processing could not read it, but keep the
    // failure diagnosable instead of swallowing it.
    console.warn(
      'GLB mesh nomlash post-processi bajarilmadi:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return glb;
  }
}

/**
 * glTF linear units are metres, while the scene model stores centimetres.
 *
 * Wrap the export scene in a single root that scales centimetres to metres. The
 * child node coordinates stay untouched (so local transforms, normals, UVs and
 * material data are unchanged); only the root transform carries the conversion.
 * `buildExportScene` itself is not changed, so OBJ/STL and the viewer keep their
 * existing centimetre convention.
 */
function addMetreScaleRoot(scene: THREE.Scene): void {
  const root = new THREE.Group();
  root.name = 'scene-root';
  root.scale.setScalar(0.01);
  for (const child of scene.children.slice()) {
    root.add(child);
  }
  scene.add(root);
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
    assertExportableScene(scene);
    addMetreScaleRoot(scene);
    const GltfExporter = await loadGltfExporter();
    const exporter = new GltfExporter();
    const result = await exporter.parseAsync(scene, { binary: true });

    if (!(result instanceof ArrayBuffer)) {
      throw new Error('GLB eksport natijasi kutilgan ikkilik formatda emas.');
    }

    return nameExportedMeshes(result);
  } finally {
    dispose();
  }
}
