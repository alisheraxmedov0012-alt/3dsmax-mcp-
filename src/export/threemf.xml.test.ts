// @vitest-environment jsdom
/**
 * B2 — the 3MF XML must be well-formed, not merely string-shaped.
 *
 * The node test parses attributes with regexes to stay dependency-free; this
 * test uses jsdom's XML parser to prove the document has no parser errors and
 * that every triangle references an existing vertex.
 */
import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { exportSceneToFormat } from './sceneFileExport';
import { createTableSceneObject, SCENE_SCHEMA_VERSION, type SceneData } from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import type { ExportMetadata } from './exportTypes';

const META: ExportMetadata = { name: 'XML test', furnitureType: 'table', units: 'cm' };

function scene(): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
    objects: [createTableSceneObject('t1')],
    settings: createDefaultSettings(),
  };
}

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function readBlob(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(new Uint8Array(reader.result as ArrayBuffer)), {
      once: true,
    });
    reader.addEventListener('error', () => reject(reader.error), { once: true });
    reader.readAsArrayBuffer(blob);
  });
}

async function archive(): Promise<Record<string, Uint8Array>> {
  const artifact = await exportSceneToFormat('3mf', scene(), META, { includeRoom: false });
  return unzipSync(await readBlob(artifact.blob));
}

describe('B2 — 3MF XML integrity', () => {
  it('parses every part without an XML error', async () => {
    const files = await archive();
    for (const name of ['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']) {
      const document = parseXml(new TextDecoder().decode(files[name]));
      expect(document.querySelector('parsererror'), name).toBeNull();
    }
  });

  it('declares the core namespace and millimetres', async () => {
    const files = await archive();
    const document = parseXml(new TextDecoder().decode(files['3D/3dmodel.model']));
    const model = document.documentElement;
    expect(model.nodeName).toBe('model');
    expect(model.namespaceURI).toBe('http://schemas.microsoft.com/3dmanufacturing/core/2015/02');
    expect(model.getAttribute('unit')).toBe('millimeter');
  });

  it('keeps every triangle inside its object and every coordinate finite', async () => {
    const files = await archive();
    const document = parseXml(new TextDecoder().decode(files['3D/3dmodel.model']));
    const objects = Array.from(document.getElementsByTagName('object'));
    expect(objects.length).toBeGreaterThan(0);

    let triangles = 0;
    for (const object of objects) {
      const vertices = Array.from(object.getElementsByTagName('vertex'));
      const faces = Array.from(object.getElementsByTagName('triangle'));
      expect(vertices.length).toBeGreaterThan(0);
      expect(faces.length).toBeGreaterThan(0);
      for (const vertex of vertices) {
        for (const axis of ['x', 'y', 'z']) {
          expect(Number.isFinite(Number(vertex.getAttribute(axis)))).toBe(true);
        }
      }
      for (const face of faces) {
        for (const key of ['v1', 'v2', 'v3']) {
          const index = Number(face.getAttribute(key));
          expect(Number.isInteger(index)).toBe(true);
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(vertices.length);
        }
        triangles += 1;
      }
    }
    expect(triangles).toBe(60);
  });

  it('lists every object in the build', async () => {
    const files = await archive();
    const document = parseXml(new TextDecoder().decode(files['3D/3dmodel.model']));
    const objects = Array.from(document.getElementsByTagName('object'));
    const items = Array.from(document.getElementsByTagName('item'));
    expect(items).toHaveLength(objects.length);
    expect(items.map((item) => item.getAttribute('objectid'))).toEqual(
      objects.map((object) => object.getAttribute('id')),
    );
  });
});
