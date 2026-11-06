/**
 * Phase 8B.1 — the first commercial product definition.
 *
 * This is a product *fixture*, not a new geometry path: the desk is a normal
 * scene object built from the registered `desk.computer` definition. Keeping it
 * in the scene vocabulary means the viewer, the preview capture, the exporters
 * and the asset package all consume the same object instead of a private copy.
 *
 * Commercial fields that have not been decided (licence, price, author) stay
 * `null` on purpose. A marketplace listing must not inherit an invented value.
 */
import { DEFAULT_DESK_SPEC } from '../geometry/furniture/desk';
// Registers the built-in definitions before `createUniversalSceneObject` runs;
// a product module may be the first entry point in a harness or a worker.
import '../geometry/universal/definitions';
import { LIGHTING_PRESET_CONFIGS } from '../render/renderPresets';
import { createDefaultSettings, type LightSettings } from '../scene/sceneSettings';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createUniversalSceneObject,
  type SceneData,
} from '../scene/types';

export const PREMIUM_DESK_SKU = '3DSA-DESK-PREM-160';
export const PREMIUM_DESK_SLUG = 'premium-office-desk-160x80x75';
export const PREMIUM_DESK_OBJECT_ID = 'desk-product-1';
export const PREMIUM_DESK_DEFINITION_ID = 'desk.computer';
export const PREMIUM_DESK_OBJECT_NAME = 'Premium Office Desk';
export const PREMIUM_DESK_TITLE =
  'Premium Office Desk — Parametric Oak & Steel Computer Desk (160×80×75 cm)';

export const PREMIUM_DESK_TAGS: readonly string[] = [
  'office desk',
  'computer desk',
  'executive desk',
  'wooden desk',
  'steel desk',
  'modern office furniture',
  'workspace desk',
  'writing desk',
  'desk with drawer',
  'cable grommet',
  'parametric furniture',
  'PBR',
  'interior furniture',
  'office',
  '3D model',
];

/**
 * Listing copy limited to facts the model actually carries. Part counts and
 * texture claims are deliberately omitted: geometry evolves per phase, and a
 * listing that hard-codes them becomes false at the next change.
 */
export const PREMIUM_DESK_DESCRIPTION =
  'A clean 160 × 80 × 75 cm office desk with a 3 cm oak tabletop, four square black-satin steel legs, an under-top frame, a right-hand oak drawer with a bar handle and a rear cable grommet. The tabletop has a real through-hole for the grommet. Four material slots carry 2K PBR BaseColor, Normal, Roughness and Metalness maps (oak and black satin), and individually named parts make the model easy to edit or adapt. Real-world centimetre dimensions.';

export interface ProductListingDraft {
  readonly title: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly description: string;
  readonly compatibilityNotes: string;
}

export interface ProductDefinition {
  readonly sku: string;
  readonly slug: string;
  readonly title: string;
  readonly definitionId: string;
  readonly objectId: string;
  readonly objectName: string;
  /** Geometry is deterministic and parametric; no generative model is involved. */
  readonly authorship: 'procedural';
  readonly aiGenerated: false;
  readonly scene: SceneData;
  readonly listing: ProductListingDraft;
  /** Undecided commercial fields stay null until the seller sets them. */
  readonly license: null;
  readonly price: null;
  readonly author: null;
}

/** Product lighting: neutral studio preset, light background, high quality. */
export function createProductSettings(): SceneData['settings'] {
  const preset = LIGHTING_PRESET_CONFIGS.neutralProduct;
  const lights: LightSettings = {
    ambientIntensity: preset.ambientIntensity,
    ambientColor: preset.ambientColor,
    keyEnabled: true,
    keyIntensity: preset.keyIntensity,
    keyColor: preset.keyColor,
    fillEnabled: true,
    fillIntensity: preset.fillIntensity,
    fillColor: preset.fillColor,
    rimEnabled: preset.rimEnabled,
    rimIntensity: preset.rimIntensity,
    rimColor: preset.rimColor,
    shadowsEnabled: preset.shadowsEnabled,
    shadowBias: preset.shadowBias,
    shadowNormalBias: preset.shadowNormalBias,
    shadowRadius: preset.shadowRadius,
    shadowIntensity: preset.shadowIntensity,
  };
  return {
    ...createDefaultSettings(),
    background: '#f4f4f6',
    lights,
    lightingPreset: 'neutralProduct',
    qualityPreset: 'high',
    environmentEnabled: preset.environmentEnabled,
    environmentIntensity: preset.environmentIntensity,
  };
}

/** Builds a fresh scene each call; the fixture constant below is one instance. */
export function createPremiumDeskScene(): SceneData {
  const object = createUniversalSceneObject(
    PREMIUM_DESK_DEFINITION_ID,
    PREMIUM_DESK_OBJECT_ID,
    DEFAULT_DESK_SPEC,
    {
      name: PREMIUM_DESK_OBJECT_NAME,
      // The premium maps carry the albedo/roughness/metalness values; scalar
      // multipliers stay at 1 so they do not bias the map channels.
      material: { metalness: 1, roughness: 1, premiumTextures: true },
    },
  );
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects: [object],
    settings: createProductSettings(),
  };
}

export const PREMIUM_DESK_PRODUCT: ProductDefinition = {
  sku: PREMIUM_DESK_SKU,
  slug: PREMIUM_DESK_SLUG,
  title: PREMIUM_DESK_TITLE,
  definitionId: PREMIUM_DESK_DEFINITION_ID,
  objectId: PREMIUM_DESK_OBJECT_ID,
  objectName: PREMIUM_DESK_OBJECT_NAME,
  authorship: 'procedural',
  aiGenerated: false,
  scene: createPremiumDeskScene(),
  listing: {
    title: PREMIUM_DESK_TITLE,
    category: 'Furniture / Table',
    tags: PREMIUM_DESK_TAGS,
    description: PREMIUM_DESK_DESCRIPTION,
    compatibilityNotes:
      'Dimensions are in centimetres in the scene model and metres in the GLB, per glTF convention. The four material slots use 2048 × 2048 BaseColor, Normal, Roughness and Metalness maps; the GLB packs roughness and metalness into a shared ORM texture (G = roughness, B = metalness).',
  },
  license: null,
  price: null,
  author: null,
};
