import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportGroupToGlb, exportSceneToGlb } from '../export/sceneExport';
import { DEFAULT_DESK_SPEC } from '../geometry/furniture/desk';
import { buildSceneObject } from '../scene/buildSceneObject';
import { sha256Hex } from '../util/sha256';
import {
  PREMIUM_DESK_PRODUCT,
  PREMIUM_DESK_TAGS,
  createPremiumDeskScene,
} from './premiumOfficeDesk';

class TestFileReader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    blob
      .arrayBuffer()
      .then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      })
      .catch((error) => this.onerror?.(error));
  }
}

beforeAll(() => {
  (globalThis as unknown as { FileReader: typeof TestFileReader }).FileReader = TestFileReader;
});

afterAll(() => {
  delete (globalThis as unknown as { FileReader?: typeof TestFileReader }).FileReader;
});

describe('Premium Office Desk product fixture', () => {
  it('is one editable desk object in the scene vocabulary', () => {
    const scene = createPremiumDeskScene();
    expect(scene.objects).toHaveLength(1);
    const [object] = scene.objects;
    expect(object.id).toBe(PREMIUM_DESK_PRODUCT.objectId);
    expect(object.name).toBe(PREMIUM_DESK_PRODUCT.objectName);
    expect(object.type).toBe('table');
    expect(object.definitionId).toBe('desk.computer');
    expect(object.spec).toEqual(DEFAULT_DESK_SPEC);
    expect(object.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(object.scale).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('uses the neutral product look without claiming a texture upgrade', () => {
    const settings = createPremiumDeskScene().settings;
    expect(settings.background).toBe('#f4f4f6');
    expect(settings.lightingPreset).toBe('neutralProduct');
    expect(settings.qualityPreset).toBe('high');
    expect(settings.environmentEnabled).toBe(true);
  });

  it('builds the expected number of named meshes', () => {
    const [object] = createPremiumDeskScene().objects;
    const built = buildSceneObject(object);
    const meshes: string[] = [];
    built.group.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) meshes.push(node.name);
    });
    expect(meshes).toHaveLength(24);
    expect(new Set(meshes).size).toBe(24);
    expect(meshes).toContain('desk-tabletop');
    expect(meshes).toContain('desk-drawer-front');
    expect(meshes).toContain('desk-drawer-handle');
    expect(meshes).toContain('desk-grommet');
    built.dispose();
  });

  it('measures 160 × 75 × 80 cm with the feet on the floor', () => {
    const [object] = createPremiumDeskScene().objects;
    const built = buildSceneObject(object);
    built.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(built.group);
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(160, 1);
    expect(size.y).toBeCloseTo(75, 1);
    expect(size.z).toBeCloseTo(80, 1);
    expect(box.min.y).toBeCloseTo(0, 2);
    built.dispose();
  });

  it('exports byte-identical product GLBs from two independent scenes', async () => {
    const options = {
      onlyObjectId: PREMIUM_DESK_PRODUCT.objectId,
      includeRoom: false,
      textureSize: 512,
      indexNonIndexedTangents: true,
    } as const;
    const firstGlb = await exportSceneToGlb(createPremiumDeskScene(), options);
    const secondGlb = await exportSceneToGlb(createPremiumDeskScene(), options);
    expect(firstGlb.byteLength).toBe(secondGlb.byteLength);
    expect(sha256Hex(new Uint8Array(firstGlb))).toBe(
      sha256Hex(new Uint8Array(secondGlb)),
    );
  });

  it('exports byte-identical group GLBs from two independent builds', async () => {
    const firstObject = createPremiumDeskScene().objects[0];
    const secondObject = createPremiumDeskScene().objects[0];
    const first = buildSceneObject(firstObject);
    const second = buildSceneObject(secondObject);
    try {
      const firstGlb = await exportGroupToGlb(first.group);
      const secondGlb = await exportGroupToGlb(second.group);
      expect(firstGlb.byteLength).toBe(secondGlb.byteLength);
      expect(sha256Hex(new Uint8Array(firstGlb))).toBe(
        sha256Hex(new Uint8Array(secondGlb)),
      );
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it('keeps commercial fields honest and unset', () => {
    expect(PREMIUM_DESK_PRODUCT.license).toBeNull();
    expect(PREMIUM_DESK_PRODUCT.price).toBeNull();
    expect(PREMIUM_DESK_PRODUCT.author).toBeNull();
    expect(PREMIUM_DESK_PRODUCT.authorship).toBe('procedural');
    expect(PREMIUM_DESK_PRODUCT.aiGenerated).toBe(false);
    expect(PREMIUM_DESK_TAGS).toHaveLength(15);
    expect(new Set(PREMIUM_DESK_TAGS).size).toBe(15);
  });
});
