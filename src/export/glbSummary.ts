/**
 * A4 — what a `.glb` actually contains, read from the file itself.
 *
 * Package metadata must describe the exported bytes, not the scene we think we
 * exported. This inspector parses the GLB container (header, JSON chunk, BIN
 * chunk) and reports counts and texture sizes without Three.js, so it works in
 * tests and in the browser alike. Anything malformed is reported as a failure
 * with a reason instead of a partial summary.
 */
import { pngSize, type PngSize } from './pngSize';

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const MODE_TRIANGLES = 4;

export interface GlbImageSummary {
  index: number;
  mimeType: string | null;
  size: PngSize | null;
}

export interface GlbSummary {
  version: number;
  bytes: number;
  generator: string | null;
  meshes: number;
  primitives: number;
  triangles: number;
  materials: string[];
  textures: number;
  images: GlbImageSummary[];
  /** Non-data `uri` references, which a buyer would have to resolve separately. */
  externalUris: number;
}

export type GlbSummaryResult =
  | { ok: true; summary: GlbSummary }
  | { ok: false; reason: string };

interface GltfPrimitive {
  mode?: number;
  indices?: number;
  attributes?: Record<string, number>;
}

interface GltfJson {
  asset?: { generator?: string; version?: string };
  meshes?: Array<{ primitives?: GltfPrimitive[] }>;
  materials?: Array<{ name?: string }>;
  textures?: unknown[];
  images?: Array<{ bufferView?: number; mimeType?: string; uri?: string }>;
  buffers?: Array<{ uri?: string }>;
  accessors?: Array<{ count?: number }>;
  bufferViews?: Array<{ byteOffset?: number; byteLength?: number }>;
}

function failure(reason: string): GlbSummaryResult {
  return { ok: false, reason };
}

function decodeJson(bytes: Uint8Array): GltfJson | null {
  // The JSON chunk is padded to four bytes with spaces (and some writers use
  // NULs). Trim that padding by code point rather than with a control-character
  // regex, then parse.
  let end = bytes.length;
  while (end > 0) {
    const code = bytes[end - 1];
    if (code === 0 || code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09) {
      end -= 1;
      continue;
    }
    break;
  }
  const text = new TextDecoder().decode(bytes.subarray(0, end));
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? (parsed as GltfJson) : null;
  } catch {
    return null;
  }
}

function countTriangles(gltf: GltfJson): number {
  let triangles = 0;
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if ((primitive.mode ?? MODE_TRIANGLES) !== MODE_TRIANGLES) {
        continue;
      }
      const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
      if (typeof accessorIndex !== 'number') {
        continue;
      }
      const count = gltf.accessors?.[accessorIndex]?.count;
      if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
        triangles += Math.floor(count / 3);
      }
    }
  }
  return triangles;
}

function imageBytes(gltf: GltfJson, bin: Uint8Array | null, index: number): Uint8Array | null {
  const image = gltf.images?.[index];
  if (!image || typeof image.bufferView !== 'number' || !bin) {
    return null;
  }
  const view = gltf.bufferViews?.[image.bufferView];
  if (!view) {
    return null;
  }
  const offset = view.byteOffset ?? 0;
  const length = view.byteLength ?? 0;
  if (offset < 0 || length <= 0 || offset + length > bin.byteLength) {
    return null;
  }
  return bin.subarray(offset, offset + length);
}

function countExternalUris(gltf: GltfJson): number {
  const isExternal = (uri: string | undefined): boolean =>
    typeof uri === 'string' && !uri.startsWith('data:');
  let count = 0;
  for (const buffer of gltf.buffers ?? []) {
    if (isExternal(buffer.uri)) count += 1;
  }
  for (const image of gltf.images ?? []) {
    if (isExternal(image.uri)) count += 1;
  }
  return count;
}

function summarizeImages(gltf: GltfJson, bin: Uint8Array | null): GlbImageSummary[] {
  return (gltf.images ?? []).map((image, index) => {
    const bytes = imageBytes(gltf, bin, index);
    return {
      index,
      mimeType: image.mimeType ?? (bytes ? 'image/png' : null),
      size: bytes ? pngSize(bytes) : null,
    };
  });
}

/** Parse a GLB buffer and report the facts a buyer or a test can verify. */
export function summarizeGlb(data: ArrayBuffer): GlbSummaryResult {
  if (data.byteLength < 20) {
    return failure('GLB fayl sarlavhasi uchun juda kichik.');
  }
  const view = new DataView(data);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    return failure("GLB sarlavhasi noto'g'ri (magic raqami mos emas).");
  }
  const version = view.getUint32(4, true);
  const declaredLength = view.getUint32(8, true);
  if (declaredLength !== data.byteLength) {
    return failure(
      `GLB uzunligi fayl hajmiga mos emas (${declaredLength} != ${data.byteLength}).`,
    );
  }
  if (version !== 2) {
    return failure(`Faqat glTF 2.0 qo'llab-quvvatlanadi (fayl versiyasi ${version}).`);
  }

  let json: Uint8Array | null = null;
  let bin: Uint8Array | null = null;
  let offset = 12;
  while (offset + 8 <= declaredLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + chunkLength;
    if (end > declaredLength) {
      return failure('GLB chunk hajmi fayl chegarasidan tashqarida.');
    }
    if (chunkType === CHUNK_JSON && !json) {
      json = new Uint8Array(data, start, chunkLength);
    } else if (chunkType === CHUNK_BIN && !bin) {
      bin = new Uint8Array(data, start, chunkLength);
    }
    offset = end;
  }

  if (!json) {
    return failure('GLB ichida JSON chunk topilmadi.');
  }
  const gltf = decodeJson(json);
  if (!gltf) {
    return failure('GLB JSON chunk o‘qilmadi.');
  }

  const primitives = (gltf.meshes ?? []).reduce(
    (sum, mesh) => sum + (mesh.primitives?.length ?? 0),
    0,
  );

  return {
    ok: true,
    summary: {
      version,
      bytes: data.byteLength,
      generator: gltf.asset?.generator ?? null,
      meshes: gltf.meshes?.length ?? 0,
      primitives,
      triangles: countTriangles(gltf),
      materials: (gltf.materials ?? []).map(
        (material, index) => material.name ?? `material-${index}`,
      ),
      textures: gltf.textures?.length ?? 0,
      images: summarizeImages(gltf, bin),
      externalUris: countExternalUris(gltf),
    },
  };
}
