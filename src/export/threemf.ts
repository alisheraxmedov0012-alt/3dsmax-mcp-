/**
 * B2 — genuine 3MF export (3D Manufacturing Format, core specification).
 *
 * 3MF is an OPC package: a ZIP containing `[Content_Types].xml`, `_rels/.rels`
 * and an XML model part. Renaming a mesh file is not 3MF; this module writes the
 * real package with the core namespace and `unit="millimeter"`.
 *
 * Scope, stated plainly:
 * - geometries and world transforms only; colours, textures and 3MF materials
 *   are **not** written;
 * - one `<object>` per mesh, referenced from `<build>`; part names are kept as
 *   object names, but no assembly hierarchy is claimed;
 * - coordinates are converted once from the scene's centimetres to millimetres;
 * - the archive is deterministic for a given timestamp (see `timestamp`).
 *
 * The file is built from real mesh data; no external tool or dependency beyond
 * the existing `fflate` is used.
 */
import * as THREE from 'three';
import { zipSync } from 'fflate';
import { ExportError } from './exportTypes';

export const THREE_MF_MIME = 'model/3mf';

/** Fixed core-spec namespace. */
const CORE_NAMESPACE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const RELATIONSHIP_TYPE = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="${RELATIONSHIP_TYPE}"/>
</Relationships>`;

export interface ThreeMfOptions {
  title?: string;
  /** ZIP entry timestamp; defaults to now. Pass a fixed date for reproducible bytes. */
  timestamp?: Date;
}

interface CollectedMesh {
  name: string;
  vertices: Array<{ x: number; y: number; z: number }>;
  triangles: Array<[number, number, number]>;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Millimetre text with at most four decimals, never an exponent. */
function mm(value: number): string {
  if (!Number.isFinite(value)) {
    throw new ExportError(
      'invalid_geometry',
      "3MF eksportida cheksiz koordinata topildi — fayl yozilmadi.",
    );
  }
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function isWorldVisible(object: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object;
  while (node) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
}

function collectMesh(mesh: THREE.Mesh, fallbackName: string): CollectedMesh | null {
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
  const position = geometry?.getAttribute?.('position') as
    | THREE.BufferAttribute
    | THREE.InterleavedBufferAttribute
    | undefined;
  if (!position || position.count === 0) {
    return null;
  }

  const indexAttribute = geometry?.getIndex();
  const indices: number[] = [];
  if (indexAttribute) {
    for (let i = 0; i < indexAttribute.count; i += 1) indices.push(indexAttribute.getX(i));
  } else {
    for (let i = 0; i < position.count; i += 1) indices.push(i);
  }
  if (indices.length % 3 !== 0) {
    throw new ExportError('invalid_geometry', "3MF uchun tugallanmagan uchburchak topildi.");
  }

  const vertexMap = new Map<string, number>();
  const vertices: CollectedMesh['vertices'] = [];
  const remap = (vertexIndex: number): number => {
    if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= position.count) {
      throw new ExportError('invalid_geometry', "3MF uchun noto'g'ri indeks topildi.");
    }
    const world = new THREE.Vector3(
      position.getX(vertexIndex),
      position.getY(vertexIndex),
      position.getZ(vertexIndex),
    ).applyMatrix4(mesh.matrixWorld);
    // Scene units are centimetres; 3MF is millimetres. Convert exactly once here.
    const x = world.x * 10;
    const y = world.y * 10;
    const z = world.z * 10;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new ExportError(
        'invalid_geometry',
        "3MF eksportida cheksiz koordinata topildi — fayl yozilmadi.",
      );
    }
    const key = `${Math.round(x * 10000)},${Math.round(y * 10000)},${Math.round(z * 10000)}`;
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    const id = vertices.length;
    vertexMap.set(key, id);
    vertices.push({ x, y, z });
    return id;
  };

  const triangles: CollectedMesh['triangles'] = [];
  for (let triangle = 0; triangle < indices.length / 3; triangle += 1) {
    const a = remap(indices[triangle * 3]);
    const b = remap(indices[triangle * 3 + 1]);
    const c = remap(indices[triangle * 3 + 2]);
    triangles.push([a, b, c]);
  }

  if (triangles.length === 0) {
    return null;
  }
  return {
    name: mesh.name || fallbackName,
    vertices,
    triangles,
  };
}

function objectXml(mesh: CollectedMesh, id: number): string {
  const vertices = mesh.vertices
    .map((vertex) => `        <vertex x="${mm(vertex.x)}" y="${mm(vertex.y)}" z="${mm(vertex.z)}"/>`)
    .join('\n');
  const triangles = mesh.triangles
    .map(([a, b, c]) => `        <triangle v1="${a}" v2="${b}" v3="${c}"/>`)
    .join('\n');
  return `    <object id="${id}" type="model" name="${escapeXml(mesh.name)}">
      <mesh>
        <vertices>
${vertices}
        </vertices>
        <triangles>
${triangles}
        </triangles>
      </mesh>
    </object>`;
}

function modelXml(meshes: readonly CollectedMesh[], title: string | undefined): string {
  const objects = meshes.map((mesh, index) => objectXml(mesh, index + 1)).join('\n');
  const items = meshes.map((_, index) => `    <item objectid="${index + 1}"/>`).join('\n');
  const metadata =
    title && title.trim() !== ''
      ? `  <metadata name="Title">${escapeXml(title.trim())}</metadata>\n`
      : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NAMESPACE}">
${metadata}  <resources>
${objects}
  </resources>
  <build>
${items}
  </build>
</model>
`;
}

/**
 * Build a 3MF package from the meshes under `root`.
 *
 * `root` must already contain the objects to export with their world transforms;
 * hidden objects should have been pruned by the caller. Throws `ExportError`
 * with code `invalid_geometry` or `empty_scene` instead of writing a broken file.
 */
export function buildThreeMf(
  root: THREE.Object3D,
  options: ThreeMfOptions = {},
): Uint8Array<ArrayBuffer> {
  root.updateMatrixWorld(true);

  const meshes: CollectedMesh[] = [];
  let index = 0;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !isWorldVisible(mesh)) return;
    index += 1;
    const collected = collectMesh(mesh, `mesh-${index}`);
    if (collected) meshes.push(collected);
  });

  if (meshes.length === 0) {
    throw new ExportError(
      'empty_scene',
      "3MF eksport qilish uchun ko'rinadigan geometriya yo'q.",
    );
  }

  const encoder = new TextEncoder();
  const files = {
    '[Content_Types].xml': encoder.encode(CONTENT_TYPES_XML),
    '_rels/.rels': encoder.encode(RELS_XML),
    '3D/3dmodel.model': encoder.encode(modelXml(meshes, options.title)),
  };

  try {
    return zipSync(files, {
      level: 6,
      ...(options.timestamp ? { mtime: options.timestamp } : {}),
    }) as Uint8Array<ArrayBuffer>;
  } catch (error) {
    throw new ExportError(
      'failed',
      error instanceof Error && error.message
        ? `3MF arxivi yaratilmadi: ${error.message}`
        : '3MF arxivi yaratilmadi.',
    );
  }
}
