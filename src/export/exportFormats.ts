/**
 * W8 export format registry.
 *
 * Declares every format honestly: what it actually contains and what it drops.
 * The UI reads these descriptors, so a capability is never claimed unless the
 * exporter really provides it.
 *
 * Reality of the current pipeline (verified against the exporters in use):
 * - GLB (Three.js GLTFExporter): geometry, transforms, node names, and the full
 *   MeshStandardMaterial, including the two procedural maps `buildPbrMaterial`
 *   attaches (`map` → `pbrMetallicRoughness.baseColorTexture`, `normalMap` →
 *   `normalTexture`) and opacity (`opacity < 1` → `alphaMode: 'BLEND'`).
 *   Limits a buyer must know: the maps are 128×128 procedural bitmaps, not
 *   authored image textures; roughness and metalness stay scalar factors because
 *   no ORM (occlusion/roughness/metalness) map is produced; and the UVs are
 *   `BoxGeometry` face UVs rescaled to a fixed physical tile (50 cm), so detail
 *   density is uniform per face but there is no arbitrary unwrap.
 * - OBJ (Three.js OBJExporter): **geometry only** — the exporter emits no `.mtl`
 *   file and no materials (this is stated in Three.js' own OBJExporter source).
 * - STL (Three.js STLExporter): **geometry only** — no colour, no material.
 * - JSON: our own documented scene/design exchange format.
 * - PNG: a rendered image, produced by the existing viewer render path.
 */

export type ExportFormatId = 'glb' | 'json' | 'obj' | 'stl' | 'png';

export const EXPORT_FORMAT_ORDER: readonly ExportFormatId[] = ['glb', 'json', 'obj', 'stl', 'png'];

export interface ExportCapabilities {
  /** Mesh geometry (vertices/faces). */
  geometry: boolean;
  /** Material data (colour and/or PBR channels). */
  material: boolean;
  /** Texture maps. */
  textures: boolean;
  /** Transparency / alpha. */
  transparency: boolean;
  /** Scene/design parameter data (JSON). */
  data: boolean;
  /** A rendered raster image (PNG). */
  render: boolean;
}

export interface ExportFormatSpec {
  id: ExportFormatId;
  label: string;
  extension: string;
  mimeType: string;
  /** 'file' formats are produced by the data-export dispatch; 'render' by the viewer. */
  kind: 'file' | 'render';
  capabilities: ExportCapabilities;
  /** Short Uzbek notes shown in the UI (supported features and limitations). */
  notes: string[];
}

export const EXPORT_FORMATS: Record<ExportFormatId, ExportFormatSpec> = {
  glb: {
    id: 'glb',
    label: 'GLB (tavsiya etiladi)',
    extension: 'glb',
    mimeType: 'model/gltf-binary',
    kind: 'file',
    capabilities: {
      geometry: true,
      material: true,
      textures: true,
      transparency: true,
      data: false,
      render: false,
    },
    notes: [
      'Geometriya, transformlar, obyekt nomlari saqlanadi.',
      "Material: asosiy rang + metallik/qo'pollik (PBR).",
      'Tekstura: base color va normal map ichkariga yoziladi (procedural, 128×128).',
      "Shaffoflik: alphaMode BLEND (shisha va opacity < 1 bo'lgan materiallar).",
      "Cheklov: ORM (occlusion/roughness/metalness) teksturasi yo'q — bu ikki kanal scalar.",
      "Cheklov: UV — BoxGeometry yuzalari 50 sm'lik jismoniy kafelga keltirilgan; alohida unwrap yo'q.",
      'Interyer (xona) va barcha ko‘rinadigan mebel eksport qilinadi.',
    ],
  },
  json: {
    id: 'json',
    label: 'JSON (dizayn almashinuvi)',
    extension: 'json',
    mimeType: 'application/json',
    kind: 'file',
    capabilities: {
      geometry: false,
      material: false,
      textures: false,
      transparency: false,
      data: true,
      render: false,
    },
    notes: [
      'Xona, mebel turlari, o‘lchamlar, transformlar va sozlamalar saqlanadi.',
      'Versiyalangan format; import qilishda xavfsiz tekshiriladi.',
      '3D mesh emas — parametrik ma’lumot.',
    ],
  },
  obj: {
    id: 'obj',
    label: 'OBJ (mm, faqat geometriya)',
    extension: 'obj',
    mimeType: 'model/obj',
    kind: 'file',
    capabilities: {
      geometry: true,
      material: false,
      textures: false,
      transparency: false,
      data: false,
      render: false,
    },
    notes: [
      'Faqat geometriya (vertex/face) eksport qilinadi, millimetrda.',
      '.mtl fayli va materiallar EKSPORT QILINMAYDI (qo‘llanadigan eksporter bermaydi).',
      'Sahna santimetrda saqlanadi; OBJ uchun 10× masshtab qo‘llanadi.',
      'Blender/3ds Max kabi dasturlarda geometriyani tahrirlash uchun mos.',
    ],
  },
  stl: {
    id: 'stl',
    label: 'STL (mm, faqat geometriya)',
    extension: 'stl',
    mimeType: 'model/stl',
    kind: 'file',
    capabilities: {
      geometry: true,
      material: false,
      textures: false,
      transparency: false,
      data: false,
      render: false,
    },
    notes: [
      'Faqat mesh geometriyasi (ikkilik STL, millimetrda).',
      'Rang, material va tekstura SAQLANMAYDI. Sahna santimetrda saqlanadi; STL uchun 10× masshtab qo‘llanadi.',
      'Manifold/ishlab chiqarishga tayyorligi kafolatlanmaydi (tekshirilmagan).',
    ],
  },
  png: {
    id: 'png',
    label: 'PNG (render tasvir)',
    extension: 'png',
    mimeType: 'image/png',
    kind: 'render',
    capabilities: {
      geometry: false,
      material: false,
      textures: false,
      transparency: false,
      data: false,
      render: true,
    },
    notes: [
      'Joriy 3D ko‘rinishdan olingan rasm (WebGL render).',
      'Rezolyutsiya render panelida tanlanadi.',
      '3D model emas — faqat tasvir.',
    ],
  },
};

export function isExportFormatId(value: unknown): value is ExportFormatId {
  return typeof value === 'string' && value in EXPORT_FORMATS;
}

/** Human-readable capability summary for the UI (only what really applies). */
export function formatCapabilitySummary(spec: ExportFormatSpec): string {
  const parts: string[] = [];
  if (spec.capabilities.geometry) parts.push('geometriya');
  if (spec.capabilities.material) parts.push('material');
  if (spec.capabilities.textures) parts.push('tekstura');
  if (spec.capabilities.transparency) parts.push('shaffoflik');
  if (spec.capabilities.data) parts.push('parametrlar');
  if (spec.capabilities.render) parts.push('render tasvir');
  return parts.length > 0 ? parts.join(', ') : '—';
}
