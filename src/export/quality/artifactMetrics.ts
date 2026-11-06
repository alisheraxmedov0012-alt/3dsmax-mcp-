import type { ExportFormatId } from '../exportFormats';

interface GltfImage {
  bufferView?: number;
  uri?: string;
}

interface GltfJson {
  images?: GltfImage[];
  bufferViews?: Array<{ byteLength?: number }>;
}

const CHUNK_JSON = 0x4e4f534a;

function base64Bytes(value: string): number {
  const comma = value.indexOf(',');
  if (comma === -1) return 0;
  const payload = value.slice(comma + 1).replace(/\s/gu, '');
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function imagePayload(json: GltfJson): number | undefined {
  let total = 0;
  for (const image of json.images ?? []) {
    if (typeof image.bufferView === 'number') {
      const bytes = json.bufferViews?.[image.bufferView]?.byteLength;
      if (typeof bytes !== 'number') return undefined;
      total += bytes;
      continue;
    }
    if (typeof image.uri === 'string' && image.uri.startsWith('data:')) {
      total += base64Bytes(image.uri);
      continue;
    }
    // An external image is not a self-contained payload this check can measure.
    if (image.uri) return undefined;
  }
  return total;
}

function parseGlbJson(buffer: ArrayBuffer): GltfJson | null {
  const view = new DataView(buffer);
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) return null;
  const total = view.getUint32(8, true);
  let offset = 12;
  while (offset + 8 <= total && offset + 8 <= view.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (type === CHUNK_JSON) {
      try {
        return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset + 8, length)));
      } catch {
        return null;
      }
    }
    offset += 8 + length;
  }
  return null;
}

/** Exact embedded image bytes in a produced GLB/glTF, or undefined when unmeasurable. */
export async function measureTexturePayloadBytes(
  format: ExportFormatId,
  blob: Blob,
): Promise<number | undefined> {
  try {
    if (format === 'glb') {
      const json = parseGlbJson(await blob.arrayBuffer());
      return json ? imagePayload(json) : undefined;
    }
    if (format === 'gltf') {
      const parsed = JSON.parse(await blob.text()) as GltfJson;
      return imagePayload(parsed);
    }
    return 0;
  } catch {
    return undefined;
  }
}
