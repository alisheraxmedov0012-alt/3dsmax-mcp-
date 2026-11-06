import * as THREE from 'three';
import type { MaterialSettingsInput } from '../materials/types';
import { buildFurniture } from '../geometry/furniture';
import { buildPlan } from '../geometry/universal/build';
import { createFurniturePlan } from '../geometry/universal/plan';
import { requireFurnitureDefinition } from '../geometry/universal/registry';
import {
  FurniturePlanError,
  type FurniturePlan,
  type FurnitureSlot,
} from '../geometry/universal/types';
import {
  IMPORTED_OBJECT_TYPE,
  isImportedSceneObject,
  type ImportedSceneObject,
  type ObjectMaterial,
  type SceneObject,
} from './types';

const DEG_TO_RAD = Math.PI / 180;

/**
 * Writes the user-visible name into `userData`, which glTF exporters serialise as
 * node `extras`.
 *
 * The node name is `object:<id>` — stable and unique, but a buyer opening the file
 * in Blender would only see a GUID. The display name ("Stol") is what a person
 * looks for, and `extras` is the standard place for it: it survives export, shows
 * up as a custom property in DCCs, and does not change the node-name contract.
 */
function applyExportIdentity(group: THREE.Object3D, object: SceneObject): void {
  if (typeof object.name === 'string' && object.name.trim() !== '') {
    group.userData.displayName = object.name;
  }
}

/** Raised when a scene object cannot be turned into geometry. */
export class SceneObjectBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SceneObjectBuildError';
  }
}

/**
 * Phase 6.2 — supplies the runtime geometry for imported objects.
 *
 * Declared in the scene layer on purpose: the scene model knows *that* imported
 * geometry can be resolved, not *how* it is stored. `src/import/importedModelStore`
 * satisfies this interface structurally, so `scene/` never imports `import/`.
 */
export interface ImportedGeometrySource {
  /** A hierarchy the caller may add to its own scene; `null` when not registered. */
  acquire(objectId: string): THREE.Object3D | null;
}

export interface BuildSceneObjectOptions {
  /** Required to build imported objects; ignored for parametric ones. */
  imported?: ImportedGeometrySource;
}

export interface BuiltSceneObject {
  group: THREE.Group;
  dispose: () => void;
  /** Present when the object was built from a universal definition. */
  readonly plan?: FurniturePlan;
}

/**
 * Applies an object's transform (position, rotation, scale) to a Three.js
 * group. Rotation is stored in degrees in the scene model and converted to
 * radians here. Kept separate so transforms can be updated without rebuilding
 * geometry.
 */
export function applyObjectTransform(group: THREE.Object3D, object: SceneObject): void {
  group.position.set(object.position.x, object.position.y, object.position.z);
  group.rotation.set(
    object.rotation.x * DEG_TO_RAD,
    object.rotation.y * DEG_TO_RAD,
    object.rotation.z * DEG_TO_RAD,
  );
  group.scale.set(object.scale.x, object.scale.y, object.scale.z);
  group.visible = object.visible;
}

/**
 * Identity of everything that changes the built geometry of an object.
 *
 * Callers (the viewer) rebuild only when this key changes, so it must include the
 * universal channels as well: editing a spec while `params` stays put would
 * otherwise leave stale geometry on screen.
 */
export function sceneObjectBuildKey(object: SceneObject): string {
  return JSON.stringify([
    object.definitionId ?? null,
    object.spec ?? null,
    object.params,
    object.material,
    // Phase 6.2: a different source file is different geometry. Nothing else about
    // an imported object affects the build.
    object.imported?.sourceHash ?? null,
  ]);
}

/**
 * Identity of the geometry only. Material and base colour are updated in place
 * on the existing meshes (Phase 4.6), so they are deliberately excluded: a
 * slider drag must never allocate or dispose a BufferGeometry.
 */
export function sceneObjectGeometryKey(object: SceneObject): string {
  if (object.imported) {
    // Imported geometry cannot be edited in place, so the model hash alone decides
    // whether the objects in the scene still match the registered model.
    return JSON.stringify(['imported', object.imported.sourceHash]);
  }
  const params = { ...object.params } as Record<string, unknown>;
  // `color` drives the material, not the vertex positions.
  delete params.color;
  return JSON.stringify([object.definitionId ?? null, object.spec ?? null, params]);
}

/**
 * Per-slot material settings for a universal build.
 *
 * `buildPlan` merges this over `{ materialId: slot.materialId }`, so an explicit
 * `undefined` would overwrite the slot preset (a wood slot would lose its oak
 * texture, a glass slot its opacity). The id is therefore always concrete, and
 * the optional channels are only passed when they are actually set.
 */
function slotMaterialOverride(
  material: ObjectMaterial,
  slot: FurnitureSlot,
): MaterialSettingsInput {
  const override: MaterialSettingsInput = {
    materialId: material.materialId ?? slot.materialId,
    metalness: material.metalness,
    roughness: material.roughness,
  };
  if (material.opacity !== undefined) {
    override.opacity = material.opacity;
  }
  if (material.textureScale !== undefined) {
    override.textureScale = material.textureScale;
  }
  if (material.normalStrength !== undefined) {
    override.normalStrength = material.normalStrength;
  }
  if (material.emissiveIntensity !== undefined) {
    override.emissiveIntensity = material.emissiveIntensity;
  }
  if (material.aoIntensity !== undefined) {
    override.aoIntensity = material.aoIntensity;
  }
  if (material.baseColor !== undefined) {
    override.baseColor = material.baseColor;
  }
  if (material.emissiveColor !== undefined) {
    override.emissiveColor = material.emissiveColor;
  }
  return override;
}

function buildUniversalSceneObject(object: SceneObject): BuiltSceneObject {
  const { definitionId, spec } = object;
  if (definitionId === undefined || spec === undefined) {
    throw new FurniturePlanError(
      'invalid_plan',
      `"${object.id}": definitionId va spec birga bo'lishi kerak.`,
    );
  }

  const plan = createFurniturePlan(definitionId, spec);
  const definition = requireFurnitureDefinition(plan.definitionId);

  const materialOverrides: Record<string, MaterialSettingsInput> = {};
  for (const slot of definition.slots) {
    materialOverrides[slot.id] = slotMaterialOverride(object.material, slot);
  }

  const built = buildPlan(plan, { materialOverrides });
  built.group.name = `object:${object.id}`;
  built.group.userData.sceneObjectId = object.id;
  built.group.userData.definitionId = plan.definitionId;
  applyExportIdentity(built.group, object);

  applyObjectTransform(built.group, object);

  return { group: built.group, dispose: built.dispose, plan };
}

/**
 * Builds the Three.js representation of a scene object.
 *
 * Dispatches on the stored universal fields: an object with `definitionId` and
 * `spec` is built from the universal plan (the plan is the single source of its
 * geometry), everything else goes through the parametric builder for its W2
 * furniture type. Partial universal fields and unbuildable specs throw, so a bad
 * scene is surfaced rather than silently rendered as something else.
 */
/**
 * Builds the Three.js representation of an imported object.
 *
 * The model is wrapped in a group so the scene transform, the object name and
 * `userData.sceneObjectId` are applied at one level, exactly like every other
 * object, while the imported hierarchy and its node names stay untouched.
 *
 * The returned `dispose` is intentionally empty: geometry, materials and textures
 * are owned by the runtime store, and only that store may release them. Disposing
 * here would break every other view of the same model.
 */
function buildImportedSceneObject(
  object: ImportedSceneObject,
  source: ImportedGeometrySource | undefined,
): BuiltSceneObject {
  const model = source?.acquire(object.id) ?? null;
  if (!model) {
    throw new SceneObjectBuildError(
      `"${object.id}": import qilingan model geometriyasi topilmadi.`,
    );
  }

  const group = new THREE.Group();
  group.add(model);
  group.name = `object:${object.id}`;
  group.userData.sceneObjectId = object.id;
  group.userData.importedFormat = object.imported.format;
  applyExportIdentity(group, object);

  applyObjectTransform(group, object);

  return { group, dispose: () => undefined };
}

export function buildSceneObject(
  object: SceneObject,
  options: BuildSceneObjectOptions = {},
): BuiltSceneObject {
  // Imported objects are checked first: their geometry never comes from a spec or
  // from furniture parameters, so a stray `definitionId` must not win.
  if (isImportedSceneObject(object)) {
    return buildImportedSceneObject(object, options.imported);
  }
  if (object.type === IMPORTED_OBJECT_TYPE) {
    // Validation drops such a record; reaching here means a caller bypassed it.
    throw new SceneObjectBuildError(
      `"${object.id}": import qilingan model ma'lumotlari to'liq emas.`,
    );
  }

  if (object.definitionId !== undefined || object.spec !== undefined) {
    return buildUniversalSceneObject(object);
  }

  const built = buildFurniture(object.type, object.params, object.material);
  built.group.name = `object:${object.id}`;
  built.group.userData.sceneObjectId = object.id;
  applyExportIdentity(built.group, object);

  applyObjectTransform(built.group, object);

  return built;
}
