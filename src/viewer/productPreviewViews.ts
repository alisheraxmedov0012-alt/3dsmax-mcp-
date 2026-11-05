/**
 * Phase 5.5 — the preview shots a product package ships with.
 *
 * The filenames and camera angles are a *product* decision that the package
 * builder, tests and UI must agree on. The data stays renderer-free so the ZIP
 * builder can validate a set without a WebGL context.
 *
 * The runtime `CameraAngleId` vocabulary is separate from the persisted
 * `SceneSettings.cameraPreset` values, so adding product angles does not change
 * scene schema v3.
 */
import type { CameraAngleId } from './cameraAngles';

export type ProductPreviewId = 'hero' | 'front' | 'side' | 'back' | 'top' | 'detail';

export interface ProductPreviewView {
  id: ProductPreviewId;
  /** Stable filename inside the ZIP. No paths, no user text. */
  filename: `preview-${ProductPreviewId}.png`;
  /** Runtime camera angle used to frame this shot. */
  cameraAngle: CameraAngleId;
  /** Uzbek label for the UI. */
  label: string;
}

/** The default marketplace gallery, in presentation order. */
export const PRODUCT_PREVIEW_VIEWS: readonly ProductPreviewView[] = [
  {
    id: 'hero',
    filename: 'preview-hero.png',
    cameraAngle: 'hero',
    label: 'Hero (uch chorak)',
  },
  {
    id: 'front',
    filename: 'preview-front.png',
    cameraAngle: 'front',
    label: 'Old tomondan',
  },
  {
    id: 'side',
    filename: 'preview-side.png',
    cameraAngle: 'right',
    label: "O'ng yon ko'rinish",
  },
  {
    id: 'back',
    filename: 'preview-back.png',
    cameraAngle: 'back',
    label: 'Orqa tomondan',
  },
  {
    id: 'top',
    filename: 'preview-top.png',
    cameraAngle: 'top',
    label: 'Yuqoridan',
  },
  {
    id: 'detail',
    filename: 'preview-detail.png',
    cameraAngle: 'detail',
    label: 'Detal (yaqin)',
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
