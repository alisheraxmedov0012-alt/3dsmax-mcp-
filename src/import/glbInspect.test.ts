import { describe, expect, it, vi, afterEach } from 'vitest';
import { inspectGlb } from './glbInspect';
import { ImportError } from './importErrors';
import { MAX_MODEL_BYTES } from './importLimits';
import {
  buildGlb,
  triangleBin,
  triangleGlb,
  triangleJson,
  triangleJsonWith,
} from './__fixtures__/glbFixtures';
import { testPngBytes } from '../export/pngFixture';
import type { GltfJson } from '../export/glbSummary';

/** Runs the policy and returns the error code, failing the test on success. */
function rejectionCode(bytes: ArrayBuffer): string {
  try {
    inspectGlb(bytes);
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError);
    return (error as ImportError).code;
  }
  throw new Error('expected the import to be rejected');
}

function glbOf(patch: (json: Record<string, unknown>) => void, bin = triangleBin()): ArrayBuffer {
  return buildGlb(triangleJsonWith(patch), bin);
}

/** A GLB whose single image is a PNG of the requested size, embedded in the BIN. */
function glbWithPng(width: number, height: number): ArrayBuffer {
  const png = testPngBytes(width, height);
  const bin = new Uint8Array(44 + png.length);
  bin.set(triangleBin(), 0);
  bin.set(png, 44);
  return buildGlb(
    triangleJsonWith((json) => {
      json.images = [{ bufferView: 2, mimeType: 'image/png' }];
      json.textures = [{ source: 0 }];
      (json.bufferViews as unknown[]).push({ buffer: 0, byteOffset: 44, byteLength: png.length });
      (json.buffers as Array<{ byteLength: number }>)[0].byteLength = bin.length;
    }),
    bin,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('inspectGlb — container', () => {
  it('accepts a valid GLB and reports its counts', () => {
    const inspection = inspectGlb(triangleGlb());
    expect(inspection.stats).toMatchObject({
      meshes: 1,
      primitives: 1,
      triangles: 1,
      vertices: 3,
      materials: 1,
      textures: 0,
      nodes: 1,
    });
  });

  it('rejects a file that is too small to hold a header', () => {
    expect(rejectionCode(new ArrayBuffer(8))).toBe('malformed');
  });

  it('rejects a wrong magic number', () => {
    expect(rejectionCode(buildGlb(triangleJson(), triangleBin(), { magic: 0x12345678 }))).toBe(
      'malformed',
    );
  });

  it('rejects a container version other than 2', () => {
    expect(rejectionCode(buildGlb(triangleJson(), triangleBin(), { version: 3 }))).toBe(
      'malformed',
    );
  });

  it('rejects a header length that disagrees with the file', () => {
    const bytes = triangleGlb();
    expect(rejectionCode(buildGlb(triangleJson(), triangleBin(), { declaredLength: 999 }))).toBe(
      'malformed',
    );
    // Sanity: the same test file is accepted when the length is honest.
    expect(() => inspectGlb(bytes)).not.toThrow();
  });

  it('rejects a file without a JSON chunk', () => {
    expect(rejectionCode(buildGlb(triangleJson(), triangleBin(), { jsonChunkType: 0x11111111 }))).toBe(
      'malformed',
    );
  });

  it('rejects a chunk that claims to run past the end of the file', () => {
    expect(rejectionCode(buildGlb(triangleJson(), triangleBin(), { jsonChunkLength: 100_000 }))).toBe(
      'malformed',
    );
  });

  it('rejects an unparseable JSON chunk', () => {
    expect(rejectionCode(buildGlb('{ not json', triangleBin()))).toBe('malformed');
  });

  it('rejects a file larger than the import cap before parsing it', () => {
    expect(rejectionCode(new ArrayBuffer(MAX_MODEL_BYTES + 1))).toBe('too_large');
  });

  it('rejects a glTF 1.0 document', () => {
    expect(rejectionCode(glbOf((json) => {
      json.asset = { version: '1.0' };
    }))).toBe('malformed');
  });

  it('rejects a document with no scene', () => {
    expect(rejectionCode(glbOf((json) => {
      delete json.scenes;
      delete json.scene;
    }))).toBe('malformed');
  });
});

describe('inspectGlb — external resources', () => {
  it('rejects a buffer that points at an external file', () => {
    expect(rejectionCode(glbOf((json) => {
      (json.buffers as unknown[])[0] = { uri: 'https://example.com/model.bin', byteLength: 42 };
    }))).toBe('external_resource');
  });

  it('rejects an image URI, whether absolute or relative', () => {
    for (const uri of [
      'https://example.com/a.png',
      'http://example.com/a.png',
      'file:///etc/passwd',
      '../../../etc/passwd',
      'wood.png',
    ]) {
      expect(
        rejectionCode(glbOf((json) => {
          json.images = [{ uri }];
          json.textures = [{ source: 0 }];
        })),
      ).toBe('external_resource');
    }
  });

  it('never performs a network request while rejecting a remote texture', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      rejectRemoteImage();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  function rejectRemoteImage(): void {
    expect(rejectionCode(glbOf((json) => {
      json.images = [{ uri: 'https://example.com/a.png' }];
    }))).toBe('external_resource');
  }
});

describe('inspectGlb — extensions', () => {
  it('rejects a required decoder extension', () => {
    for (const extension of [
      'KHR_draco_mesh_compression',
      'EXT_meshopt_compression',
      'KHR_texture_basisu',
      'EXT_texture_webp',
    ]) {
      expect(rejectionCode(glbOf((json) => {
        json.extensionsRequired = [extension];
      }))).toBe('unsupported_extension');
    }
  });

  it('accepts the appearance extensions the bundled loader implements', () => {
    expect(() =>
      inspectGlb(
        glbOf((json) => {
          json.extensionsRequired = ['KHR_materials_unlit', 'KHR_texture_transform'];
        }),
      ),
    ).not.toThrow();
  });

  it('rejects skinned models instead of loading something that clones wrong', () => {
    expect(rejectionCode(glbOf((json) => {
      json.skins = [{ joints: [0] }];
    }))).toBe('unsupported_extension');
  });
});

describe('inspectGlb — declared sizes versus real bytes', () => {
  it('rejects a bufferView that runs past the BIN chunk', () => {
    expect(rejectionCode(glbOf((json) => {
      (json.bufferViews as Array<{ byteLength: number }>)[0].byteLength = 10_000;
    }))).toBe('malformed');
  });

  it('rejects an accessor whose count cannot fit its bufferView', () => {
    expect(rejectionCode(glbOf((json) => {
      (json.accessors as Array<{ count: number }>)[0].count = 1_000;
    }))).toBe('malformed');
  });

  it('rejects an accessor with an unknown component type', () => {
    expect(rejectionCode(glbOf((json) => {
      (json.accessors as Array<{ componentType: number }>)[0].componentType = 1234;
    }))).toBe('malformed');
  });

  it('rejects a primitive without POSITION', () => {
    expect(rejectionCode(glbOf((json) => {
      const meshes = json.meshes as Array<{ primitives: Array<{ attributes: object }> }>;
      meshes[0].primitives[0].attributes = {};
    }))).toBe('malformed');
  });
});

describe('inspectGlb — work limits', () => {
  it('rejects a model over the triangle budget', () => {
    // Three primitives of 600k indices each: 600k triangles in total, every
    // accessor individually under the per-accessor bound.
    const json = triangleJsonWith((doc) => {
      const accessors = doc.accessors as unknown[];
      const meshes = doc.meshes as Array<{ primitives: unknown[] }>;
      accessors.push({ componentType: 5125, count: 600_000, type: 'SCALAR' });
      accessors.push({ componentType: 5125, count: 600_000, type: 'SCALAR' });
      meshes[0].primitives = [
        { attributes: { POSITION: 0 }, indices: 2 },
        { attributes: { POSITION: 0 }, indices: 2 },
        { attributes: { POSITION: 0 }, indices: 3 },
      ];
    });
    expect(rejectionCode(buildGlb(json, triangleBin()))).toBe('too_complex');
  });

  it('rejects a model over the vertex budget', () => {
    // Two primitives of 600k vertices each: 1.2M in total.
    const json = triangleJsonWith((doc) => {
      const accessors = doc.accessors as unknown[];
      const meshes = doc.meshes as Array<{ primitives: unknown[] }>;
      accessors.push({ componentType: 5126, count: 600_000, type: 'VEC3' });
      meshes[0].primitives = [
        { attributes: { POSITION: 2 } },
        { attributes: { POSITION: 2 } },
      ];
    });
    expect(rejectionCode(buildGlb(json, triangleBin()))).toBe('too_complex');
  });

  it('rejects a node graph with a cycle', () => {
    expect(rejectionCode(glbOf((json) => {
      json.nodes = [{ mesh: 0, children: [1] }, { children: [0] }];
      json.scenes = [{ nodes: [0] }];
    }))).toBe('malformed');
  });

  it('rejects a node with two parents', () => {
    expect(rejectionCode(glbOf((json) => {
      json.nodes = [{ mesh: 0, children: [2] }, { children: [2] }, { mesh: 0 }];
      json.scenes = [{ nodes: [0, 1] }];
    }))).toBe('malformed');
  });

  it('rejects a hierarchy that is too deep', () => {
    const depth = 70;
    const nodes = Array.from({ length: depth }, (_unused, index) => ({
      mesh: index === depth - 1 ? 0 : undefined,
      children: index < depth - 1 ? [index + 1] : undefined,
    }));
    expect(rejectionCode(glbOf((json) => {
      json.nodes = nodes;
      json.scenes = [{ nodes: [0] }];
    }))).toBe('too_complex');
  });
});

describe('inspectGlb — images', () => {
  it('accepts an embedded PNG and counts its texture', () => {
    const inspection = inspectGlb(glbWithPng(2, 2));
    expect(inspection.stats.textures).toBe(1);
    expect(inspection.stats.images).toBe(1);
  });

  it('rejects an embedded image that is neither PNG nor JPEG', () => {
    expect(rejectionCode(glbOf((json) => {
      json.images = [{ bufferView: 0, mimeType: 'image/webp' }];
      json.textures = [{ source: 0 }];
    }))).toBe('unsupported_format');
  });

  it('rejects an image whose header is not a readable PNG/JPEG', () => {
    const bin = new Uint8Array(44 + 16);
    bin.set(triangleBin(), 0);
    bin.fill(0x41, 44);
    const bytes = buildGlb(
      triangleJsonWith((json) => {
        json.images = [{ bufferView: 2, mimeType: 'image/png' }];
        (json.bufferViews as unknown[]).push({ buffer: 0, byteOffset: 44, byteLength: 16 });
        (json.buffers as Array<{ byteLength: number }>)[0].byteLength = bin.length;
      }),
      bin,
    );
    expect(rejectionCode(bytes)).toBe('malformed');
  });

  it('rejects an image larger than the per-side limit', () => {
    expect(rejectionCode(glbWithPng(9000, 16))).toBe('too_complex');
  });

  it('rejects a model whose textures add up to more pixels than allowed', () => {
    // 8192 × 8192 = 67 MP: each side is legal, the total is not.
    expect(rejectionCode(glbWithPng(8192, 8192))).toBe('too_complex');
  });

  it('rejects more embedded images than allowed', () => {
    const json = triangleJsonWith((doc) => {
      doc.images = Array.from({ length: 17 }, () => ({ bufferView: 0, mimeType: 'image/png' }));
    });
    expect(rejectionCode(buildGlb(json, triangleBin()))).toBe('too_complex');
  });
});

describe('inspectGlb — rejections are typed and explained', () => {
  it('carries a code and a human-readable detail', () => {
    try {
      inspectGlb(buildGlb(triangleJson(), triangleBin(), { magic: 0 }));
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ImportError);
      const failure = error as ImportError;
      expect(failure.code).toBe('malformed');
      expect(failure.message.length).toBeGreaterThan(10);
    }
  });
});

/** The fixture builder is itself load-bearing; keep a guard on its output. */
describe('fixture builder', () => {
  it('produces a GLB the inspector accepts with the documented header', () => {
    const bytes = triangleGlb();
    const view = new DataView(bytes);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(bytes.byteLength);
    const inspection = inspectGlb(bytes);
    expect(inspection.bytes).toBe(bytes.byteLength);
    expect(inspection.jsonChunkBytes).toBeGreaterThan(0);
  });

  it('exposes the triangle document for patching', () => {
    const json = triangleJson() as GltfJson;
    expect(json.meshes).toHaveLength(1);
    expect(json.accessors).toHaveLength(2);
  });
});
