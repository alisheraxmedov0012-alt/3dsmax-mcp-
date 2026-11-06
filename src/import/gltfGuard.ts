/**
 * Phase 6.2 — glTF document policy, applied before any loader sees the file.
 *
 * The GLB container check (`parseGlbContainer`) only proves the wrapper is
 * well-formed; a well-formed container can still describe a buffer far larger than
 * the data it carries, reference a remote texture, or require a decoder this build
 * does not ship. This module answers three questions from the JSON alone, without
 * allocating anything proportional to what the file *claims*:
 *
 * 1. Is every reference resolvable inside the file? (no network, no paths)
 * 2. Do the declared sizes fit the bytes that actually exist?
 * 3. Is the result inside the work limits for one browser tab?
 *
 * Rejections are `ImportError`s with a specific code, never a silent skip.
 */
import type { GltfJson } from '../export/glbSummary';
import {
  MAX_EMBEDDED_TEXTURES,
  MAX_GLTF_JSON_BYTES,
  MAX_NODE_DEPTH,
  MAX_NODES,
  MAX_TEXTURE_DIMENSION,
  MAX_TEXTURE_IMAGE_BYTES,
  MAX_MODEL_BYTES,
  MAX_TOTAL_TEXTURE_PIXELS,
  MAX_TRIANGLES,
  MAX_VERTICES,
} from './importLimits';
import { importFailure } from './importErrors';
import { readImageSize } from './imageHeader';

/**
 * Required extensions this build can satisfy.
 *
 * Everything listed is handled natively by the bundled `GLTFLoader`. Anything
 * else — Draco, meshopt, KTX2/Basis, WebP textures — needs a decoder this build
 * does not ship, and glTF requires a client to refuse the asset rather than render
 * it incorrectly. The list is an allowlist on purpose: a new extension must be
 * verified before it is accepted.
 */
const ALLOWED_REQUIRED_EXTENSIONS: ReadonlySet<string> = new Set([
  'KHR_materials_anisotropy',
  'KHR_materials_clearcoat',
  'KHR_materials_dispersion',
  'KHR_materials_emissive_strength',
  'KHR_materials_ior',
  'KHR_materials_iridescence',
  'KHR_materials_sheen',
  'KHR_materials_specular',
  'KHR_materials_transmission',
  'KHR_materials_unlit',
  'KHR_materials_volume',
  'KHR_mesh_quantization',
  'KHR_texture_transform',
]);

const COMPONENT_BYTES: Readonly<Record<number, number>> = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
};

const TYPE_COMPONENTS: Readonly<Record<string, number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

const MODE_TRIANGLES = 4;
const MODE_TRIANGLE_STRIP = 5;
const MODE_TRIANGLE_FAN = 6;

/**
 * A resource the document expects to find outside itself.
 *
 * Only produced when the policy allows external references (a `.gltf` whose
 * companions the user selected). The caller resolves each one against the
 * selected files — never the network — and validates the bytes it finds.
 */
export interface ExternalReference {
  readonly kind: 'buffer' | 'image';
  readonly uri: string;
  /** Index in `buffers` or `images`. */
  readonly index: number;
  /** Declared buffer size, used to check the resolved file is big enough. */
  readonly byteLength: number | null;
  readonly mimeType: string | null;
}

export interface GltfDocumentStats {
  meshes: number;
  primitives: number;
  triangles: number;
  vertices: number;
  materials: number;
  textures: number;
  images: number;
  nodes: number;
  externalReferences: ExternalReference[];
}

export interface GltfGuardOptions {
  /**
   * `reject` — a self-contained GLB: any file reference is a policy violation.
   * `allow` — a `.gltf`: references are collected for the caller to resolve from
   * the user's selection.
   */
  externalUris: 'reject' | 'allow';
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function checkVersion(json: GltfJson): void {
  const version = json.asset?.version;
  if (typeof version !== 'string' || !version.startsWith('2.')) {
    throw importFailure('malformed', 'Fayl glTF 2.0 hujjati emas.');
  }
}

function checkRequiredExtensions(json: GltfJson): void {
  const required = json.extensionsRequired;
  if (required === undefined) {
    return;
  }
  if (!Array.isArray(required) || required.some((name) => typeof name !== 'string')) {
    throw importFailure('malformed', 'extensionsRequired ro‘yxati buzilgan.');
  }
  const unsupported = required.filter((name) => !ALLOWED_REQUIRED_EXTENSIONS.has(name));
  if (unsupported.length > 0) {
    throw importFailure(
      'unsupported_extension',
      `Qo'llab-quvvatlanmaydigan kengaytma: ${unsupported.join(', ')}. ` +
        "Draco, meshopt va KTX2 dekoderlari bu versiyada mavjud emas.",
    );
  }
}

function checkScenes(json: GltfJson): void {
  const scenes = json.scenes;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw importFailure('malformed', 'Modelda sahna (scene) yo‘q.');
  }
  if (json.scene !== undefined && !isNonNegativeInt(json.scene)) {
    throw importFailure('malformed', 'scene indeksi noto‘g‘ri.');
  }
  if (json.scene !== undefined && json.scene >= scenes.length) {
    throw importFailure('malformed', 'scene indeksi sahnadan tashqarida.');
  }
}

function checkBuffers(
  json: GltfJson,
  bin: Uint8Array | null,
  options: GltfGuardOptions,
  references: ExternalReference[],
): void {
  const buffers = json.buffers ?? [];
  if (buffers.length === 0) {
    throw importFailure('malformed', 'Modelda buffer yo‘q.');
  }
  buffers.forEach((buffer, index) => {
    if (!isNonNegativeInt(buffer.byteLength)) {
      throw importFailure('malformed', `buffer[${index}].byteLength noto‘g‘ri.`);
    }
    if (buffer.byteLength > MAX_MODEL_BYTES) {
      throw importFailure('too_complex', `buffer[${index}] hajmi juda katta.`);
    }
    if (buffer.uri === undefined) {
      if (index > 0 || bin === null) {
        // Only the first buffer may live in the GLB BIN chunk, and a `.gltf` has
        // no chunk at all.
        throw importFailure('malformed', `buffer[${index}] uchun URI ko‘rsatilmagan.`);
      }
      return;
    }
    if (buffer.uri.startsWith('data:')) {
      return;
    }
    if (options.externalUris === 'reject') {
      throw importFailure(
        'external_resource',
        `buffer[${index}] tashqi faylga havola qiladi: "${buffer.uri}".`,
      );
    }
    references.push({
      kind: 'buffer',
      uri: buffer.uri,
      index,
      byteLength: buffer.byteLength,
      mimeType: null,
    });
  });
}

function checkBufferViews(json: GltfJson, bin: Uint8Array | null): void {
  const buffers = json.buffers ?? [];
  const views = json.bufferViews ?? [];
  views.forEach((view, index) => {
    if (!isNonNegativeInt(view.buffer) || view.buffer >= buffers.length) {
      throw importFailure('malformed', `bufferView[${index}] buffer indeksi noto‘g‘ri.`);
    }
    const byteLength = view.byteLength;
    if (!isNonNegativeInt(byteLength) || byteLength === 0) {
      throw importFailure('malformed', `bufferView[${index}].byteLength noto‘g‘ri.`);
    }
    const offset = view.byteOffset ?? 0;
    if (!isNonNegativeInt(offset)) {
      throw importFailure('malformed', `bufferView[${index}].byteOffset noto‘g‘ri.`);
    }
    const buffer = buffers[view.buffer];
    if (buffer.uri === undefined) {
      // Declared range must fit the BIN chunk that actually exists, so a huge
      // `byteLength` cannot make the loader allocate past the file.
      const available = bin?.byteLength ?? 0;
      if (offset + byteLength > available) {
        throw importFailure(
          'malformed',
          `bufferView[${index}] BIN chunk chegarasidan tashqarida ` +
            `(${offset + byteLength} > ${available}).`,
        );
      }
      return;
    }
    if (offset + byteLength > (buffer.byteLength ?? 0)) {
      throw importFailure(
        'malformed',
        `bufferView[${index}] buffer chegarasidan tashqarida.`,
      );
    }
    // An external buffer's declared size is not evidence: it is checked against
    // the bytes the user actually selected once they are resolved.
  });
}

function checkAccessors(json: GltfJson): void {
  const views = json.bufferViews ?? [];
  const accessors = json.accessors ?? [];
  accessors.forEach((accessor, index) => {
    if (!isNonNegativeInt(accessor.count)) {
      throw importFailure('malformed', `accessor[${index}].count noto‘g‘ri.`);
    }
    const componentBytes =
      accessor.componentType === undefined ? undefined : COMPONENT_BYTES[accessor.componentType];
    const components = accessor.type === undefined ? undefined : TYPE_COMPONENTS[accessor.type];
    if (componentBytes === undefined || components === undefined) {
      throw importFailure('malformed', `accessor[${index}] turi noma’lum.`);
    }
    if (accessor.bufferView === undefined) {
      // Sparse accessors without a base view are legal but rare; their zero fill
      // costs `count` elements, which the vertex cap already bounds.
      if (accessor.count > MAX_VERTICES) {
        throw importFailure('too_complex', `accessor[${index}] juda ko‘p element.`);
      }
      return;
    }
    if (!isNonNegativeInt(accessor.bufferView) || accessor.bufferView >= views.length) {
      throw importFailure('malformed', `accessor[${index}] bufferView indeksi noto‘g‘ri.`);
    }
    const view = views[accessor.bufferView];
    const viewLength = view.byteLength ?? 0;
    const byteOffset = accessor.byteOffset ?? 0;
    if (!isNonNegativeInt(byteOffset)) {
      throw importFailure('malformed', `accessor[${index}].byteOffset noto‘g‘ri.`);
    }
    // Deliberately conservative: the span a reader needs is at least this much,
    // and for interleaved views the real view is larger, so a legal file passes.
    const span = accessor.count * componentBytes * components;
    if (byteOffset + span > viewLength) {
      throw importFailure(
        'malformed',
        `accessor[${index}] ma’lumoti bufferView hajmiga sig‘maydi ` +
          `(${byteOffset + span} > ${viewLength}).`,
      );
    }
  });
}

function trianglesFor(mode: number, count: number): number {
  if (mode === MODE_TRIANGLES) {
    return Math.floor(count / 3);
  }
  if (mode === MODE_TRIANGLE_STRIP || mode === MODE_TRIANGLE_FAN) {
    return Math.max(0, count - 2);
  }
  return 0;
}

function checkMeshes(json: GltfJson): { meshes: number; primitives: number; triangles: number; vertices: number } {
  const accessors = json.accessors ?? [];
  const meshes = json.meshes ?? [];
  let primitives = 0;
  let triangles = 0;
  let vertices = 0;

  meshes.forEach((mesh, meshIndex) => {
    const list = mesh.primitives ?? [];
    if (list.length === 0) {
      throw importFailure('malformed', `mesh[${meshIndex}] primitivsiz.`);
    }
    list.forEach((primitive, primitiveIndex) => {
      const positionIndex = primitive.attributes?.POSITION;
      if (!isNonNegativeInt(positionIndex) || positionIndex >= accessors.length) {
        throw importFailure(
          'malformed',
          `mesh[${meshIndex}].primitive[${primitiveIndex}] POSITION atributisiz.`,
        );
      }
      const position = accessors[positionIndex];
      vertices += position.count ?? 0;

      let elementCount = position.count ?? 0;
      if (primitive.indices !== undefined) {
        if (!isNonNegativeInt(primitive.indices) || primitive.indices >= accessors.length) {
          throw importFailure(
            'malformed',
            `mesh[${meshIndex}].primitive[${primitiveIndex}] indeks accessor'i noto‘g‘ri.`,
          );
        }
        elementCount = accessors[primitive.indices].count ?? 0;
      }

      primitives += 1;
      triangles += trianglesFor(primitive.mode ?? MODE_TRIANGLES, elementCount);
    });
  });

  if (vertices > MAX_VERTICES) {
    throw importFailure('too_complex', `Model ${vertices} vertexdan iborat (limit ${MAX_VERTICES}).`);
  }
  if (triangles > MAX_TRIANGLES) {
    throw importFailure(
      'too_complex',
      `Model ${triangles} uchburchakdan iborat (limit ${MAX_TRIANGLES}).`,
    );
  }

  return { meshes: meshes.length, primitives, triangles, vertices };
}

/**
 * Rejects a node graph that is not a forest and reports its depth.
 *
 * A cycle would make the loader build a cyclic object graph, and any later
 * `traverse()` (picking, bounds, export) would never terminate — so it is checked
 * from the JSON rather than discovered by hanging the tab.
 */
function checkNodeGraph(json: GltfJson): number {
  const nodes = json.nodes ?? [];
  if (nodes.length > MAX_NODES) {
    throw importFailure('too_complex', `Model ${nodes.length} tugundan iborat (limit ${MAX_NODES}).`);
  }

  const parents = Array.from({ length: nodes.length }, () => 0);
  nodes.forEach((node, index) => {
    for (const child of node.children ?? []) {
      if (!isNonNegativeInt(child) || child >= nodes.length) {
        throw importFailure('malformed', `node[${index}] child indeksi noto‘g‘ri.`);
      }
      parents[child] += 1;
      if (parents[child] > 1) {
        throw importFailure('malformed', `node[${child}] bir nechta ota-onaga ega.`);
      }
    }
  });

  const queue: Array<{ index: number; depth: number }> = [];
  for (let index = 0; index < nodes.length; index += 1) {
    if (parents[index] === 0) {
      queue.push({ index, depth: 1 });
    }
  }

  let deepest = 0;
  let visited = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const { index, depth } = queue[cursor];
    visited += 1;
    deepest = Math.max(deepest, depth);
    if (depth > MAX_NODE_DEPTH) {
      throw importFailure(
        'too_complex',
        `Model ierarxiyasi juda chuqur (limit ${MAX_NODE_DEPTH}).`,
      );
    }
    for (const child of nodes[index].children ?? []) {
      queue.push({ index: child, depth: depth + 1 });
    }
  }

  if (visited !== nodes.length) {
    throw importFailure('malformed', 'Model tugunlarida halqa (cycle) bor.');
  }
  return deepest;
}

function dataUriImageSize(uri: string): { bytes: number; size: { width: number; height: number } | null } | null {
  const match = /^data:([^;,]+)?(;base64)?,/iu.exec(uri);
  if (!match || match[2] !== ';base64') {
    return null;
  }
  const payload = uri.slice(match[0].length);
  const bytes = Math.floor((payload.length * 3) / 4);
  // The header lives in the first few hundred bytes; decode only that prefix.
  const head = payload.slice(0, 512);
  const aligned = head.slice(0, head.length - (head.length % 4));
  try {
    const binary = atob(aligned);
    const buffer = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      buffer[index] = binary.charCodeAt(index);
    }
    return { bytes, size: readImageSize(buffer) };
  } catch {
    return null;
  }
}

function checkImages(
  json: GltfJson,
  bin: Uint8Array | null,
  options: GltfGuardOptions,
  references: ExternalReference[],
): { images: number; textures: number } {
  const images = json.images ?? [];
  const views = json.bufferViews ?? [];

  if (images.length > MAX_EMBEDDED_TEXTURES) {
    throw importFailure(
      'too_complex',
      `Model ${images.length} rasm ichida (limit ${MAX_EMBEDDED_TEXTURES}).`,
    );
  }

  let totalPixels = 0;

  images.forEach((image, index) => {
    if (image.uri !== undefined) {
      if (!image.uri.startsWith('data:')) {
        if (options.externalUris === 'reject') {
          throw importFailure(
            'external_resource',
            `image[${index}] tashqi faylga havola qiladi: "${image.uri}".`,
          );
        }
        // Dimensions can only be read once the file is resolved, so the pixel
        // budget for external images is enforced there.
        references.push({
          kind: 'image',
          uri: image.uri,
          index,
          byteLength: null,
          mimeType: image.mimeType ?? null,
        });
        return;
      }
      const decoded = dataUriImageSize(image.uri);
      if (!decoded) {
        throw importFailure('malformed', `image[${index}] data URI o‘qilmadi.`);
      }
      if (decoded.bytes > MAX_TEXTURE_IMAGE_BYTES) {
        throw importFailure('too_complex', `image[${index}] hajmi juda katta.`);
      }
      if (!decoded.size) {
        throw importFailure('unsupported_format', `image[${index}] PNG yoki JPEG emas.`);
      }
      if (
        decoded.size.width > MAX_TEXTURE_DIMENSION ||
        decoded.size.height > MAX_TEXTURE_DIMENSION
      ) {
        throw importFailure(
          'too_complex',
          `image[${index}] o‘lchami ${decoded.size.width}×${decoded.size.height} (limit ${MAX_TEXTURE_DIMENSION}).`,
        );
      }
      totalPixels += decoded.size.width * decoded.size.height;
      return;
    }

    if (!isNonNegativeInt(image.bufferView) || image.bufferView >= views.length) {
      throw importFailure('malformed', `image[${index}] manbasi yo‘q.`);
    }
    if (image.mimeType !== 'image/png' && image.mimeType !== 'image/jpeg') {
      throw importFailure(
        'unsupported_format',
        `image[${index}] turi "${image.mimeType ?? 'noma’lum'}" — faqat PNG va JPEG.`,
      );
    }

    const view = views[image.bufferView];
    const viewLength = view.byteLength ?? 0;
    if (viewLength > MAX_TEXTURE_IMAGE_BYTES) {
      throw importFailure(
        'too_complex',
        `image[${index}] ${viewLength} bayt (limit ${MAX_TEXTURE_IMAGE_BYTES}).`,
      );
    }
    const bytes = bytesOfView(view, bin);
    const size = bytes ? readImageSize(bytes) : null;
    if (!bytes || !size) {
      throw importFailure('malformed', `image[${index}] sarlavhasi o‘qilmadi.`);
    }
    if (size.width > MAX_TEXTURE_DIMENSION || size.height > MAX_TEXTURE_DIMENSION) {
      throw importFailure(
        'too_complex',
        `image[${index}] o‘lchami ${size.width}×${size.height} (limit ${MAX_TEXTURE_DIMENSION}).`,
      );
    }
    totalPixels += size.width * size.height;
  });

  if (totalPixels > MAX_TOTAL_TEXTURE_PIXELS) {
    throw importFailure(
      'too_complex',
      `Rasmlarning umumiy pikseli ${totalPixels} (limit ${MAX_TOTAL_TEXTURE_PIXELS}).`,
    );
  }

  return { images: images.length, textures: (json.textures ?? []).length };
}

function bytesOfView(
  view: { byteOffset?: number; byteLength?: number },
  bin: Uint8Array | null,
): Uint8Array | null {
  if (!bin) {
    return null;
  }
  const offset = view.byteOffset ?? 0;
  const length = view.byteLength ?? 0;
  if (offset + length > bin.byteLength) {
    return null;
  }
  return bin.subarray(offset, offset + length);
}

/**
 * Applies the full document policy and returns the counts the UI shows.
 *
 * Throws `ImportError` on the first problem; the caller therefore never gets a
 * partially accepted document.
 */
export function guardGltfDocument(
  json: GltfJson,
  bin: Uint8Array | null,
  options: GltfGuardOptions = { externalUris: 'reject' },
): GltfDocumentStats {
  const references: ExternalReference[] = [];
  checkVersion(json);

  // A JSON chunk larger than the limit would already be in memory, but its parse
  // cost is proportional to size, so it is refused rather than tolerated.
  const jsonCost = JSON.stringify(json).length;
  if (jsonCost > MAX_GLTF_JSON_BYTES) {
    throw importFailure('too_complex', 'glTF hujjati juda katta.');
  }

  checkRequiredExtensions(json);
  checkScenes(json);

  if ((json.skins ?? []).length > 0) {
    throw importFailure(
      'unsupported_extension',
      'Skeletli (skinned) modellar qo‘llab-quvvatlanmaydi: import qilingan model ' +
        'klonlanganda suyaklar umumiy bo‘lib qoladi va noto‘g‘ri ko‘rinadi.',
    );
  }

  checkBuffers(json, bin, options, references);
  checkBufferViews(json, bin);
  checkAccessors(json);

  const meshStats = checkMeshes(json);
  const nodes = checkNodeGraph(json);
  const imageStats = checkImages(json, bin, options, references);

  return {
    ...meshStats,
    materials: (json.materials ?? []).length,
    textures: imageStats.textures,
    images: imageStats.images,
    nodes,
    externalReferences: references,
  };
}
