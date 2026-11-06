/**
 * Phase 6.2.2/6.2.3 — text-format fixtures built in code.
 *
 * `.gltf` and `.obj` are text, so a test can state exactly the document it needs —
 * including deliberately broken ones — instead of checking in binary blobs.
 */
import { triangleJson, triangleBin } from './glbFixtures';
import { testPngBytes } from '../../export/pngFixture';

export interface GltfBundle {
  /** The `.gltf` document as text. */
  readonly json: string;
  /** Companion buffer file. */
  readonly bin: Uint8Array;
  /** Companion texture. */
  readonly png: Uint8Array;
}

/**
 * A `.gltf` that references an external buffer and an external texture.
 *
 * This is the shape every DCC exporter produces with "separate files": the
 * document alone is useless, and the import has to resolve both companions.
 */
export function triangleGltf(patch?: (json: Record<string, unknown>) => void): GltfBundle {
  const json = triangleJson();
  (json.buffers as Array<Record<string, unknown>>)[0] = {
    uri: 'triangle.bin',
    byteLength: 42,
  };
  json.images = [{ uri: 'wood.png' }];
  json.textures = [{ source: 0 }];
  (json.materials as Array<Record<string, unknown>>)[0] = {
    name: 'Paint',
    pbrMetallicRoughness: {
      baseColorTexture: { index: 0 },
      baseColorFactor: [0.5, 0.2, 0.1, 1],
    },
  };
  patch?.(json);
  return { json: JSON.stringify(json), bin: triangleBin(), png: testPngBytes(2, 2) };
}

/** A quad with UVs and one material — two triangles. */
export function quadObj(): string {
  return [
    '# exported by hand',
    'mtllib chair.mtl',
    'o Chair',
    'v 0 0 0',
    'v 1 0 0',
    'v 1 0 1',
    'v 0 0 1',
    'vt 0 0',
    'vt 1 0',
    'vt 1 1',
    'vt 0 1',
    'usemtl Wood',
    'f 1/1 2/2 3/3 4/4',
    '',
  ].join('\n');
}

/** A two-material cube-ish OBJ: two groups, two `usemtl` names. */
export function twoMaterialObj(): string {
  return [
    'mtllib parts.mtl',
    'o Top',
    'v 0 0 0',
    'v 1 0 0',
    'v 1 0 1',
    'v 0 0 1',
    'usemtl Wood',
    'f 1 2 3 4',
    'o Leg',
    'v 0 1 0',
    'v 0.1 1 0',
    'v 0.1 1 0.1',
    'v 0 1 0.1',
    'usemtl Metal',
    'f 5 6 7 8',
    '',
  ].join('\n');
}

/** The MTL companion for the fixtures above. */
export function chairMtl(): string {
  return [
    'newmtl Wood',
    'Kd 0.8 0.4 0.2',
    'Ks 0.1 0.1 0.1',
    'Ns 200',
    'd 0.9',
    'map_Kd wood.png',
    '',
    'newmtl Metal',
    'Kd 0.5 0.5 0.5',
    'Ks 1 1 1',
    'Ns 800',
    '',
  ].join('\n');
}

/** A `data:` URI PNG, used to check that embedded resources still work. */
export function pngDataUri(): string {
  const bytes = testPngBytes(2, 2);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:image/png;base64,${btoa(binary)}`;
}
