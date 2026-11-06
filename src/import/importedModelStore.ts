/**
 * Phase 6.2 — the one owner of imported-model GPU resources.
 *
 * `SceneData` deliberately carries only metadata (a stored scene must fit in a
 * 2 MiB server payload and in `localStorage`, and it is hashed on every edit), so
 * the parsed Three.js hierarchy has to live somewhere else. This registry is that
 * somewhere: keyed by scene object id, exactly one entry per imported object.
 *
 * Ownership rules:
 *
 * - `register()` is the only way in, and it disposes any previous entry for the
 *   same id so an id can never hold two models.
 * - `acquire()` hands out a **clone**. Cloning shares geometry, materials and
 *   textures with the registered entry (`Object3D.clone()` does not copy buffers),
 *   so the viewer and an exporter can each hold their own hierarchy without a
 *   second GPU upload — and without one of them disposing the other's resources.
 * - `release()` is the only place resources are freed. Callers never dispose what
 *   they acquired.
 *
 * A model that is not registered resolves to `null`, which the builder turns into
 * an explicit `SceneObjectBuildError` instead of an empty object on screen.
 */
import * as THREE from 'three';

export interface ImportedModelEntry {
  /** Parsed hierarchy, already scaled to centimetres and centred on the origin. */
  readonly root: THREE.Object3D;
  /** Frees every geometry, material and texture under `root`. Idempotent. */
  dispose: () => void;
}

function texturesOf(material: THREE.Material): THREE.Texture[] {
  const found: THREE.Texture[] = [];
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    if (value instanceof THREE.Texture) {
      found.push(value);
    }
  }
  return found;
}

/**
 * Disposes everything a parsed model owns, each resource exactly once.
 *
 * Materials and textures are frequently shared between meshes (a glTF material is
 * referenced by every primitive that uses it), so deduplicating is not an
 * optimisation here — without it the second `dispose()` would touch an already
 * released GPU handle.
 */
export function disposeImportedModel(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();

  root.traverse((node) => {
    const renderable = node as Partial<THREE.Mesh>;
    if (renderable.geometry) {
      geometries.add(renderable.geometry);
    }
    const material = renderable.material;
    if (!material) {
      return;
    }
    for (const item of Array.isArray(material) ? material : [material]) {
      materials.add(item);
    }
  });

  const textures = new Set<THREE.Texture>();
  for (const material of materials) {
    for (const texture of texturesOf(material)) {
      textures.add(texture);
    }
  }

  for (const texture of textures) {
    texture.dispose();
  }
  for (const material of materials) {
    material.dispose();
  }
  for (const geometry of geometries) {
    geometry.dispose();
  }
}

export class ImportedModelStore {
  private readonly entries = new Map<string, ImportedModelEntry>();

  /** Registers a model, disposing whatever was registered for the id before. */
  register(objectId: string, entry: ImportedModelEntry): void {
    this.entries.get(objectId)?.dispose();
    this.entries.set(objectId, entry);
  }

  has(objectId: string): boolean {
    return this.entries.has(objectId);
  }

  get size(): number {
    return this.entries.size;
  }

  /** A hierarchy the caller may add to its own scene; `null` when not registered. */
  acquire(objectId: string): THREE.Object3D | null {
    const entry = this.entries.get(objectId);
    return entry ? entry.root.clone(true) : null;
  }

  /** Disposes and forgets the model. Returns false when nothing was registered. */
  release(objectId: string): boolean {
    const entry = this.entries.get(objectId);
    if (!entry) {
      return false;
    }
    this.entries.delete(objectId);
    entry.dispose();
    return true;
  }

  clear(): void {
    // Deleting the current key during Map iteration is defined behaviour: the
    // removed entry is simply not visited again.
    for (const id of this.entries.keys()) {
      this.release(id);
    }
  }
}

/**
 * App-wide registry.
 *
 * A module singleton rather than React state because both the viewer and the
 * export pipeline need it outside the component tree, and neither may own the
 * other. This mirrors `textureRegistry`, the established pattern for runtime
 * Three.js resources in this codebase.
 */
export const importedModelStore = new ImportedModelStore();
