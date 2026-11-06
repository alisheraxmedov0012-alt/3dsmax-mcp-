/**
 * Phase 6.2.4 — import cost at representative sizes.
 *
 * The browser harness cannot measure time: under `--virtual-time-budget` Chromium
 * virtualises the clock, so a duration read there is fiction. Parsing is also the
 * dominant cost and is environment-independent (only texture decoding is not), so
 * the numbers below are measured here, with real timers, on the machine running the
 * suite.
 *
 * The bounds are deliberately loose — a shared CI machine is not a benchmark — but
 * they would still catch an accidental quadratic pass over the geometry.
 */
import { describe, expect, it } from 'vitest';
import { prepareImport } from './parseModel';
import { buildGlb } from './__fixtures__/glbFixtures';

interface Grid {
  positions: Float32Array;
  indices: Uint32Array;
  triangles: number;
}

function grid(quads: number): Grid {
  const side = quads + 1;
  const positions = new Float32Array(side * side * 3);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const offset = (y * side + x) * 3;
      positions[offset] = x / quads;
      positions[offset + 1] = Math.sin((x / quads) * Math.PI) * 0.1;
      positions[offset + 2] = y / quads;
    }
  }
  const indices = new Uint32Array(quads * quads * 6);
  let cursor = 0;
  for (let y = 0; y < quads; y += 1) {
    for (let x = 0; x < quads; x += 1) {
      const a = y * side + x;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      indices[cursor++] = a;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = d;
    }
  }
  return { positions, indices, triangles: quads * quads * 2 };
}

function gridGlb(quads: number): { bytes: ArrayBuffer; triangles: number } {
  const { positions, indices, triangles } = grid(quads);

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < positions.length; index += 3) {
    minX = Math.min(minX, positions[index]);
    maxX = Math.max(maxX, positions[index]);
    minY = Math.min(minY, positions[index + 1]);
    maxY = Math.max(maxY, positions[index + 1]);
    minZ = Math.min(minZ, positions[index + 2]);
    maxZ = Math.max(maxZ, positions[index + 2]);
  }

  const positionBytes = new Uint8Array(positions.buffer);
  const indexBytes = new Uint8Array(indices.buffer);
  const bin = new Uint8Array(positionBytes.length + indexBytes.length);
  bin.set(positionBytes, 0);
  bin.set(indexBytes, positionBytes.length);

  const bytes = buildGlb(
    {
      asset: { version: '2.0', generator: 'perf' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: 'Grid' }],
      meshes: [{ name: 'Grid', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: positions.length / 3,
          type: 'VEC3',
          min: [minX, minY, minZ],
          max: [maxX, maxY, maxZ],
        },
        { bufferView: 1, componentType: 5125, count: indices.length, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: positionBytes.length },
        { buffer: 0, byteOffset: positionBytes.length, byteLength: indexBytes.length },
      ],
      buffers: [{ byteLength: bin.length }],
    },
    bin,
  );

  return { bytes, triangles };
}

function gridObj(quads: number): { bytes: ArrayBuffer; triangles: number } {
  const lines: string[] = ['# perf grid', 'o Grid'];
  const side = quads + 1;
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      lines.push(`v ${x / quads} 0 ${y / quads}`);
    }
  }
  for (let y = 0; y < quads; y += 1) {
    for (let x = 0; x < quads; x += 1) {
      const a = y * side + x + 1;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      lines.push(`f ${a} ${c} ${b}`);
      lines.push(`f ${b} ${c} ${d}`);
    }
  }
  const bytes = new TextEncoder().encode(lines.join('\n'));
  return {
    bytes: bytes.buffer.slice(0, bytes.byteLength) as ArrayBuffer,
    triangles: quads * quads * 2,
  };
}

async function timedImport(
  name: string,
  bytes: ArrayBuffer,
  options: { objUnit?: 'm' } = {},
): Promise<{ ms: number; triangles: number; megabytes: number }> {
  const started = performance.now();
  const { parsed } = await prepareImport([{ name, bytes }], options);
  const ms = performance.now() - started;
  const triangles = parsed.meta.triangles;
  parsed.dispose();
  return { ms, triangles, megabytes: bytes.byteLength / (1024 * 1024) };
}

describe('import performance', () => {
  it('parses representative GLB sizes within a sane budget', async () => {
    const results: Record<string, { ms: number; triangles: number; mb: number }> = {};

    for (const [label, quads] of [
      ['10k', 70],
      ['100k', 224],
      ['500k', 500],
    ] as const) {
      const { bytes, triangles } = gridGlb(quads);
      // Sequential on purpose: running the sizes concurrently would make each
      // measurement include the others' work.
      // eslint-disable-next-line no-await-in-loop
      const result = await timedImport(`grid-${label}.glb`, bytes);
      expect(result.triangles).toBe(triangles);
      results[label] = { ms: Math.round(result.ms), triangles, mb: Number(result.megabytes.toFixed(1)) };
      // Generous: the point is to catch an accidental quadratic pass, not to rank
      // machines.
      expect(result.ms).toBeLessThan(15_000);
    }

    console.log('[import perf] GLB', JSON.stringify(results));
  }, 120_000);

  it('parses representative OBJ sizes within a sane budget', async () => {
    const results: Record<string, { ms: number; triangles: number; mb: number }> = {};

    for (const [label, quads] of [
      ['10k', 70],
      ['100k', 224],
    ] as const) {
      const { bytes, triangles } = gridObj(quads);
      // eslint-disable-next-line no-await-in-loop
      const result = await timedImport(`grid-${label}.obj`, bytes, { objUnit: 'm' });
      expect(result.triangles).toBe(triangles);
      results[label] = { ms: Math.round(result.ms), triangles, mb: Number(result.megabytes.toFixed(1)) };
      expect(result.ms).toBeLessThan(15_000);
    }

    console.log('[import perf] OBJ', JSON.stringify(results));
  }, 120_000);

  it('refuses a model over the triangle budget before allocating it', async () => {
    // 500 001 triangles: the scan must stop at the limit rather than build geometry.
    const quads = 501;
    const { positions, indices } = grid(quads);
    const positionBytes = new Uint8Array(positions.buffer);
    const indexBytes = new Uint8Array(indices.buffer);
    const bin = new Uint8Array(positionBytes.length + indexBytes.length);
    bin.set(positionBytes, 0);
    bin.set(indexBytes, positionBytes.length);
    const bytes = buildGlb(
      {
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
        accessors: [
          { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3' },
          { bufferView: 1, componentType: 5125, count: indices.length, type: 'SCALAR' },
        ],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: positionBytes.length },
          { buffer: 0, byteOffset: positionBytes.length, byteLength: indexBytes.length },
        ],
        buffers: [{ byteLength: bin.length }],
      },
      bin,
    );

    await expect(prepareImport([{ name: 'too-big.glb', bytes }])).rejects.toMatchObject({
      code: 'too_complex',
    });
  }, 60_000);
});
