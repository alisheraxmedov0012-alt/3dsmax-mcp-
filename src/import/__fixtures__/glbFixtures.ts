/**
 * Phase 6.2 — GLB fixtures built in code, never committed as binary.
 *
 * A valid GLB is a 12-byte header plus length-prefixed chunks, so a test can build
 * exactly the file it needs — including deliberately broken ones — and the diff
 * stays reviewable. Everything below is generated on demand; nothing here ships in
 * the app bundle.
 */

export const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export interface BuildGlbOptions {
  /** Header magic. */
  magic?: number;
  /** Header container version. */
  version?: number;
  /** Overrides the length written into the header (to break it on purpose). */
  declaredLength?: number;
  /** Overrides the JSON chunk length (to push a chunk past the file end). */
  jsonChunkLength?: number;
  /** Replaces the JSON chunk type, e.g. to test a missing JSON chunk. */
  jsonChunkType?: number;
}

function pad4(length: number): number {
  return (4 - (length % 4)) % 4;
}

/** Assembles a GLB from a JSON document and an optional BIN chunk. */
export function buildGlb(
  json: Record<string, unknown> | string,
  bin: Uint8Array | null,
  options: BuildGlbOptions = {},
): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(
    typeof json === 'string' ? json : JSON.stringify(json),
  );
  const jsonPadding = pad4(jsonBytes.length);
  const binPadding = bin ? pad4(bin.length) : 0;

  const total =
    12 + 8 + jsonBytes.length + jsonPadding + (bin ? 8 + bin.length + binPadding : 0);
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint32(0, options.magic ?? GLB_MAGIC, true);
  view.setUint32(4, options.version ?? 2, true);
  view.setUint32(8, options.declaredLength ?? total, true);

  let offset = 12;
  view.setUint32(offset, options.jsonChunkLength ?? jsonBytes.length + jsonPadding, true);
  view.setUint32(offset + 4, options.jsonChunkType ?? CHUNK_JSON, true);
  bytes.set(jsonBytes, offset + 8);
  bytes.fill(0x20, offset + 8 + jsonBytes.length, offset + 8 + jsonBytes.length + jsonPadding);
  offset += 8 + jsonBytes.length + jsonPadding;

  if (bin) {
    view.setUint32(offset, bin.length + binPadding, true);
    view.setUint32(offset + 4, CHUNK_BIN, true);
    bytes.set(bin, offset + 8);
  }

  return buffer;
}

/** One triangle: 3 vertices (36 bytes) + 3 uint16 indices (6 bytes). */
export function triangleBin(): Uint8Array {
  const bin = new Uint8Array(44);
  const view = new DataView(bin.buffer);
  const positions = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ];
  let offset = 0;
  for (const [x, y, z] of positions) {
    view.setFloat32(offset, x, true);
    view.setFloat32(offset + 4, y, true);
    view.setFloat32(offset + 8, z, true);
    offset += 12;
  }
  view.setUint16(36, 0, true);
  view.setUint16(38, 1, true);
  view.setUint16(40, 2, true);
  return bin;
}

/** A minimal, valid glTF 2.0 document describing the triangle above. */
export function triangleJson(): Record<string, unknown> {
  return {
    asset: { version: '2.0', generator: '3d-studio-ai-test' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'TriangleNode' }],
    meshes: [
      {
        name: 'Triangle',
        primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }],
      },
    ],
    materials: [
      { name: 'Paint', pbrMetallicRoughness: { baseColorFactor: [0.5, 0.2, 0.1, 1] } },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
    ],
    buffers: [{ byteLength: 42 }],
  };
}

/** A valid single-triangle GLB. */
export function triangleGlb(): ArrayBuffer {
  return buildGlb(triangleJson(), triangleBin());
}

/**
 * Deep copy of the triangle document with a patch applied.
 *
 * Tests read better when they state only what they change ("make the accessor
 * claim a billion vertices") instead of restating a whole glTF document.
 */
export function triangleJsonWith(
  patch: (json: Record<string, unknown>) => void,
): Record<string, unknown> {
  const json = JSON.parse(JSON.stringify(triangleJson())) as Record<string, unknown>;
  patch(json);
  return json;
}
