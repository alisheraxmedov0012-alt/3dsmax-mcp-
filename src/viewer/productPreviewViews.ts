/**
 * A2.2 — the preview shots a product package ships with.
 *
 * Kept separate from `SceneViewer` on purpose: the file names and the camera
 * angles are a *product* decision that the package builder, the tests and the UI
 * all need to agree on, and the package builder runs without a renderer. Putting
 * them here means the ZIP can validate what it was handed without importing
 * Three.js or a WebGL context.
 *
 * Each view maps onto an existing camera preset (`render/framing.ts`
 * `PRESET_DIRECTIONS`), so no new camera math is introduced:
 *
 * - `product` — slightly elevated three-quarter from the front; the hero shot.
 * - `side`    — lateral elevation, which shows depth and the silhouette.
 * - `iso`     — steeper three-quarter from the same corner; reads as a detail /
 *               alternative angle rather than a duplicate of the hero shot.
 *
 * The three directions are numerically distinct, so a working renderer produces
 * three different images; a test asserts they cannot collapse onto one preset.
 */
import type { CameraPreset } from '../scene/sceneSettings';

export type ProductPreviewId = 'front' | 'side' | 'detail';

export interface ProductPreviewView {
  id: ProductPreviewId;
  /** Stable filename inside the ZIP. No paths, no user text. */
  filename: `preview-${ProductPreviewId}.png`;
  /** Existing camera preset used to frame this shot. */
  cameraPreset: CameraPreset;
  /** Uzbek label for the UI. */
  label: string;
}

/** The shots every product package carries, in presentation order. */
export const PRODUCT_PREVIEW_VIEWS: readonly ProductPreviewView[] = [
  {
    id: 'front',
    filename: 'preview-front.png',
    cameraPreset: 'product',
    label: "Old tomondan uch chorak ko'rinish",
  },
  {
    id: 'side',
    filename: 'preview-side.png',
    cameraPreset: 'side',
    label: 'Yon ko‘rinish',
  },
  {
    id: 'detail',
    filename: 'preview-detail.png',
    cameraPreset: 'iso',
    label: 'Yuqori uch chorak (qo‘shimcha rakurs)',
  },
];

export const PRODUCT_PREVIEW_FILENAMES: readonly string[] = PRODUCT_PREVIEW_VIEWS.map(
  (view) => view.filename,
);

const FILENAMES = new Set<string>(PRODUCT_PREVIEW_FILENAMES);

/** True when `name` is one of the declared preview filenames. */
export function isProductPreviewFilename(name: string): boolean {
  return FILENAMES.has(name);
}

/**
 * Check that a buffer really is a PNG.
 *
 * The package must never ship an empty or mislabelled image, and a renderer that
 * silently returns nothing would otherwise look like a successful preview. The
 * signature (8 bytes) plus the `IHDR` chunk type is enough to reject a blank
 * buffer, a JPEG, or text.
 */
export function isPngBytes(bytes: Uint8Array | null | undefined): boolean {
  if (!bytes || bytes.length < 24) {
    return false;
  }
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) {
      return false;
    }
  }
  // First chunk must be IHDR: length (4) then the type "IHDR".
  const type = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  return type === 'IHDR';
}
