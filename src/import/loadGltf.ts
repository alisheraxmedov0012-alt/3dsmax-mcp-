/**
 * Phase 6.2 — the loader boundary.
 *
 * `GLTFLoader` is the only code that turns bytes into scene objects, and it is
 * loaded on demand so the ~100 kB chunk stays out of the entry bundle (the same
 * rule the exporters follow). Two guards sit around it:
 *
 * - a `LoadingManager` that refuses any URL which is not already in memory, so a
 *   reference that slipped past the document policy cannot become a network
 *   request, and
 * - a size/format policy applied to the JSON *before* this module is called
 *   (`glbInspect`), so no decoder is ever asked for a Draco/meshopt/KTX2 payload.
 */
import * as THREE from 'three';
import { importFailure, ImportError } from './importErrors';
import { disposeImportedModel } from './importedModelStore';

/** Schemes the loader may resolve without touching the network. */
const IN_MEMORY_SCHEMES = ['data:', 'blob:'] as const;

interface GltfLoaderModule {
  GLTFLoader: new (manager: THREE.LoadingManager) => {
    parseAsync: (data: ArrayBuffer, path: string) => Promise<{ scene: THREE.Group }>;
  };
}

async function loadGltfLoaderClass(): Promise<GltfLoaderModule['GLTFLoader']> {
  try {
    const module = (await import('three/examples/jsm/loaders/GLTFLoader.js')) as GltfLoaderModule;
    return module.GLTFLoader;
  } catch {
    // A failed chunk request is recoverable (offline, stale deployment) and must
    // read like any other import failure, not like a corrupt file.
    throw importFailure(
      'failed',
      "GLB o'qish moduli yuklanmadi. Internet aloqasini tekshirib, qaytadan urinib ko'ring.",
    );
  }
}

/**
 * Parses a validated GLB into a detached Three.js scene.
 *
 * The returned group is owned by the caller until it is registered in the model
 * store; on failure nothing is returned and nothing is left allocated.
 */
export async function loadGlbScene(
  bytes: ArrayBuffer,
  signal?: AbortSignal,
): Promise<THREE.Group> {
  if (signal?.aborted) {
    throw importFailure('aborted');
  }

  const GLTFLoader = await loadGltfLoaderClass();

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (IN_MEMORY_SCHEMES.some((scheme) => url.startsWith(scheme))) {
      return url;
    }
    throw importFailure(
      'external_resource',
      `Model "${url}" manbasini yuklamoqchi bo'ldi. Tashqi so'rov taqiqlangan.`,
    );
  });

  let scene: THREE.Group;
  try {
    const gltf = await new GLTFLoader(manager).parseAsync(bytes, '');
    scene = gltf.scene;
  } catch (error) {
    if (error instanceof ImportError) {
      throw error;
    }
    throw importFailure(
      'malformed',
      "GLB fayli o'qilmadi: " +
        (error instanceof Error ? error.message : 'noma’lum xato') +
        '.',
    );
  }

  if (!scene || !Array.isArray(scene.children) || scene.children.length === 0) {
    throw importFailure('malformed', 'Model bo‘sh: hech qanday obyekt topilmadi.');
  }

  if (signal?.aborted) {
    disposeImportedModel(scene);
    throw importFailure('aborted');
  }

  return scene;
}
