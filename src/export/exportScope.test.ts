/**
 * B2.1 — export scope: which parts of the scene each format writes.
 *
 * The print formats (STL/3MF) are a different deliverable from an interior
 * scene: the room is not part of the printed piece, so an omitted `includeRoom`
 * means false for them. An explicit `includeRoom: true` is still honoured, and
 * `onlyObjectId` narrows the export to one object. GLB/OBJ/JSON keep the
 * behaviour they had before.
 */
import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import {
  createTableSceneObject,
  SCENE_SCHEMA_VERSION,
  type SceneData,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { exportSceneToFormat } from './sceneFileExport';
import { ExportError, type ExportMetadata } from './exportTypes';

const META: ExportMetadata = { name: 'Skop testi', furnitureType: 'table', units: 'cm' };

function sceneWith(ids: readonly string[]): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
    objects: ids.map((id, index) =>
      createTableSceneObject(
        id,
        index === 0 ? undefined : { position: { x: 200 * index, y: 0, z: 0 } },
      ),
    ),
    settings: createDefaultSettings(),
  };
}

/** Binary STL stores the triangle count as a uint32 at byte 80. */
function stlTriangleCount(bytes: ArrayBuffer): number {
  return new DataView(bytes).getUint32(80, true);
}

async function stlTriangles(
  scene: SceneData,
  options: Parameters<typeof exportSceneToFormat>[3] = {},
): Promise<number> {
  const artifact = await exportSceneToFormat('stl', scene, META, options);
  return stlTriangleCount(await artifact.blob.arrayBuffer());
}

async function modelXml(
  scene: SceneData,
  options: Parameters<typeof exportSceneToFormat>[3] = {},
): Promise<string> {
  const artifact = await exportSceneToFormat('3mf', scene, META, options);
  const files = unzipSync(new Uint8Array(await artifact.blob.arrayBuffer()));
  return new TextDecoder().decode(files['3D/3dmodel.model']);
}

function countOf(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

async function blobBytes(
  format: Parameters<typeof exportSceneToFormat>[0],
  scene: SceneData,
  options: Parameters<typeof exportSceneToFormat>[3] = {},
): Promise<number> {
  const artifact = await exportSceneToFormat(format, scene, META, options);
  return (await artifact.blob.arrayBuffer()).byteLength;
}

describe('B2.1 — print formats omit the room by default', () => {
  it('STL leaves the room out when no option is given', async () => {
    const scene = sceneWith(['t1']);
    const byDefault = await stlTriangles(scene);
    const explicitOff = await stlTriangles(scene, { includeRoom: false });
    const explicitOn = await stlTriangles(scene, { includeRoom: true });

    expect(byDefault).toBe(explicitOff);
    expect(byDefault).toBeLessThan(explicitOn);
  });

  it('3MF leaves the room out when no option is given', async () => {
    const scene = sceneWith(['t1']);
    const byDefault = countOf(await modelXml(scene), /<object\b/g);
    const explicitOff = countOf(await modelXml(scene, { includeRoom: false }), /<object\b/g);
    const explicitOn = countOf(await modelXml(scene, { includeRoom: true }), /<object\b/g);

    expect(byDefault).toBe(explicitOff);
    expect(byDefault).toBeLessThan(explicitOn);
  });

  it('an explicit includeRoom: true is still honoured for print formats', async () => {
    const scene = sceneWith(['t1']);
    expect(await stlTriangles(scene, { includeRoom: true })).toBeGreaterThan(
      await stlTriangles(scene, { includeRoom: false }),
    );
    expect(
      await blobBytes('3mf', scene, { includeRoom: true }),
    ).toBeGreaterThan(await blobBytes('3mf', scene, { includeRoom: false }));
  });
});

describe('B2.1 — onlyObjectId narrows the export', () => {
  it('exports exactly one object from a multi-object scene', async () => {
    const both = sceneWith(['t1', 't2']);
    const single = sceneWith(['t2']);

    const onlySecond = await stlTriangles(both, { onlyObjectId: 't2' });
    expect(onlySecond).toBe(await stlTriangles(single, { includeRoom: false }));
    expect(onlySecond).toBeLessThan(await stlTriangles(both));
  });

  it('writes the same 3MF geometry as a scene holding only that object', async () => {
    // One scene object is several meshes (a table is top + four legs), so the
    // meaningful comparison is against the narrowed scene, not a literal count.
    const both = sceneWith(['t1', 't2']);
    const selected = await modelXml(both, { onlyObjectId: 't2' });
    const narrowed = await modelXml(sceneWith(['t2']), { includeRoom: false });
    expect(countOf(selected, /<object\b/g)).toBe(countOf(narrowed, /<object\b/g));
    expect(countOf(selected, /<triangle\b/g)).toBe(countOf(narrowed, /<triangle\b/g));
    expect(countOf(selected, /<vertex\b/g)).toBe(countOf(narrowed, /<vertex\b/g));
  });

  it('forces the room out even when includeRoom is true', async () => {
    const scene = sceneWith(['t1', 't2']);
    const forced = await stlTriangles(scene, { onlyObjectId: 't1', includeRoom: true });
    const single = await stlTriangles(sceneWith(['t1']), { includeRoom: false });
    expect(forced).toBe(single);
  });

  it('fails with empty_scene for an unknown id instead of writing an empty file', async () => {
    const scene = sceneWith(['t1']);
    const stl = exportSceneToFormat('stl', scene, META, { onlyObjectId: 'missing' });
    const threeMf = exportSceneToFormat('3mf', scene, META, { onlyObjectId: 'missing' });

    await expect(stl).rejects.toMatchObject({ code: 'empty_scene' });
    await expect(threeMf).rejects.toMatchObject({ code: 'empty_scene' });
  });

  it('rejects with an ExportError instance, not a bare throw', async () => {
    const scene = sceneWith(['t1']);
    await expect(
      exportSceneToFormat('stl', scene, META, { onlyObjectId: 'missing' }),
    ).rejects.toBeInstanceOf(ExportError);
  });
});

describe('B2.1 — other formats keep their previous behaviour', () => {
  it('OBJ still includes the room by default', async () => {
    const scene = sceneWith(['t1']);
    expect(await blobBytes('obj', scene)).toBeGreaterThan(
      await blobBytes('obj', scene, { includeRoom: false }),
    );
  });

  it('JSON ignores the export scope options', async () => {
    const scene = sceneWith(['t1', 't2']);
    const plain = await blobBytes('json', scene);
    const scoped = await blobBytes('json', scene, { includeRoom: false, onlyObjectId: 't1' });
    expect(scoped).toBe(plain);
  });
});
