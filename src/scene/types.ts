import { TABLE_DEFAULTS } from '../geometry/tableParams';
import {
  FURNITURE_DEFAULT_NAMES,
  createFurnitureParams,
  type FurnitureParams,
  type FurnitureType,
} from '../geometry/furniture/types';
import type { MaterialPresetId } from '../materials/types';
import type { MaterialAssetMaps } from '../materials/asset';
import type { SheetMaterialEntry } from '../manufacturing/sheetMaterial';
import type { HardwareItem } from '../manufacturing/hardware';
import { requireFurnitureDefinition } from '../geometry/universal/registry';
import { FurniturePlanError } from '../geometry/universal/types';
import { createDefaultSettings, type SceneSettings } from './sceneSettings';

/**
 * Scene data model (Stage 5).
 *
 * Coordinate convention (right-handed, Y up, all lengths in centimetres):
 * - The room floor is the Y = 0 plane.
 * - The room is centred on the X/Z origin: x ∈ [-width/2, width/2],
 *   z ∈ [-length/2, length/2], walls rise along +Y to `heightCm`.
 * - Object `position` translates the object's origin, which rests on the floor
 *   (y = 0 means "standing on the floor").
 * - `rotation` is stored in DEGREES (Euler XYZ) for readability; the viewer
 *   converts it to radians when applying the transform.
 * - `scale` is a unitless multiplier per axis.
 *
 * This model is intentionally free of Three.js types so it can be serialized,
 * validated and tested without a WebGL context.
 */

export const IMPORTED_OBJECT_TYPE = 'imported';

/**
 * Scene object types are the W2 furniture vocabulary plus the Phase 6.2
 * `imported` kind.
 *
 * An imported model is a full scene object (id, name, transform, visibility) but
 * its geometry comes from a file authored elsewhere. That geometry is **not**
 * stored in `SceneData`: it lives in the runtime store
 * (`src/import/importedModelStore.ts`) because the scene is persisted inside a
 * 2 MiB server payload and a `localStorage` quota, and is hashed on every edit.
 * `SceneData` therefore carries only `ImportedModelMeta`.
 *
 * `type` is the discriminator, so TypeScript forces every parametric-only call
 * site (`buildFurniture`, parameter editors, BOM/cut-list) to decide explicitly
 * what it does with an imported object instead of silently treating it as
 * furniture.
 */
export type SceneObjectType = FurnitureType | typeof IMPORTED_OBJECT_TYPE;

/** Explicit object-kind marker; omitted for parametric objects so legacy JSON is unchanged. */
export const SCENE_OBJECT_KINDS = ['parametric', 'imported'] as const;

export type SceneObjectKind = (typeof SCENE_OBJECT_KINDS)[number];

export const IMPORTED_DEFAULT_NAME = 'Import qilingan model';

/** Upper bound accepted for a stored bounding box, per axis, in centimetres. */
export const IMPORTED_BOUNDS_LIMIT_CM = 100_000;

/**
 * Phase 6.2 — what a saved scene remembers about an imported model.
 *
 * Descriptive only. The mesh itself is runtime state; a reload cannot restore it,
 * which is why the UI says so before the import is confirmed.
 */
export interface ImportedModelBounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** Containers this build can import into the scene. */
export const IMPORTED_MODEL_FORMATS = ['glb', 'gltf', 'obj'] as const;

export type ImportedModelFormat = (typeof IMPORTED_MODEL_FORMATS)[number];

export interface ImportedModelMeta {
  readonly format: ImportedModelFormat;
  readonly fileName: string;
  readonly sourceBytes: number;
  readonly meshes: number;
  readonly triangles: number;
  readonly materials: number;
  readonly textures: number;
  /** SHA-256 of the source bytes, so a rebuild only happens for different geometry. */
  readonly sourceHash: string;
  readonly boundsCm: ImportedModelBounds;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type RoomWall = 'north' | 'south' | 'east' | 'west';

export const ROOM_WALLS: readonly RoomWall[] = ['north', 'east', 'south', 'west'];

export type OpeningKind = 'door' | 'window';

/** A door/window *model* entry on a wall (see the room builder for rendering). */
export interface RoomOpening {
  id: string;
  kind: OpeningKind;
  wall: RoomWall;
  /** Centre offset along the wall from the room centre (cm). */
  offsetCm: number;
  widthCm: number;
  heightCm: number;
  /** Distance of the opening's bottom edge from the floor (cm); 0 for doors. */
  sillCm: number;
}

export const OPENING_LIMITS = {
  offsetCm: { min: -2000, max: 2000, step: 5 },
  widthCm: { min: 40, max: 400, step: 5 },
  heightCm: { min: 40, max: 400, step: 5 },
  sillCm: { min: 0, max: 300, step: 5 },
} satisfies Record<'offsetCm' | 'widthCm' | 'heightCm' | 'sillCm', NumericRange>;

/**
 * Max manufacturing-material assignments per object.
 *
 * A safety cap like the room/assembly limits: a workshop piece has a handful of
 * part groups, so anything beyond this indicates corrupted stored data.
 */
export const MAX_SHEET_MATERIALS_PER_OBJECT = 40;

export const MAX_OPENINGS_PER_ROOM = 12;

/**
 * W14 — assembly kinds. An assembly is a multi-part construction built from one
 * parametric description; it is *not* a new furniture type (see
 * `W14_IMPLEMENTATION_PLAN.md` D2).
 */
export const ASSEMBLY_KINDS = [
  'kitchen-base-run',
  'wall-cabinet',
  'wardrobe-section',
  'stair-straight',
] as const;

export type AssemblyKind = (typeof ASSEMBLY_KINDS)[number];

/**
 * W14 — a stored assembly.
 *
 * Only the parametric description is persisted. Member objects are derived
 * deterministically by `buildAssembly()` at load time, which keeps the scene
 * inside the server's object budget (`MAX_OBJECTS = 500` in
 * `backend/app/services/scene_payload.py`). See plan D6.
 *
 * The field is additive and optional on `SceneData`, so scenes saved before W14
 * keep loading unchanged.
 */
export interface SceneAssembly {
  id: string;
  kind: AssemblyKind;
  params: Record<string, unknown>;
}

/** Upper bound on assemblies per scene (frontend and backend agree on 20). */
export const MAX_ASSEMBLIES_PER_SCENE = 20;

export function isAssemblyKind(value: unknown): value is AssemblyKind {
  return typeof value === 'string' && (ASSEMBLY_KINDS as readonly string[]).includes(value);
}

export interface RoomConfig {
  /** Room extent along X (cm). */
  widthCm: number;
  /** Room extent along Z (cm). */
  lengthCm: number;
  /** Wall height along Y (cm). */
  heightCm: number;
  /** W6: draw a ceiling slab. */
  showCeiling?: boolean;
  /**
   * W6: extensible door/window model. Purely descriptive here — the room builder
   * draws thin markers on the wall to show the positions; they are NOT real
   * holes cut out of the wall geometry (documented, deferred).
   */
  openings?: RoomOpening[];
}

/** A JSON scalar stored inside a universal furniture spec. */
export type SceneSpecValue = string | number | boolean;

/** Stage 3.0: a flat, serializable furniture spec (no nested objects). */
export type SceneSpec = Readonly<Record<string, SceneSpecValue>>;

export const MAX_DEFINITION_ID_LENGTH = 64;
export const MAX_SPEC_KEYS = 64;
export const MAX_SPEC_KEY_LENGTH = 64;
export const MAX_SPEC_STRING_LENGTH = 120;

/**
 * Structural normalizer for untrusted spec input.
 *
 * A spec is stored in the scene JSON and re-parsed by its definition on load, so
 * it must be plain JSON scalars: no nested objects/arrays, no NaN/Infinity, no
 * unknown prototypes. The definition itself remains the only thing that decides
 * whether the *values* make a buildable piece (`parseSpec`), this only bounds the
 * shape so a corrupt payload cannot reach it. Returns null instead of throwing.
 */
export function normalizeSceneSpec(value: unknown): SceneSpec | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length > MAX_SPEC_KEYS) {
    return null;
  }

  const spec: Record<string, SceneSpecValue> = {};
  for (const key of keys) {
    if (key.trim() === '' || key.length > MAX_SPEC_KEY_LENGTH) {
      return null;
    }
    const raw = record[key];
    if (typeof raw === 'boolean') {
      spec[key] = raw;
      continue;
    }
    if (typeof raw === 'string') {
      if (raw.length > MAX_SPEC_STRING_LENGTH) {
        return null;
      }
      spec[key] = raw;
      continue;
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      spec[key] = raw;
      continue;
    }
    return null;
  }
  return spec;
}

export interface SceneObject {
  id: string;
  type: SceneObjectType;
  name: string;
  position: Vec3;
  /** Euler XYZ rotation in degrees. */
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
  params: FurnitureParams;
  /**
   * PBR material overrides (metalness/roughness). Base colour is `params.color` for
   * legacy objects and the definition slot colour for universal ones.
   */
  material: ObjectMaterial;
  /**
   * C3 board material per part group (what the piece is *made of*), independent
   * of the PBR `material` above (how it *looks*). Optional so projects saved
   * before C3 stay valid; absent means "no material assigned", not a default.
   */
  sheetMaterials?: SheetMaterialEntry[];
  /**
   * C6 fastening hardware for this piece. Optional so existing projects load
   * unchanged; absent/empty means the explicit "not specified" state.
   */
  hardware?: HardwareItem[];
  /**
   * Stage 3.0: universal definition id (e.g. `desk.computer`). Set together with
   * `spec` or not at all. When set, the geometry is built from the definition and
   * `params` is only the legacy projection (read by the legacy panels) — it does
   * not drive this object's geometry.
   */
  definitionId?: string;
  /** Stage 3.0: validated, canonical spec for `definitionId`. */
  spec?: SceneSpec;
  /**
   * Phase 6.2: explicit kind marker. Always `'imported'` for imported objects and
   * omitted entirely for parametric ones, so legacy scene JSON round-trips
   * unchanged. `type` remains the discriminator the compiler narrows on.
   */
  kind?: SceneObjectKind;
  /**
   * Phase 6.2: descriptive metadata for an imported model. Set together with
   * `type: 'imported'` or not at all. It never carries geometry — see
   * {@link ImportedModelMeta}.
   */
  imported?: ImportedModelMeta;
}

/** A scene object whose geometry is built from furniture parameters or a spec. */
export interface FurnitureSceneObject extends SceneObject {
  type: FurnitureType;
  imported?: undefined;
}

/** A scene object whose geometry comes from an imported model file. */
export interface ImportedSceneObject extends SceneObject {
  type: typeof IMPORTED_OBJECT_TYPE;
  kind: 'imported';
  imported: ImportedModelMeta;
}

/**
 * Phase 6.2 — narrows to an imported object.
 *
 * `type` is the single source of truth (it is what the compiler checks at
 * `buildFurniture(object.type, …)` and every furniture-only lookup), so a stored
 * `kind` that disagrees with it cannot create an object that type-checks
 * incorrectly. Validation rejects and normalises such records.
 */
export function isImportedSceneObject(object: SceneObject): object is ImportedSceneObject {
  return object.type === IMPORTED_OBJECT_TYPE && object.imported !== undefined;
}

/** Phase 6.2 — narrows to a parametric object, for every furniture-only path. */
export function isFurnitureSceneObject(object: SceneObject): object is FurnitureSceneObject {
  return object.type !== IMPORTED_OBJECT_TYPE;
}

export interface ObjectMaterial {
  metalness: number;
  roughness: number;
  /**
   * W4 PBR channels. All optional so Stage 6 projects (which only stored
   * metalness/roughness) stay valid; the renderer resolves any missing value to
   * its default. Base colour / albedo is the object's `params.color`.
   */
  materialId?: MaterialPresetId;
  opacity?: number;
  textureScale?: number;
  normalStrength?: number;
  /** Phase 4.5/4.6: multiplier for the emissive map. */
  emissiveIntensity?: number;
  /** Phase 4.6: multiplier for the AO (or ORM red) channel. */
  aoIntensity?: number;
  /** Phase 4.6: per-object base-colour override (hex). */
  baseColor?: string;
  /** Phase 4.6: emissive tint (hex); an emissive map renders white by default. */
  emissiveColor?: string;
  /** Phase 8B.2: opt into the product's baked 2K PBR material maps. */
  premiumTextures?: boolean;
  /**
   * Phase 4.3/4.5: serializable bitmap texture references (no binary data).
   * Every map role is a `TextureAssetRef`; the type is shared with MaterialAsset
   * v1 so stored values go through the same validation. Optional so every
   * pre-4.3 scene loads unchanged.
   */
  maps?: MaterialAssetMaps;
}

export const MATERIAL_DEFAULTS: ObjectMaterial = { metalness: 0.05, roughness: 0.6 };

export const MATERIAL_LIMITS = {
  metalness: { min: 0, max: 1, step: 0.01 },
  roughness: { min: 0, max: 1, step: 0.01 },
} satisfies Record<'metalness' | 'roughness', NumericRange>;

export interface SceneData {
  schemaVersion: number;
  room: RoomConfig;
  objects: SceneObject[];
  settings: SceneSettings;
  /**
   * W14: assemblies stored with the scene. Optional — a scene saved before W14
   * has no such field and loads with `undefined` (no assemblies).
   */
  assemblies?: SceneAssembly[];
}

/**
 * Stage 3.4 — one applied spec change, as the history stack records it.
 *
 * Only applied changes are stored (a preview or a rejected edit never is), and
 * both sides are canonical specs, so undo/redo restores an exact configuration
 * instead of re-deriving one.
 */
export interface SpecHistoryEntry {
  readonly objectId: string;
  readonly before: SceneSpec;
  readonly after: SceneSpec;
}

export interface SpecHistory {
  readonly past: readonly SpecHistoryEntry[];
  readonly future: readonly SpecHistoryEntry[];
}

/** Bounded so a long editing session cannot grow without limit. */
export const MAX_SPEC_HISTORY = 50;

/** Runtime scene state: persisted data plus transient selection and history. */
export interface SceneState {
  data: SceneData;
  selectedId: string | null;
  /** Undo/redo stack for spec edits; runtime-only, never serialized. */
  history?: SpecHistory;
}

export const SCENE_SCHEMA_VERSION = 3;

/** Pseudo-id used to select the room itself in the hierarchy / viewer. */
export const ROOM_OBJECT_ID = 'room';

export interface NumericRange {
  min: number;
  max: number;
  step: number;
}

/** @deprecated kept as an alias; use {@link NumericRange}. */
export type RoomRange = NumericRange;

export const ROOM_LIMITS = {
  widthCm: { min: 100, max: 2000, step: 10 },
  lengthCm: { min: 100, max: 2000, step: 10 },
  heightCm: { min: 100, max: 600, step: 10 },
} satisfies Record<'widthCm' | 'lengthCm' | 'heightCm', NumericRange>;

export const ROOM_DEFAULTS: RoomConfig = {
  widthCm: 400,
  lengthCm: 500,
  heightCm: 280,
};

export const OBJECT_LIMITS = {
  position: { min: -2000, max: 2000, step: 5 },
  rotation: { min: 0, max: 360, step: 5 },
  scale: { min: 0.1, max: 10, step: 0.1 },
};

export const OBJECT_NAME_MAX_LENGTH = 60;

export const TABLE_OBJECT_DEFAULT_NAME = 'Stol';

export function createRoomConfig(partial?: Partial<RoomConfig>): RoomConfig {
  return { ...ROOM_DEFAULTS, ...partial };
}

export function createTableSceneObject(
  id: string,
  overrides: Partial<Omit<SceneObject, 'id' | 'type' | 'kind' | 'imported'>> = {},
): FurnitureSceneObject {
  return {
    id,
    type: 'table',
    name: TABLE_OBJECT_DEFAULT_NAME,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    params: { ...TABLE_DEFAULTS },
    material: { ...MATERIAL_DEFAULTS },
    ...overrides,
  };
}

/** Creates a scene object of any W2 furniture type with that type's defaults. */
export function createFurnitureSceneObject(
  type: FurnitureType,
  id: string,
  overrides: Partial<Omit<SceneObject, 'id' | 'type' | 'kind' | 'imported'>> = {},
): FurnitureSceneObject {
  return {
    id,
    type,
    name: FURNITURE_DEFAULT_NAMES[type],
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    params: createFurnitureParams(type),
    material: { ...MATERIAL_DEFAULTS },
    ...overrides,
  };
}

/**
 * Stage 3.0 — creates a scene object driven by a universal definition.
 *
 * `spec` is parsed (and canonicalised) by the definition, so the stored object
 * always carries a complete, validated spec; an invalid or partial input throws
 * instead of producing an object that cannot be built. `params` stays the family
 * default projection for the legacy panels and never overrides the spec.
 *
 * The definition registry is populated by the scene pipeline (validation and the
 * builder import the plan module), so an unknown id here means genuinely unknown,
 * not "not loaded yet".
 */
export function createUniversalSceneObject(
  definitionId: string,
  id: string,
  spec: unknown = undefined,
  overrides: Partial<Omit<SceneObject, 'id' | 'type' | 'kind' | 'imported'>> = {},
): SceneObject {
  const definition = requireFurnitureDefinition(definitionId);
  const parsed = definition.parseSpec(spec === undefined ? definition.defaults : spec);
  if (!parsed.ok) {
    throw new FurniturePlanError('invalid_spec', parsed.errors.join(' '));
  }
  const canonical = normalizeSceneSpec(parsed.spec);
  if (!canonical) {
    throw new FurniturePlanError(
      'invalid_spec',
      `"${definitionId}": spec canonical shaklga keltirilmadi.`,
    );
  }

  const object = createFurnitureSceneObject(definition.family, id, {
    name: definition.label,
    ...overrides,
  });
  return { ...object, definitionId: definition.id, spec: canonical };
}

/**
 * Phase 6.2 — creates an imported-model scene object.
 *
 * `params` is filled with the table defaults purely because the field is required
 * on `SceneObject`: it is a legacy projection that no imported object ever reads
 * (every parametric path is gated by {@link isFurnitureSceneObject}). Passing a
 * real furniture type here would be dishonest — the geometry is not that piece.
 *
 * The metadata is expected to be already validated by the import pipeline; the
 * reducer re-validates it through `validateSceneObject` before it is stored.
 */
export function createImportedSceneObject(
  id: string,
  imported: ImportedModelMeta,
  overrides: Partial<Omit<SceneObject, 'id' | 'type' | 'kind' | 'imported'>> = {},
): ImportedSceneObject {
  return {
    id,
    type: IMPORTED_OBJECT_TYPE,
    kind: 'imported',
    name: imported.fileName.slice(0, OBJECT_NAME_MAX_LENGTH) || IMPORTED_DEFAULT_NAME,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    params: { ...TABLE_DEFAULTS },
    material: { ...MATERIAL_DEFAULTS },
    imported,
    ...overrides,
  };
}

/** Default scene: a room with a single table standing at its centre. */
export function createDefaultScene(idFactory: () => string): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects: [createTableSceneObject(idFactory())],
    settings: createDefaultSettings(),
  };
}

export function createDefaultSceneState(idFactory: () => string): SceneState {
  const data = createDefaultScene(idFactory);
  return { data, selectedId: data.objects[0]?.id ?? ROOM_OBJECT_ID };
}
