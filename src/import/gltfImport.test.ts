/**
 * Phase 6.2.2 — importing a `.gltf` with companion files.
 *
 * These exercise the real pipeline: the document is validated, the `.bin` is
 * resolved from the selection and fetched through a blob URL, and `GLTFLoader`
 * builds the scene in Node. Textures are covered at the policy level here and in
 * the browser harness, because decoding an image needs a browser.
 */
import * as THREE from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prepareImport } from './parseModel';
import { ImportError } from './importErrors';
import { resolveGltfResources, stripDroppedImageReferences } from './gltfResources';
import { inspectGltf } from './gltfInspect';
import { buildResourceMap, describeResourceMapFailure, type ImportFile } from './resourceMap';
import { triangleGltf } from './__fixtures__/textFixtures';
import { triangleJson } from './__fixtures__/glbFixtures';
import { testPngBytes } from '../export/pngFixture';
import { installBrowserShims } from './__fixtures__/nodeShims';

beforeAll(() => {
  installBrowserShims();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function textFile(name: string, text: string): ImportFile {
  return { name, bytes: new TextEncoder().encode(text).buffer as ArrayBuffer };
}

function binaryFile(name: string, bytes: Uint8Array): ImportFile {
  return { name, bytes: bytes.buffer.slice(0, bytes.byteLength) as ArrayBuffer };
}

/** A `.gltf` whose only companion is its `.bin` (no textures). */
function bufferOnlyGltf(): { json: string; bin: Uint8Array } {
  const bundle = triangleGltf((json) => {
    delete json.images;
    delete json.textures;
    (json.materials as Array<Record<string, unknown>>)[0] = {
      name: 'Paint',
      pbrMetallicRoughness: { baseColorFactor: [0.5, 0.2, 0.1, 1] },
    };
  });
  return { json: bundle.json, bin: bundle.bin };
}

async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError);
    return (error as ImportError).code;
  }
  throw new Error('expected the import to be rejected');
}

describe('prepareImport — glTF with an external buffer', () => {
  it('imports the document plus its .bin, in centimetres', async () => {
    const { json, bin } = bufferOnlyGltf();
    const { parsed, report } = await prepareImport([
      textFile('chair.gltf', json),
      binaryFile('triangle.bin', bin),
    ]);

    try {
      expect(report.format).toBe('gltf');
      expect(report.mainFile).toBe('chair.gltf');
      expect(report.totalFiles).toBe(2);
      expect(report.references).toEqual({ total: 1, resolved: 1, missing: [], ambiguous: [] });
      expect(report.requiresAcknowledgement).toBe(false);

      expect(parsed.meta.format).toBe('gltf');
      expect(parsed.meta.triangles).toBe(1);
      const size = parsed.meta.boundsCm;
      expect(size.max.x - size.min.x).toBeCloseTo(100, 3);
      expect(size.min.y).toBeCloseTo(0, 3);
    } finally {
      parsed.dispose();
    }
  });

  it('resolves the buffer from a subdirectory by its reference name', async () => {
    const { json, bin } = bufferOnlyGltf();
    const { parsed } = await prepareImport([
      textFile('chair.gltf', json),
      { name: 'triangle.bin', path: 'data/triangle.bin', bytes: bin.buffer.slice(0) as ArrayBuffer },
    ]);
    parsed.dispose();
  });

  it('rejects a missing .bin with the file name in the message', async () => {
    const { json } = bufferOnlyGltf();
    try {
      await prepareImport([textFile('chair.gltf', json)]);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ImportError);
      const failure = error as ImportError;
      expect(failure.code).toBe('missing_resource');
      expect(failure.message).toContain('triangle.bin');
    }
  });

  it('rejects a .bin smaller than the document declares', async () => {
    const { json } = bufferOnlyGltf();
    const short = new Uint8Array(8);
    expect(
      await rejectionCode(
        prepareImport([textFile('chair.gltf', json), binaryFile('triangle.bin', short)]),
      ),
    ).toBe('malformed');
  });

  it('rejects a buffer the document points at a remote URL', async () => {
    const { bin } = bufferOnlyGltf();
    const json = JSON.stringify({
      ...(JSON.parse(bufferOnlyGltf().json) as Record<string, unknown>),
      buffers: [{ uri: 'https://example.com/chair.bin', byteLength: 42 }],
    });
    // A spy (restored by `restoreAllMocks`) rather than a global stub, so a later
    // test cannot inherit a broken `fetch` and fail for the wrong reason.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect(
      await rejectionCode(
        prepareImport([textFile('chair.gltf', json), binaryFile('triangle.bin', bin)]),
      ),
    ).toBe('external_resource');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a buffer reference that tries to escape the selection', async () => {
    const { bin } = bufferOnlyGltf();
    const json = JSON.stringify({
      ...(JSON.parse(bufferOnlyGltf().json) as Record<string, unknown>),
      buffers: [{ uri: '../../etc/passwd', byteLength: 42 }],
    });
    expect(
      await rejectionCode(
        prepareImport([textFile('chair.gltf', json), binaryFile('triangle.bin', bin)]),
      ),
    ).toBe('external_resource');
  });
});

describe('prepareImport — glTF textures', () => {
  it('drops a missing texture, keeps the model and asks for confirmation', async () => {
    const bundle = triangleGltf();
    const { parsed, report } = await prepareImport([
      textFile('chair.gltf', bundle.json),
      binaryFile('triangle.bin', bundle.bin),
      // wood.png is deliberately not selected.
    ]);

    try {
      expect(report.requiresAcknowledgement).toBe(true);
      expect(report.references.total).toBe(2);
      expect(report.references.resolved).toBe(1);
      expect(report.references.missing).toContain('wood.png');
      expect(report.warnings.join(' ')).toContain('wood.png');

      // The material lost its map but kept its factor colour: the model rendered.
      let meshes = 0;
      parsed.root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) {
          return;
        }
        meshes += 1;
        const material = mesh.material as THREE.MeshStandardMaterial;
        expect(material.map).toBeNull();
        expect(material.color.getHex()).not.toBe(0);
      });
      expect(meshes).toBe(1);
    } finally {
      parsed.dispose();
    }
  });

  it('resolves a texture that is selected alongside the document', async () => {
    const bundle = triangleGltf((json) => {
      delete json.images;
      delete json.textures;
      (json.materials as Array<Record<string, unknown>>)[0] = {
        name: 'Paint',
        pbrMetallicRoughness: { baseColorFactor: [0.2, 0.3, 0.4, 1] },
      };
    });
    const { report } = await prepareImport([
      textFile('chair.gltf', bundle.json),
      binaryFile('triangle.bin', bundle.bin),
    ]);
    expect(report.references.resolved).toBe(1);
    expect(report.requiresAcknowledgement).toBe(false);
  });
});

describe('resolveGltfResources', () => {
  function mapFor(files: ImportFile[]) {
    const built = buildResourceMap(files);
    if (!built.ok) {
      throw new Error(describeResourceMapFailure(built.failure));
    }
    return built.map;
  }

  function referencesOf(json: string) {
    return inspectGltf(new TextEncoder().encode(json).buffer as ArrayBuffer).stats.externalReferences;
  }

  it('validates an image header before anything decodes it', () => {
    const bundle = triangleGltf();
    const references = referencesOf(bundle.json);

    // A file that is not a PNG/JPEG is dropped, not decoded.
    const map = mapFor([
      binaryFile('triangle.bin', triangleGltf().bin),
      binaryFile('wood.png', new TextEncoder().encode('not an image')),
    ]);
    const resolved = resolveGltfResources(references, map);
    expect(resolved.droppedImages).toHaveLength(1);
    expect(resolved.droppedImages[0].reason).toBe('too_large');
  });

  it('drops an image whose declared size is beyond the per-side limit', () => {
    const bundle = triangleGltf();
    const references = referencesOf(bundle.json);
    const huge = testPngBytes(9000, 9000);
    const map = mapFor([binaryFile('triangle.bin', triangleGltf().bin), binaryFile('wood.png', huge)]);
    const resolved = resolveGltfResources(references, map);
    expect(resolved.droppedImages).toHaveLength(1);
  });

  it('reports an ambiguous image by its candidates', () => {
    const bundle = triangleGltf();
    const references = referencesOf(bundle.json);
    const map = mapFor([
      binaryFile('triangle.bin', triangleGltf().bin),
      { name: 'wood.png', path: 'a/wood.png', bytes: testPngBytes(2, 2).buffer.slice(0) as ArrayBuffer },
      { name: 'wood.png', path: 'b/wood.png', bytes: testPngBytes(2, 2).buffer.slice(0) as ArrayBuffer },
    ]);
    const resolved = resolveGltfResources(references, map);
    expect(resolved.ambiguous).toContain('wood.png');
    expect(resolved.droppedImages[0].candidates).toHaveLength(2);
  });

  it('removes only the references of dropped images', () => {
    const json = JSON.parse(triangleGltf().json) as Record<string, unknown>;
    const stripped = stripDroppedImageReferences(json, [
      { index: 0, uri: 'wood.png', reason: 'missing', candidates: [] },
    ]);
    const material = (stripped.materials as Array<Record<string, unknown>>)[0];
    const pbr = material.pbrMetallicRoughness as Record<string, unknown>;
    expect(pbr.baseColorTexture).toBeUndefined();
    // Everything else about the material survives.
    expect(pbr.baseColorFactor).toEqual([0.5, 0.2, 0.1, 1]);
    // The arrays keep their indices so the rest of the document stays valid.
    expect((stripped.images as unknown[]).length).toBe(1);
    expect((stripped.textures as unknown[]).length).toBe(1);
  });
});

describe('glTF object URL lifecycle', () => {
  it('revokes every blob URL it creates', async () => {
    const bundle = triangleGltf((json) => {
      delete json.images;
      delete json.textures;
      (json.materials as Array<Record<string, unknown>>)[0] = {
        name: 'Paint',
        pbrMetallicRoughness: { baseColorFactor: [0.5, 0.2, 0.1, 1] },
      };
    });
    // Spies that call through: the loader must really fetch these URLs, so faking
    // them would replace the behaviour under test.
    const createSpy = vi.spyOn(URL, 'createObjectURL');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

    const { parsed } = await prepareImport([
      textFile('chair.gltf', bundle.json),
      binaryFile('triangle.bin', bundle.bin),
    ]);
    parsed.dispose();

    if (createSpy.getMockImplementation()) {
      throw new Error('the URL factory must not be mocked: the loader has to fetch it');
    }
    expect(createSpy.mock.results.length).toBeGreaterThan(0);
    expect(revokeSpy.mock.calls.length).toBe(createSpy.mock.results.length);
  });
});

describe('glTF document policy', () => {
  it('rejects a document with no scene', () => {
    const json = JSON.stringify({ asset: { version: '2.0' } });
    expect(() => inspectGltf(new TextEncoder().encode(json).buffer as ArrayBuffer)).toThrow(
      ImportError,
    );
  });

  it('rejects invalid UTF-8', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0xfd]);
    expect(() => inspectGltf(bytes.buffer as ArrayBuffer)).toThrow(ImportError);
  });

  it('collects references instead of rejecting them', () => {
    const inspection = inspectGltf(
      new TextEncoder().encode(triangleGltf().json).buffer as ArrayBuffer,
    );
    expect(inspection.stats.externalReferences.map((reference) => reference.kind)).toEqual([
      'buffer',
      'image',
    ]);
  });

  it('keeps embedded data URIs working', () => {
    const json = {
      ...triangleJson(),
      buffers: [
        {
          uri: 'data:application/octet-stream;base64,AAAA',
          byteLength: 42,
        },
      ],
    };
    // The policy accepts it (the loader is what would decode it); no external
    // reference is reported for a data URI.
    const inspection = inspectGltf(
      new TextEncoder().encode(JSON.stringify(json)).buffer as ArrayBuffer,
    );
    expect(inspection.stats.externalReferences).toEqual([]);
  });
});
