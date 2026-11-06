/**
 * Extract the 2K PBR maps from the finished GLB into buyer-facing PNG files.
 *
 * The browser export already produced and validated the images. Extracting the
 * exact bytes from the GLB (instead of re-encoding the generator canvases) keeps
 * the external files byte-identical to what the buyer downloads and avoids the
 * headless canvas encoder stalling on 2048 px normal/ORM canvases.
 */
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) {
    throw new Error('Not a GLB file.');
  }
  const length = buffer.readUInt32LE(8);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + chunkLength);
    if (chunkType === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    if (chunkType === 0x004e4942) bin = chunk;
    offset += 8 + chunkLength;
  }
  if (!json || !bin) throw new Error('GLB is missing its JSON or BIN chunk.');
  return { json, bin };
}

function pngImage(json, bin, textureIndex) {
  const texture = json.textures?.[textureIndex];
  if (!texture) throw new Error(`Missing texture ${textureIndex}.`);
  const image = json.images?.[texture.source];
  if (!image) throw new Error(`Missing image for texture ${textureIndex}.`);
  const view = json.bufferViews?.[image.bufferView];
  if (!view) throw new Error(`Missing bufferView for image ${texture.source}.`);
  const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  return { bytes, mimeType: image.mimeType ?? null };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Decode an 8-bit, non-interlaced RGBA PNG. */
export function decodeRgbaPng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Not a PNG.');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`Unsupported PNG (bit ${bitDepth}, colour ${colorType}, interlace ${interlace}).`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * bpp);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[source];
    source += 1;
    const rowStart = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[source + x];
      const left = x >= bpp ? out[rowStart + x - bpp] : 0;
      const up = y > 0 ? out[rowStart - stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[rowStart - stride + x - bpp] : 0;
      let decoded;
      switch (filter) {
        case 0:
          decoded = value;
          break;
        case 1:
          decoded = value + left;
          break;
        case 2:
          decoded = value + up;
          break;
        case 3:
          decoded = value + Math.floor((left + up) / 2);
          break;
        case 4:
          decoded = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`Unsupported PNG filter ${filter}.`);
      }
      out[rowStart + x] = decoded & 0xff;
    }
    source += stride;
  }
  return { width, height, data: out };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
}

/** Encode an 8-bit grayscale PNG. */
export function encodeGrayscalePng(width, height, gray) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    Buffer.from(gray.buffer, gray.byteOffset + y * width, width).copy(
      raw,
      y * (width + 1) + 1,
    );
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function materialTextureIndices(material) {
  const pbr = material.pbrMetallicRoughness ?? {};
  return {
    baseColor: pbr.baseColorTexture?.index,
    normal: material.normalTexture?.index,
    metallicRoughness: pbr.metallicRoughnessTexture?.index,
  };
}

/**
 * Write `{Material}_BaseColor.png`, `_Normal_OpenGL.png`, `_Roughness.png` and
 * `_Metalness.png` for every material that carries the four premium channels.
 * Roughness and metalness are split from the glTF metallicRoughness ORM texture
 * (G = roughness, B = metalness).
 */
export function extractTexturesFromGlb(glb, outDir, writeFile) {
  const { json, bin } = parseGlb(glb);
  const manifest = [];
  for (const material of json.materials ?? []) {
    const indices = materialTextureIndices(material);
    if (
      indices.baseColor === undefined ||
      indices.normal === undefined ||
      indices.metallicRoughness === undefined
    ) {
      continue;
    }
    const base = pngImage(json, bin, indices.baseColor);
    const normal = pngImage(json, bin, indices.normal);
    const orm = pngImage(json, bin, indices.metallicRoughness);
    const decoded = decodeRgbaPng(orm.bytes);
    const roughness = Buffer.alloc(decoded.width * decoded.height);
    const metalness = Buffer.alloc(decoded.width * decoded.height);
    for (let pixel = 0; pixel < decoded.width * decoded.height; pixel += 1) {
      roughness[pixel] = decoded.data[pixel * 4 + 1];
      metalness[pixel] = decoded.data[pixel * 4 + 2];
    }
    const files = [
      {
        role: 'baseColor',
        suffix: 'BaseColor',
        bytes: base.bytes,
        colorSpace: 'sRGB',
      },
      {
        role: 'normal',
        suffix: 'Normal_OpenGL',
        bytes: normal.bytes,
        colorSpace: 'linear',
      },
      {
        role: 'roughness',
        suffix: 'Roughness',
        bytes: encodeGrayscalePng(decoded.width, decoded.height, roughness),
        colorSpace: 'linear',
      },
      {
        role: 'metalness',
        suffix: 'Metalness',
        bytes: encodeGrayscalePng(decoded.width, decoded.height, metalness),
        colorSpace: 'linear',
      },
    ];
    for (const file of files) {
      const name = `${material.name}_${file.suffix}.png`;
      const buffer = Buffer.from(file.bytes);
      writeFile(outDir, name, buffer);
      manifest.push({
        material: material.name,
        role: file.role,
        name,
        width: decoded.width,
        height: decoded.height,
        colorSpace: file.colorSpace,
        bytes: buffer.byteLength,
        sha256: createHash('sha256').update(buffer).digest('hex'),
      });
    }
  }
  return {
    manifest,
    ormChannels: { r: 'occlusion (0)', g: 'roughness', b: 'metalness' },
  };
}
