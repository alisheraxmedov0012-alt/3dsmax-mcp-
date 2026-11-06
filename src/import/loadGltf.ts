/**
 * Phase 6.2 — the loader boundary.
 *
 * `GLTFLoader` is the only code that turns bytes into scene objects, and it is
 * loaded on demand so the ~100 kB chunk stays out of the entry bundle (the same
 * rule the exporters follow). Everything around it is policy:
 *
 * - the document was validated *before* this module is called, so no decoder is
 *   ever asked for a Draco/meshopt/KTX2 payload;
 * - a `LoadingManager` resolves every reference from the in-memory resource map and
 *   refuses anything else, so a reference that slipped past the policy cannot
 *   become a network request;
 * - the blob URLs created for those references are revoked as soon as parsing
 *   finishes, so nothing is left pointing at memory that is about to be released.
 */
import * as THREE from 'three';
import { importFailure, ImportError } from './importErrors';
import { disposeImportedModel } from './importedModelStore';
import type { ResourceMap } from './resourceMap';

/** Schemes the loader may resolve without touching the network. */
const IN_MEMORY_SCHEMES = ['data:', 'blob:'] as const;

interface GltfLoaderModule {
  GLTFLoader: new (manager: THREE.LoadingManager) => {
    parseAsync: (data: ArrayBuffer | string, path: string) => Promise<{ scene: THREE.Group }>;
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
      "Model o'qish moduli yuklanmadi. Internet aloqasini tekshirib, qaytadan urinib ko'ring.",
    );
  }
}

export interface GltfLoadOptions {
  /**
   * The user's selected files. `null` means the model must be self-contained
   * (GLB): every external reference is then a policy violation.
   */
  resources?: ResourceMap | null;
  signal?: AbortSignal;
}

/**
 * Parses a validated GLB or glTF document into a detached Three.js scene.
 *
 * The returned group is owned by the caller until it is registered in the model
 * store; on failure nothing is returned and nothing is left allocated.
 */
export async function loadGltfScene(
  source: ArrayBuffer | string,
  options: GltfLoadOptions = {},
): Promise<THREE.Group> {
  const { resources = null, signal } = options;
  if (signal?.aborted) {
    throw importFailure('aborted');
  }

  const GLTFLoader = await loadGltfLoaderClass();

  // Every blob URL handed to the loader is tracked so it can be revoked exactly
  // once, after parsing, whether the parse succeeded or not.
  const objectUrls: string[] = [];

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (IN_MEMORY_SCHEMES.some((scheme) => url.startsWith(scheme))) {
      return url;
    }
    if (!resources) {
      throw importFailure(
        'external_resource',
        `Model "${url}" manbasini yuklamoqchi bo'ldi. Tashqi so'rov taqiqlangan.`,
      );
    }
    const found = resources.lookup(url);
    if (!found.ok) {
      // The policy should have caught this already; the modifier is the last line
      // of defence and never falls back to the network.
      throw importFailure(
        found.reason === 'ambiguous' ? 'ambiguous_resource' : 'missing_resource',
        `"${url}" resursi tanlangan fayllar orasida topilmadi.`,
      );
    }
    const blob = new Blob([found.bytes as unknown as BlobPart], {
      type: 'application/octet-stream',
    });
    const blobUrl = URL.createObjectURL(blob);
    objectUrls.push(blobUrl);
    return blobUrl;
  });

  let scene: THREE.Group;
  try {
    const gltf = await new GLTFLoader(manager).parseAsync(source, '');
    scene = gltf.scene;
  } catch (error) {
    if (error instanceof ImportError) {
      throw error;
    }
    throw importFailure(
      'malformed',
      "Model fayli o'qilmadi: " +
        (error instanceof Error ? error.message : 'noma’lum xato') +
        '.',
    );
  } finally {
    for (const url of objectUrls) {
      URL.revokeObjectURL(url);
    }
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
