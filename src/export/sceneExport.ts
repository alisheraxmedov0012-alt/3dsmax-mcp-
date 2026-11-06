import * as THREE from 'three';
import { buildRoom } from '../geometry/buildRoom';
import { applyTextureResolution } from '../materials/buildMaterial';
import {
  applyTextureMapToGroup,
  presentTextureMapRoles,
} from '../materials/applyTextureMaps';
import {
  TEXTURE_MAP_ROLE_LABELS,
  type TextureAssetRef,
  type TextureMapRole,
} from '../materials/asset';
import { resolvePresetSettings } from '../materials/presets';
import {
  textureRegistry,
  type TextureAcquireOptions,
  type TextureProvider,
} from '../materials/textureRegistry';
import { buildSceneObject } from '../scene/buildSceneObject';
import { isImportedSceneObject, type SceneData, type SceneObject } from '../scene/types';
import { importedModelStore } from '../import/importedModelStore';
import { assertFiniteGeometry } from './geometryGuard';
import { ExportError } from './exportTypes';
import { ensureTangentsForNormalMappedMeshes } from './tangents';

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
  /**
   * Restrict the export to one scene object by id.
   *
   * Used by the print formats so a selected-product export cannot silently
   * include unrelated furniture. A missing id leaves zero objects, which the
   * usual empty-scene guard rejects instead of writing an empty file.
   */
  onlyObjectId?: string;
  /**
   * Export-only texture resolver. Defaults to the authenticated viewport
   * registry; tests inject a provider so GLB embedding is checked without a
   * network or a real image decoder. Never persisted in scene data.
   */
  textureProvider?: TextureProvider;
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

    const exportObjects = options.onlyObjectId
      ? data.objects.filter((object) => object.id === options.onlyObjectId)
      : data.objects;

    exportObjects.forEach((object) => {
      // Imported geometry comes from the runtime store, which owns its resources;
      // the build returns a clone and a no-op disposer.
      const built = buildSceneObject(object, { imported: importedModelStore });
      scene.add(built.group);
      disposers.push(built.dispose);
      if (
        options.textureSize === 512 &&
        object.visible &&
        // Phase 6.2: an imported model's maps are authored in its source file, and
        // the clone shares those material instances with the viewer. Retargeting
        // them to an export-only size would mutate the model the user is looking at.
        !isImportedSceneObject(object) &&
        !object.material.maps?.baseColor
      ) {
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

/** The parts of an exported glTF document the naming pass rewrites. */
interface GltfNamingShape {
  meshes?: Array<{ name?: string }>;
  nodes?: Array<{ name?: string; mesh?: number }>;
}

/**
 * Give glTF meshes stable, readable names without touching geometry or buffers.
 *
 * Three.js r186 only writes node names, so `mesh.name` is null in the file. The
 * node names are already meaningful (`table-top`, `table-leg-1`, ...), so the
 * names are derived from them. A mesh shared by several nodes (all table legs)
 * uses their common prefix plus a collision suffix, never one arbitrary node.
 *
 * Shared by the GLB writer (which rewrites only the JSON chunk) and the `.gltf`
 * writer (which re-serialises the whole document), so both produce the same names.
 */
export function nameGltfMeshes(json: GltfNamingShape): void {
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
}

/** Rewrites only the JSON chunk of a GLB; the BIN chunk stays byte-identical. */
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
    const json = JSON.parse(new TextDecoder().decode(jsonChunk.bytes)) as GltfNamingShape;
    nameGltfMeshes(json);

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
 * Shared preparation for both glTF writers: reject unsafe geometry, add
 * tangents only where a normal map needs them, then apply the metre root.
 */
function prepareGltfScene(scene: THREE.Scene): void {
  assertFiniteGeometry(scene);
  assertExportableScene(scene);
  ensureTangentsForNormalMappedMeshes(scene);
  addMetreScaleRoot(scene);
}

/**
 * Serialise an already-built Three.js object group through the same GLB path
 * used by scene export. The caller owns the group and its geometries.
 */
export async function exportGroupToGlb(root: THREE.Object3D): Promise<ArrayBuffer> {
  const previousParent = root.parent;
  const scene = new THREE.Scene();
  scene.name = 'scene-export';
  scene.add(root);
  try {
    return await exportRootToGlb(scene);
  } finally {
    if (previousParent) {
      previousParent.add(root);
    } else {
      root.removeFromParent();
    }
  }
}

async function exportRootToGlb(scene: THREE.Scene): Promise<ArrayBuffer> {
  prepareGltfScene(scene);
  const GltfExporter = await loadGltfExporter();
  const exporter = new GltfExporter();

  let result: ArrayBuffer;
  try {
    const parsed = await exporter.parseAsync(scene, { binary: true });
    if (!(parsed instanceof ArrayBuffer)) {
      throw new Error('natija ikkilik formatda emas');
    }
    result = parsed;
  } catch (error) {
    // The exporter can fail on an unreadable texture image or a canvas without a
    // 2D backend. Keep the single typed error path instead of leaking a raw
    // exception through the UI.
    throw new ExportError(
      'failed',
      `GLB faylini yozib bo'lmadi. Material yoki tekstura ma'lumotini tekshiring. ${
        error instanceof Error ? error.message : ''
      }`.trim(),
    );
  }

  return nameExportedMeshes(result);
}

/**
 * Load every bitmap referenced by the exported objects and attach it to the
 * fresh export materials.
 *
 * Each object role is an independent acquisition, appended to `acquired` as
 * soon as it succeeds, so the caller releases everything even when a later role
 * fails. A role that cannot be loaded aborts the export with a clear error
 * instead of silently shipping a model missing that map.
 */
async function applyExportBitmapTextures(
  scene: THREE.Scene,
  objects: readonly SceneObject[],
  provider: TextureProvider,
  acquired: Array<{ ref: TextureAssetRef; options: TextureAcquireOptions }>,
): Promise<void> {
  const targets = objects.flatMap((object) => {
    if (!object.visible) {
      return [];
    }
    const group = scene.getObjectByName(`object:${object.id}`);
    if (!group) {
      return [];
    }
    const settings = resolvePresetSettings(object.material);
    return presentTextureMapRoles(object.material.maps).map((role) => {
      const ref = object.material.maps?.[role];
      return ref
        ? {
            object,
            group,
            role,
            ref,
            options: { repeat: settings.textureScale },
            normalStrength: settings.normalStrength,
            emissiveIntensity: settings.emissiveIntensity,
            emissiveColor: object.material.emissiveColor,
            aoIntensity: settings.aoIntensity,
          }
        : null;
    });
  }).filter((target): target is NonNullable<typeof target> => target !== null);

  const loaded = await Promise.all(
    targets.map(async (target) => {
      try {
        const texture = await provider.acquire(target.ref, target.options);
        acquired.push({ ref: target.ref, options: target.options });
        return Object.assign({}, target, { texture, error: null });
      } catch (error) {
        return Object.assign({}, target, { texture: null, error });
      }
    }),
  );

  for (const item of loaded) {
    if (!item.texture) {
      continue;
    }
    applyTextureMapToGroup(item.group, item.role, item.texture, {
      normalStrength: item.normalStrength,
      emissiveIntensity: item.emissiveIntensity,
      emissiveColor: item.emissiveColor,
      aoIntensity: item.aoIntensity,
    });
  }

  const failed = loaded.find((item) => item.texture === null);
  if (failed) {
    const roleLabel = TEXTURE_MAP_ROLE_LABELS[failed.role as TextureMapRole];
    throw new ExportError(
      'failed',
      `"${failed.object.name}" ${roleLabel} teksturasi (${failed.ref.id}@${failed.ref.version}) yuklanmadi; GLB eksporti bekor qilindi. ${
        failed.error instanceof Error ? failed.error.message : ''
      }`.trim(),
    );
  }
}

/**
 * Build a fresh export scene and attach the bitmap textures referenced by the
 * exported objects. The returned `dispose` releases both the textures acquired
 * from the provider and the scene's geometries/materials.
 *
 * Used by GLB and by the OBJ/MTL sidecar writer so both formats see the same
 * textured materials, on separate scene instances.
 */
export async function buildTexturedExportScene(
  data: SceneData,
  options: BuildExportOptions = {},
): Promise<ExportScene> {
  const built = buildExportScene(data, options);
  const objects = options.onlyObjectId
    ? data.objects.filter((object) => object.id === options.onlyObjectId)
    : data.objects;
  const provider = options.textureProvider ?? textureRegistry;
  const acquired: Array<{ ref: TextureAssetRef; options: TextureAcquireOptions }> = [];

  try {
    await applyExportBitmapTextures(built.scene, objects, provider, acquired);
  } catch (error) {
    for (const item of acquired) {
      provider.release(item.ref, item.options);
    }
    built.dispose();
    throw error;
  }

  return {
    scene: built.scene,
    dispose: () => {
      for (const item of acquired) {
        provider.release(item.ref, item.options);
      }
      built.dispose();
    },
  };
}

/**
 * Serialises the whole scene to binary glTF (.glb) bytes using Three.js'
 * official GLTFExporter. No backend or external API is involved. The temporary
 * export scene is disposed afterwards.
 *
 * A geometry safety check runs first: a NaN/Infinity coordinate is rejected with
 * `ExportError('invalid_geometry')` rather than written into a corrupt file.
 *
 * Referenced baseColor bitmaps are resolved *before* export and embedded by the
 * exporter; if one cannot be resolved the export fails instead of silently
 * shipping a textureless model.
 */
export async function exportSceneToGlb(
  data: SceneData,
  options: BuildExportOptions = {},
): Promise<ArrayBuffer> {
  const { scene, dispose } = await buildTexturedExportScene(data, options);
  try {
    return await exportRootToGlb(scene);
  } finally {
    dispose();
  }
}

/**
 * Serialises the same export scene as a textual glTF document.
 *
 * Identical content to the GLB — same nodes, materials, UVs and metre-scaled
 * root — but with buffers and images inlined as `data:` URIs, so the single file
 * is still self-contained. Some DCC importers and inspection tools are happier
 * with readable JSON, and a buyer can diff it.
 */
async function exportRootToGltf(scene: THREE.Scene): Promise<string> {
  prepareGltfScene(scene);
  const GltfExporter = await loadGltfExporter();

  let parsed: ArrayBuffer | Record<string, unknown>;
  try {
    parsed = await new GltfExporter().parseAsync(scene, { binary: false });
  } catch (error) {
    throw new ExportError(
      'failed',
      `glTF faylini yozib bo'lmadi. Material yoki tekstura ma'lumotini tekshiring. ${
        error instanceof Error ? error.message : ''
      }`.trim(),
    );
  }
  if (parsed instanceof ArrayBuffer || typeof parsed !== 'object' || parsed === null) {
    throw new ExportError('failed', 'glTF eksporti matnli hujjat qaytarmadi.');
  }

  nameGltfMeshes(parsed as GltfNamingShape);
  return JSON.stringify(parsed);
}

/** Serialises the whole scene to a self-contained `.gltf` document. */
export async function exportSceneToGltf(
  data: SceneData,
  options: BuildExportOptions = {},
): Promise<string> {
  const { scene, dispose } = await buildTexturedExportScene(data, options);
  try {
    return await exportRootToGltf(scene);
  } finally {
    dispose();
  }
}
