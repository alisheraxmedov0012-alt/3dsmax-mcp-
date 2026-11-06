/**
 * Phase 6.2.3 — OBJ + MTL into a Three.js group.
 *
 * Geometry is parsed by `OBJLoader` (it handles `v/vt/vn`, negative indices,
 * `o`/`g` grouping and face triangulation — reimplementing that would be a second
 * geometry kernel). Materials are ours:
 *
 * - MTL text is tokenised by `MTLLoader.parse` but converted by `parseMtlDocument`,
 *   so textures come only from the selected files and the result is a
 *   `MeshStandardMaterial` rather than a Phong approximation;
 * - the loader receives a tiny material *factory* instead of an MTL creator, so a
 *   missing material becomes our neutral default instead of a Phong material that
 *   behaves differently from the rest of the scene.
 *
 * Every resource is looked up in the `ResourceMap`; nothing here can touch the
 * filesystem or the network.
 */
import * as THREE from 'three';
import type { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { importFailure } from './importErrors';
import { parseMtlDocument, type MtlMaterial } from './mtl';
import type { ResourceMap } from './resourceMap';
import {
  decodeTextureInBrowser,
  resolveTextures,
  type TextureDecoder,
} from './textureDecode';

export interface ObjLoadOptions {
  readonly resources: ResourceMap;
  readonly mtlLibraries: readonly string[];
  readonly decode?: TextureDecoder;
  readonly signal?: AbortSignal;
}

export interface LoadedObj {
  readonly group: THREE.Group;
  readonly materialCount: number;
  readonly meshCount: number;
  /** Distinct textures actually decoded and attached. */
  readonly textureCount: number;
  /** Textures the materials reference that could not be applied. */
  readonly missingTextureCount: number;
  /** Textures the materials reference, applied or not. */
  readonly expectedTextureCount: number;
  readonly warnings: readonly string[];
}

interface ObjLoaderModule {
  OBJLoader: new () => {
    setMaterials: (materials: MTLLoader.MaterialCreator) => unknown;
    parse: (text: string) => THREE.Group;
  };
}

async function loadObjLoaderClass(): Promise<ObjLoaderModule['OBJLoader']> {
  try {
    const module = (await import('three/examples/jsm/loaders/OBJLoader.js')) as ObjLoaderModule;
    return module.OBJLoader;
  } catch {
    throw importFailure(
      'failed',
      "OBJ o'qish moduli yuklanmadi. Internet aloqasini tekshirib, qaytadan urinib ko'ring.",
    );
  }
}

function decodeText(bytes: Uint8Array): string {
  // MTL/OBJ are not guaranteed to be UTF-8; replacement characters in a material
  // name are harmless, a rejected file is not.
  return new TextDecoder('utf-8').decode(bytes);
}

/** Builds one standard material from a parsed MTL record. */
function materialFrom(
  spec: MtlMaterial,
  textures: ReadonlyMap<string, THREE.Texture>,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(spec.baseColor[0], spec.baseColor[1], spec.baseColor[2]),
    roughness: spec.roughness,
    metalness: spec.metalness,
    transparent: spec.opacity < 1,
    opacity: spec.opacity,
    side: THREE.DoubleSide,
  });
  material.name = spec.name;

  const base = spec.baseColorMap ? textures.get(spec.baseColorMap) : undefined;
  if (base) {
    material.map = base;
  }
  const normal = spec.normalMap ? textures.get(spec.normalMap) : undefined;
  if (normal) {
    material.normalMap = normal;
  }
  if (spec.emissive) {
    material.emissive = new THREE.Color(spec.emissive[0], spec.emissive[1], spec.emissive[2]);
  }
  material.needsUpdate = true;
  return material;
}

/**
 * Parses the OBJ geometry and its materials.
 *
 * The returned group owns its materials and textures; the caller disposes them
 * through the model store, exactly like an imported GLB.
 */
export async function loadObjScene(
  text: string,
  options: ObjLoadOptions,
): Promise<LoadedObj> {
  const { resources, mtlLibraries, signal } = options;
  const decode = options.decode ?? decodeTextureInBrowser;
  const warnings: string[] = [];

  if (signal?.aborted) {
    throw importFailure('aborted');
  }

  // 1. Material definitions, merged in file order. A later library cannot silently
  //    replace an earlier one: the first definition of a name wins and the clash
  //    is reported.
  const specs = new Map<string, MtlMaterial>();
  for (const library of mtlLibraries) {
    const bytes = resources.bytesOf(library);
    if (!bytes) {
      warnings.push(`"${library}" material fayli topilmadi — materiallar qo‘llanmadi.`);
      continue;
    }
    const parsed = parseMtlDocument(decodeText(bytes), library);
    warnings.push(...parsed.warnings);
    for (const [name, spec] of parsed.materials) {
      if (specs.has(name)) {
        warnings.push(`"${name}" materiali bir nechta MTL faylida — birinchisi ishlatildi.`);
        continue;
      }
      specs.set(name, spec);
    }
  }

  if (signal?.aborted) {
    throw importFailure('aborted');
  }

  // 2. Textures, deduplicated across materials.
  const baseColorPaths: string[] = [];
  const normalPaths: string[] = [];
  for (const spec of specs.values()) {
    if (spec.baseColorMap) {
      baseColorPaths.push(spec.baseColorMap);
    }
    if (spec.normalMap) {
      normalPaths.push(spec.normalMap);
    }
  }

  const createdTextures: THREE.Texture[] = [];
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  // One budget for both passes, so a model cannot double the pixel allowance by
  // splitting its maps between colour and normal.
  const textureBudget = { pixels: 0 };

  try {
    const base = await resolveTextures(
      baseColorPaths,
      (path) => resources.bytesOf(path),
      decode,
      true,
      textureBudget,
    );
    warnings.push(...base.warnings);
    createdTextures.push(...base.textures.values());

    const normal = await resolveTextures(
      normalPaths,
      (path) => resources.bytesOf(path),
      decode,
      false,
      textureBudget,
    );
    warnings.push(...normal.warnings);
    createdTextures.push(...normal.textures.values());

    const textures = new Map<string, THREE.Texture>([...base.textures, ...normal.textures]);
    for (const spec of specs.values()) {
      materials.set(spec.name, materialFrom(spec, textures));
    }

    if (signal?.aborted) {
      throw importFailure('aborted');
    }

    // 3. Geometry. The loader asks this factory for a material by `usemtl` name.
    const fallback = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.78, 0.78, 0.78),
      roughness: 0.65,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    fallback.name = 'obj-default';
    const factory = {
      create: (name: string): THREE.Material => materials.get(name) ?? fallback,
    };

    const OBJLoader = await loadObjLoaderClass();
    const loader = new OBJLoader();
    // OBJLoader only calls `create(name)`; the MTL creator type is the shipped
    // contract, and this adapter satisfies exactly that call.
    loader.setMaterials(factory as unknown as MTLLoader.MaterialCreator);

    let group: THREE.Group;
    try {
      group = loader.parse(text);
    } catch {
      throw importFailure('malformed', 'OBJ geometriyasi o‘qilmadi.');
    }
    if (group.children.length === 0) {
      throw importFailure('malformed', 'OBJ faylida geometriya yo‘q.');
    }

    group.name = 'imported-model';

    let meshCount = 0;
    group.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        meshCount += 1;
      }
    });

    if (meshCount === 0) {
      throw importFailure('malformed', 'OBJ faylida yuzlar topilmadi.');
    }

    const appliedTextures = new Set(createdTextures).size;
    const expectedTextures = new Set([...baseColorPaths, ...normalPaths]).size;

    return {
      group,
      materialCount: materials.size,
      meshCount,
      textureCount: appliedTextures,
      missingTextureCount: Math.max(0, expectedTextures - appliedTextures),
      expectedTextureCount: expectedTextures,
      warnings,
    };
  } catch (error) {
    // Nothing reached the scene, so the textures built here are ours to release.
    for (const texture of createdTextures) {
      texture.dispose();
    }
    for (const material of materials.values()) {
      material.dispose();
    }
    throw error;
  }
}
