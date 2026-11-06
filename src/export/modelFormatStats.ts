/**
 * Phase 6.1-B — format-specific model statistics.
 *
 * Every value is read from the exported bytes. The OBJ/STL/3MF parsers are kept
 * deliberately small: they cover the shapes this application writes and reject
 * anything they cannot understand instead of guessing.
 */
import { unzipSync } from 'fflate';
import type { GlbSummary } from './glbSummary';
import { normalizeAssetPath } from './assetPackageV2Schema';
import type {
  AssetPackageV2BoundsMm,
  AssetPackageV2ModelStats,
} from './assetPackageV2Schema';

export const THREE_MF_MODEL_PATH = '3D/3dmodel.model';
const THREE_MF_REQUIRED_ENTRIES = [
  '[Content_Types].xml',
  '_rels/.rels',
  THREE_MF_MODEL_PATH,
] as const;

function parseFinite(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} chekli son emas: "${value}".`);
  }
  return parsed;
}

function updateBounds(
  bounds: AssetPackageV2BoundsMm | null,
  x: number,
  y: number,
  z: number,
): AssetPackageV2BoundsMm {
  if (!bounds) {
    return { min: [x, y, z], max: [x, y, z] };
  }
  return {
    min: [Math.min(bounds.min[0], x), Math.min(bounds.min[1], y), Math.min(bounds.min[2], z)],
    max: [Math.max(bounds.max[0], x), Math.max(bounds.max[1], y), Math.max(bounds.max[2], z)],
  };
}

/** Statistics derived from OBJ text, optionally with its MTL companion. */
export function inspectObjBytes(
  bytes: Uint8Array,
  mtlBytes?: Uint8Array,
): AssetPackageV2ModelStats {
  const text = new TextDecoder().decode(bytes);
  let vertices = 0;
  let faces = 0;
  let triangles = 0;
  let objects = 0;
  let bounds: AssetPackageV2BoundsMm | null = null;
  const materials = new Set<string>();

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const parts = line.split(/\s+/u);
    if (parts[0] === 'v') {
      if (parts.length < 4) {
        throw new Error("OBJ vertex qatori to'liq emas.");
      }
      const x = parseFinite(parts[1], 'OBJ v.x');
      const y = parseFinite(parts[2], 'OBJ v.y');
      const z = parseFinite(parts[3], 'OBJ v.z');
      vertices += 1;
      bounds = updateBounds(bounds, x, y, z);
    } else if (parts[0] === 'f') {
      if (parts.length < 4) {
        throw new Error("OBJ face qatorida 3 tadan kam vertex bor.");
      }
      faces += 1;
      triangles += parts.length - 3;
    } else if (parts[0] === 'o') {
      objects += 1;
    } else if (parts[0] === 'usemtl' && parts[1]) {
      materials.add(parts[1]);
    }
  }

  let textures: number | undefined;
  if (mtlBytes) {
    const mtlText = new TextDecoder().decode(mtlBytes);
    textures = 0;
    for (const rawLine of mtlText.split('\n')) {
      const line = rawLine.trim();
      if (line.startsWith('map_Kd ') || line.startsWith('map_Bump ')) {
        textures += 1;
      }
    }
  }

  return {
    vertices,
    faces,
    triangles,
    objects,
    materials: [...materials],
    ...(textures !== undefined ? { textures } : {}),
    ...(bounds ? { boundsMm: bounds } : {}),
  };
}

/** All package-relative texture paths referenced by an MTL file. */
export function objMtlTextureRefs(mtlBytes: Uint8Array): string[] {
  const text = new TextDecoder().decode(mtlBytes);
  const refs = new Set<string>();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('map_Kd ') && !line.startsWith('map_Bump ')) {
      continue;
    }
    const parts = line.split(/\s+/u);
    const rawPath = parts[parts.length - 1];
    const relative = rawPath.startsWith('../') ? rawPath.slice(3) : rawPath;
    const normalized = normalizeAssetPath(relative);
    if (!normalized.ok) {
      throw new Error(`MTL tekstura path xavfli: ${normalized.problem}`);
    }
    if (!normalized.path.startsWith('textures/')) {
      throw new Error(`MTL tekstura path "textures/" ostida emas: "${rawPath}".`);
    }
    refs.add(normalized.path);
  }
  return [...refs];
}

/** Statistics derived from a binary STL. */
export function inspectStlBytes(bytes: Uint8Array): AssetPackageV2ModelStats {
  if (bytes.byteLength < 84) {
    throw new Error("STL fayli 84 baytdan kichik.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles = view.getUint32(80, true);
  const expectedLength = 84 + triangles * 50;
  if (bytes.byteLength !== expectedLength) {
    throw new Error(
      `STL hajmi ${bytes.byteLength} bayt; ${triangles} uchburchak uchun ` +
        `${expectedLength} bayt kutilgan.`,
    );
  }
  let bounds: AssetPackageV2BoundsMm | null = null;
  let offset = 84;
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    offset += 12;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const x = view.getFloat32(offset, true);
      const y = view.getFloat32(offset + 4, true);
      const z = view.getFloat32(offset + 8, true);
      if (![x, y, z].every(Number.isFinite)) {
        throw new Error('STL ichida cheksiz koordinata bor.');
      }
      bounds = updateBounds(bounds, x, y, z);
      offset += 12;
    }
    offset += 2;
  }
  return {
    triangles,
    ...(bounds ? { boundsMm: bounds } : {}),
  };
}

function attributesOf(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"]*)"/gu)) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

/** Statistics derived from the 3MF OPC package and its model XML. */
export function inspectThreeMfBytes(bytes: Uint8Array): AssetPackageV2ModelStats {
  const files = unzipSync(bytes);
  for (const entry of THREE_MF_REQUIRED_ENTRIES) {
    if (!files[entry]) {
      throw new Error(`3MF paketida "${entry}" yo'q.`);
    }
  }
  const contentTypes = new TextDecoder().decode(files['[Content_Types].xml']);
  if (
    !contentTypes.includes('Extension="model"') ||
    !contentTypes.includes('3dmanufacturing-3dmodel+xml')
  ) {
    throw new Error("3MF [Content_Types].xml model qismini e'lon qilmaydi.");
  }
  const rels = new TextDecoder().decode(files['_rels/.rels']);
  if (!rels.includes('3dmodel.model')) {
    throw new Error("3MF _rels/.rels model qismiga bog'lanmagan.");
  }
  const xml = new TextDecoder().decode(files[THREE_MF_MODEL_PATH]);
  if (
    !xml.includes('xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"')
  ) {
    throw new Error("3MF model XML core namespace'i noto'g'ri.");
  }
  const unit = /<model\b[^>]*\bunit="([^"]+)"/u.exec(xml)?.[1];
  if (unit !== 'millimeter') {
    throw new Error(`3MF unit "millimeter" emas: "${unit ?? "yo'q"}".`);
  }

  const objects = xml.match(/<object\b/gu)?.length ?? 0;
  let vertices = 0;
  let bounds: AssetPackageV2BoundsMm | null = null;
  for (const match of xml.matchAll(/<vertex\b([^>]*)\/>/gu)) {
    const attributes = attributesOf(match[1]);
    if (
      attributes.x === undefined ||
      attributes.y === undefined ||
      attributes.z === undefined
    ) {
      throw new Error("3MF vertex x/y/z atributlari to'liq emas.");
    }
    const x = parseFinite(attributes.x, '3MF vertex x');
    const y = parseFinite(attributes.y, '3MF vertex y');
    const z = parseFinite(attributes.z, '3MF vertex z');
    vertices += 1;
    bounds = updateBounds(bounds, x, y, z);
  }

  let triangles = 0;
  for (const match of xml.matchAll(/<triangle\b([^>]*)\/>/gu)) {
    const attributes = attributesOf(match[1]);
    for (const key of ['v1', 'v2', 'v3'] as const) {
      if (attributes[key] === undefined) {
        throw new Error(`3MF triangle ${key} atributisiz.`);
      }
      const index = Number(attributes[key]);
      if (!Number.isInteger(index) || index < 0 || index >= vertices) {
        throw new Error(`3MF triangle ${key} indeksi noto'g'ri.`);
      }
    }
    triangles += 1;
  }

  return {
    objects,
    vertices,
    triangles,
    ...(bounds ? { boundsMm: bounds } : {}),
  };
}

/** Convert the existing GLB inspector result into the package stats shape. */
export function glbStats(summary: GlbSummary): AssetPackageV2ModelStats {
  return {
    meshes: summary.meshes,
    primitives: summary.primitives,
    triangles: summary.triangles,
    materials: summary.materials,
    textures: summary.textures,
    externalUris: summary.externalUris,
    generator: summary.generator,
  };
}

function boundsEqual(
  a: AssetPackageV2BoundsMm,
  b: AssetPackageV2BoundsMm,
): boolean {
  return [...a.min, ...a.max].every(
    (value, index) => Math.abs(value - [...b.min, ...b.max][index]) <= 1e-6,
  );
}

/** Compare metadata stats with stats re-read from the actual file. */
export function compareModelStats(
  expected: AssetPackageV2ModelStats,
  actual: AssetPackageV2ModelStats,
  label: string,
): string[] {
  const problems: string[] = [];
  const numericKeys = [
    'meshes',
    'primitives',
    'triangles',
    'vertices',
    'faces',
    'objects',
    'textures',
    'externalUris',
  ] as const;
  for (const key of numericKeys) {
    if (expected[key] !== undefined && expected[key] !== actual[key]) {
      problems.push(`${label}.stats.${key} fayl bilan mos emas.`);
    }
  }
  if (
    expected.materials !== undefined &&
    expected.materials.join('|') !== (actual.materials ?? []).join('|')
  ) {
    problems.push(`${label}.stats.materials fayl bilan mos emas.`);
  }
  if (expected.generator !== undefined && expected.generator !== (actual.generator ?? null)) {
    problems.push(`${label}.stats.generator fayl bilan mos emas.`);
  }
  if (expected.boundsMm !== undefined) {
    if (!actual.boundsMm || !boundsEqual(expected.boundsMm, actual.boundsMm)) {
      problems.push(`${label}.stats.boundsMm fayl bilan mos emas.`);
    }
  }
  if (actual.externalUris !== undefined && actual.externalUris !== 0) {
    problems.push(`${label}: fayl tashqi URI ga bog‘langan.`);
  }
  return problems;
}
