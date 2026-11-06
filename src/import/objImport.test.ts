/**
 * Phase 6.2.3 — OBJ + MTL import.
 *
 * The real `OBJLoader` and the real MTL tokenizer run here; only the image decode
 * is injected, because Node has no `createImageBitmap`. Everything else — the
 * pre-scan, the material conversion, the unit conversion and the geometry guard —
 * is the production path.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareImport } from './parseModel';
import { ImportError } from './importErrors';
import type { ImportFile } from './resourceMap';
import type { TextureDecoder } from './textureDecode';
import { chairMtl, quadObj, twoMaterialObj } from './__fixtures__/textFixtures';
import { testPngBytes } from '../export/pngFixture';

const decodeTexture: TextureDecoder = async (_bytes, { srgb }) => {
  const texture = new THREE.Texture();
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return texture;
};

afterEach(() => {
  vi.restoreAllMocks();
});

function text(name: string, value: string): ImportFile {
  return { name, bytes: new TextEncoder().encode(value).buffer as ArrayBuffer };
}

function bytes(name: string, value: Uint8Array): ImportFile {
  return { name, bytes: value.buffer.slice(0, value.byteLength) as ArrayBuffer };
}

const PNG = testPngBytes(4, 4);

async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError);
    return (error as ImportError).code;
  }
  throw new Error('expected the import to be rejected');
}

function firstMesh(root: THREE.Object3D): THREE.Mesh {
  const mesh = root.getObjectByProperty('isMesh', true) as THREE.Mesh | undefined;
  if (!mesh) {
    throw new Error('no mesh');
  }
  return mesh;
}

describe('prepareImport — OBJ with MTL and a texture', () => {
  it('imports geometry, material and texture', async () => {
    const { parsed, report } = await prepareImport(
      [text('chair.obj', quadObj()), text('chair.mtl', chairMtl()), bytes('wood.png', PNG)],
      { decodeTexture },
    );

    try {
      expect(report.format).toBe('obj');
      expect(report.mainFile).toBe('chair.obj');
      expect(report.totalFiles).toBe(3);
      expect(report.requiresAcknowledgement).toBe(false);
      // One MTL library and one texture: both are resources the user supplied.
      expect(report.references).toEqual({ total: 2, resolved: 2, missing: [], ambiguous: [] });

      expect(parsed.meta.triangles).toBe(2);
      expect(parsed.meta.materials).toBe(2);
      expect(parsed.meta.textures).toBe(1);

      // The fixture is a 1-unit quad; the default unit is centimetres, so it
      // arrives at 1 cm without any rescaling.
      const bounds = parsed.meta.boundsCm;
      expect(bounds.max.x - bounds.min.x).toBeCloseTo(1, 3);
      expect(bounds.max.z - bounds.min.z).toBeCloseTo(1, 3);
      expect(bounds.min.y).toBeCloseTo(0, 3);
    } finally {
      parsed.dispose();
    }
  });

  it('converts MTL properties deterministically', async () => {
    const { parsed } = await prepareImport(
      [text('chair.obj', quadObj()), text('chair.mtl', chairMtl()), bytes('wood.png', PNG)],
      { decodeTexture },
    );

    try {
      const material = firstMesh(parsed.root).material as THREE.MeshStandardMaterial;
      expect(material.isMeshStandardMaterial).toBe(true);
      expect(material.name).toBe('Wood');
      // Kd 0.8 0.4 0.2
      expect(material.color.r).toBeCloseTo(0.8, 3);
      expect(material.color.g).toBeCloseTo(0.4, 3);
      expect(material.color.b).toBeCloseTo(0.2, 3);
      // d 0.9
      expect(material.opacity).toBeCloseTo(0.9, 3);
      expect(material.transparent).toBe(true);
      // Ns 200 → 1 − √0.2
      expect(material.roughness).toBeCloseTo(1 - Math.sqrt(0.2), 3);
      // Ks 0.1 → below the metalness threshold
      expect(material.metalness).toBe(0);
      // map_Kd resolved from the selection
      expect(material.map).not.toBeNull();
      expect(material.map?.colorSpace).toBe(THREE.SRGBColorSpace);
    } finally {
      parsed.dispose();
    }
  });

  it('keeps object and material names', async () => {
    const { parsed } = await prepareImport(
      [text('parts.obj', twoMaterialObj()), text('parts.mtl', chairMtl())],
      { decodeTexture },
    );

    try {
      expect(parsed.root.getObjectByName('Top')).toBeTruthy();
      expect(parsed.root.getObjectByName('Leg')).toBeTruthy();

      const names: string[] = [];
      parsed.root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) {
          names.push((mesh.material as THREE.Material).name);
        }
      });
      expect(names).toContain('Wood');
      expect(names).toContain('Metal');
    } finally {
      parsed.dispose();
    }
  });

  it('maps a bright Ks to metalness', async () => {
    const { parsed } = await prepareImport(
      [text('parts.obj', twoMaterialObj()), text('parts.mtl', chairMtl())],
      { decodeTexture },
    );

    try {
      const metal = parsed.root
        .getObjectByProperty('isMesh', true)
        ?.parent?.children.find((child) => {
          const mesh = child as THREE.Mesh;
          return mesh.isMesh && (mesh.material as THREE.Material).name === 'Metal';
        }) as THREE.Mesh | undefined;
      const material = (metal?.material ?? null) as THREE.MeshStandardMaterial | null;
      expect(material).not.toBeNull();
      if (material) {
        expect(material.metalness).toBeCloseTo(1, 3);
        expect(material.roughness).toBeCloseTo(1 - Math.sqrt(0.8), 3);
      }
    } finally {
      parsed.dispose();
    }
  });
});

describe('prepareImport — OBJ units', () => {
  it('scales by the chosen unit exactly once', async () => {
    const files = [text('chair.obj', quadObj())];

    const asCm = await prepareImport(files, { decodeTexture });
    const asMm = await prepareImport(files, { decodeTexture, objUnit: 'mm' });
    const asM = await prepareImport(files, { decodeTexture, objUnit: 'm' });

    try {
      const widthCm = asCm.parsed.meta.boundsCm.max.x - asCm.parsed.meta.boundsCm.min.x;
      const widthMm = asMm.parsed.meta.boundsCm.max.x - asMm.parsed.meta.boundsCm.min.x;
      const widthM = asM.parsed.meta.boundsCm.max.x - asM.parsed.meta.boundsCm.min.x;

      // The same 1-unit quad read as cm, mm and m.
      expect(widthCm).toBeCloseTo(1, 3);
      expect(widthMm).toBeCloseTo(0.1, 3);
      expect(widthM).toBeCloseTo(100, 2);

      // Every variant is centred and stood on the floor.
      for (const parsed of [asCm.parsed, asMm.parsed, asM.parsed]) {
        expect(parsed.meta.boundsCm.min.y).toBeCloseTo(0, 2);
      }
    } finally {
      asCm.parsed.dispose();
      asMm.parsed.dispose();
      asM.parsed.dispose();
    }
  });

  it('refuses a model whose converted size leaves the accepted range', async () => {
    // 1e6 units at 1 m each is a 1 000 km model.
    const huge = ['o Big', 'v 0 0 0', 'v 1000000 0 0', 'v 0 1 0', 'f 1 2 3', ''].join('\n');
    expect(
      await rejectionCode(prepareImport([text('big.obj', huge)], { decodeTexture, objUnit: 'm' })),
    ).toBe('too_complex');
  });
});

describe('prepareImport — OBJ degradation', () => {
  it('imports geometry without an MTL, with a warning and a confirmation', async () => {
    const { parsed, report } = await prepareImport([text('chair.obj', quadObj())], {
      decodeTexture,
    });

    try {
      expect(report.requiresAcknowledgement).toBe(true);
      // No MTL means no material definitions, so the only expected resource is
      // the library the OBJ asks for.
      expect(report.references.total).toBe(1);
      expect(report.references.missing).toEqual(['chair.mtl']);
      expect(report.warnings.join(' ')).toContain('chair.mtl');

      const material = firstMesh(parsed.root).material as THREE.MeshStandardMaterial;
      // A neutral standard material, never a Phong one with different lighting.
      expect(material.isMeshStandardMaterial).toBe(true);
    } finally {
      parsed.dispose();
    }
  });

  it('imports without the texture but keeps the material colour', async () => {
    const { parsed, report } = await prepareImport(
      [text('chair.obj', quadObj()), text('chair.mtl', chairMtl())],
      { decodeTexture },
    );

    try {
      // Losing the map changes what the user sees, so it is confirmed explicitly.
      expect(report.requiresAcknowledgement).toBe(true);
      expect(report.warnings.join(' ')).toContain('wood.png');
      const material = firstMesh(parsed.root).material as THREE.MeshStandardMaterial;
      expect(material.map).toBeNull();
      expect(material.color.r).toBeCloseTo(0.8, 3);
      expect(parsed.meta.textures).toBe(0);
    } finally {
      parsed.dispose();
    }
  });

  it('does not follow a texture path that leaves the selection', async () => {
    const mtl = ['newmtl Wood', 'Kd 0.5 0.5 0.5', 'map_Kd ../../secret.png', ''].join('\n');
    const { parsed, report } = await prepareImport(
      [text('chair.obj', quadObj()), text('chair.mtl', mtl), bytes('secret.png', PNG)],
      { decodeTexture },
    );

    try {
      expect(report.warnings.join(' ')).toContain('qabul qilinmadi');
      const material = firstMesh(parsed.root).material as THREE.MeshStandardMaterial;
      expect(material.map).toBeNull();
    } finally {
      parsed.dispose();
    }
  });

  it('rejects an OBJ whose face index does not exist', async () => {
    const broken = ['v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 9', ''].join('\n');
    expect(await rejectionCode(prepareImport([text('broken.obj', broken)]))).toBe('malformed');
  });

  it('rejects a negative index that resolves before the first vertex', async () => {
    const broken = ['v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f -1 -2 -9', ''].join('\n');
    expect(await rejectionCode(prepareImport([text('broken.obj', broken)]))).toBe('malformed');
  });

  it('accepts negative indices that resolve correctly', async () => {
    const relative = ['v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f -3 -2 -1', ''].join('\n');
    const { parsed } = await prepareImport([text('rel.obj', relative)], { decodeTexture });
    try {
      expect(parsed.meta.triangles).toBe(1);
    } finally {
      parsed.dispose();
    }
  });

  it('rejects a face with too many vertices', async () => {
    const vertices = Array.from({ length: 70 }, (_unused, index) => `v ${index} 0 0`);
    const face = `f ${Array.from({ length: 70 }, (_unused, index) => index + 1).join(' ')}`;
    const broken = [...vertices, face, ''].join('\n');
    expect(await rejectionCode(prepareImport([text('big-face.obj', broken)]))).toBe('too_complex');
  });

  it('rejects an extremely long line before parsing it', async () => {
    const long = `v 0 0 0 ${'9'.repeat(5000)}`;
    expect(await rejectionCode(prepareImport([text('long.obj', long)]))).toBe('too_complex');
  });

  it('rejects geometry with a non-finite vertex', async () => {
    const broken = ['v 0 0 0', 'v NaN 0 0', 'v 0 1 0', 'f 1 2 3', ''].join('\n');
    expect(await rejectionCode(prepareImport([text('nan.obj', broken)]))).toBe('invalid_geometry');
  });

  it('rejects a file with no faces', async () => {
    const empty = ['v 0 0 0', 'v 1 0 0', ''].join('\n');
    expect(await rejectionCode(prepareImport([text('empty.obj', empty)]))).toBe('malformed');
  });
});

describe('prepareImport — OBJ work limits', () => {
  it('rejects a model over the triangle budget', async () => {
    // 500 001 triangles from a single repeated face; the scan must refuse before
    // OBJLoader allocates anything.
    const lines = ['v 0 0 0', 'v 1 0 0', 'v 0 1 0'];
    for (let index = 0; index < 500_001; index += 1) {
      lines.push('f 1 2 3');
    }
    const big = lines.join('\n');
    expect(await rejectionCode(prepareImport([text('big.obj', big)]))).toBe('too_complex');
  }, 30_000);
});

describe('OBJ — no network', () => {
  it('never calls fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { parsed } = await prepareImport(
      [text('chair.obj', quadObj()), text('chair.mtl', chairMtl()), bytes('wood.png', PNG)],
      { decodeTexture },
    );
    parsed.dispose();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
