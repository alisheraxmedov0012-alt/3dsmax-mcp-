/**
 * Canonicalise a GLB whose images were written in asynchronous completion order.
 *
 * Three's GLTFExporter appends image bufferViews as each canvas finishes
 * encoding, so two runs with identical pixels can still differ in `images[]`
 * and `bufferViews[]` order. Marketplace artifacts must be byte-reproducible:
 * this pass orders images by material + map role, rebuilds the BIN chunk with
 * 4-byte alignment, remaps every reference and returns a deterministic GLB.
 */
import { createHash } from 'node:crypto';

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) throw new Error('Not a GLB file.');
  const length = buffer.readUInt32LE(8);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + chunkLength);
    if (chunkType === CHUNK_JSON) json = JSON.parse(chunk.toString('utf8'));
    if (chunkType === CHUNK_BIN) bin = chunk;
    offset += 8 + chunkLength;
  }
  if (!json || !bin) throw new Error('GLB is missing its JSON or BIN chunk.');
  return { json, bin };
}

function chunkHeader(length, type) {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(length, 0);
  header.writeUInt32LE(type, 4);
  return header;
}

function materialRoles(material) {
  const pbr = material.pbrMetallicRoughness ?? {};
  return [
    pbr.baseColorTexture?.index,
    material.normalTexture?.index,
    pbr.metallicRoughnessTexture?.index,
    material.occlusionTexture?.index,
    material.emissiveTexture?.index,
  ].filter((value) => value !== undefined);
}

export function canonicalizeGlb(buffer) {
  const { json, bin } = parseGlb(buffer);
  const images = json.images ?? [];
  if (images.length === 0) return Buffer.from(buffer);

  const textureSource = (textureIndex) => json.textures?.[textureIndex]?.source;
  const order = [];
  const seen = new Set();
  for (const material of json.materials ?? []) {
    for (const textureIndex of materialRoles(material)) {
      const imageIndex = textureSource(textureIndex);
      if (imageIndex === undefined || seen.has(imageIndex)) continue;
      seen.add(imageIndex);
      order.push(imageIndex);
    }
  }
  for (let index = 0; index < images.length; index += 1) {
    if (!seen.has(index)) {
      seen.add(index);
      order.push(index);
    }
  }
  if (order.length !== images.length) {
    throw new Error('Image order does not cover every image.');
  }

  const oldToNewImage = new Map(order.map((oldIndex, newIndex) => [oldIndex, newIndex]));
  const imageViewSet = new Set(
    images
      .map((image) => image.bufferView)
      .filter((viewIndex) => viewIndex !== undefined),
  );
  const nonImageViewIndices = json.bufferViews
    .map((_, index) => index)
    .filter((index) => !imageViewSet.has(index));

  const newBufferViews = [];
  const oldToNewView = new Map();
  const parts = [];
  let offset = 0;
  const pushView = (oldIndex) => {
    const view = json.bufferViews[oldIndex];
    const start = view.byteOffset ?? 0;
    const bytes = bin.subarray(start, start + view.byteLength);
    const padding = (4 - (offset % 4)) % 4;
    if (padding > 0) {
      parts.push(Buffer.alloc(padding));
      offset += padding;
    }
    oldToNewView.set(oldIndex, newBufferViews.length);
    newBufferViews.push({ ...view, byteOffset: offset });
    parts.push(Buffer.from(bytes));
    offset += bytes.length;
  };

  for (const viewIndex of nonImageViewIndices) pushView(viewIndex);
  for (const imageIndex of order) {
    const viewIndex = images[imageIndex].bufferView;
    if (viewIndex !== undefined) pushView(viewIndex);
  }

  const binOut = Buffer.concat(parts, offset);
  const oldImages = images;
  json.images = order.map((oldIndex) => {
    const image = { ...oldImages[oldIndex] };
    if (image.bufferView !== undefined) {
      image.bufferView = oldToNewView.get(image.bufferView);
    }
    return image;
  });
  json.textures = (json.textures ?? []).map((texture) => {
    const next = { ...texture };
    if (texture.source !== undefined) {
      next.source = oldToNewImage.get(texture.source);
    }
    return next;
  });
  json.bufferViews = newBufferViews;
  if (json.buffers?.[0]) {
    json.buffers[0].byteLength = binOut.length;
  }

  // Accessors can reference bufferViews even when images were interspersed.
  json.accessors = (json.accessors ?? []).map((accessor) => {
    const next = { ...accessor };
    if (accessor.bufferView !== undefined) {
      next.bufferView = oldToNewView.get(accessor.bufferView);
    }
    if (accessor.sparse) {
      next.sparse = {
        ...accessor.sparse,
        indices: { ...accessor.sparse.indices },
        values: { ...accessor.sparse.values },
      };
      if (accessor.sparse.indices.bufferView !== undefined) {
        next.sparse.indices.bufferView = oldToNewView.get(
          accessor.sparse.indices.bufferView,
        );
      }
      if (accessor.sparse.values.bufferView !== undefined) {
        next.sparse.values.bufferView = oldToNewView.get(
          accessor.sparse.values.bufferView,
        );
      }
    }
    return next;
  });

  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPadding, 0x20)]);
  const binPadding = (4 - (binOut.length % 4)) % 4;
  const binChunk = Buffer.concat([binOut, Buffer.alloc(binPadding)]);
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  return Buffer.concat([
    header,
    chunkHeader(jsonChunk.length, CHUNK_JSON),
    jsonChunk,
    chunkHeader(binChunk.length, CHUNK_BIN),
    binChunk,
  ]);
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
