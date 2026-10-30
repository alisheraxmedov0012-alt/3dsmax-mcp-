/**
 * Repeatable GLB export -> GLTFLoader round-trip smoke test.
 *
 * Uses the existing browser harness and Chromium; it adds no package dependency.
 * All generated files live in /tmp and are removed afterwards. Run:
 *
 *   node tools/glb-harness/roundtrip.mjs
 *
 * This is deliberately not part of `npm test`: the export harness takes about a
 * minute in software WebGL.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const outDir = `/tmp/3d-studio-glb-roundtrip-${process.pid}`;
const chromium = process.env.CHROMIUM || 'chromium';
const children = [];

function start(command, args) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  return child;
}

function stop(child) {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {}
  }
}

async function waitFor(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function runChromium(url, extra = []) {
  const result = spawnSync(
    chromium,
    [
      '--headless=new',
      '--no-sandbox',
      '--enable-unsafe-swiftshader',
      '--use-gl=swiftshader',
      '--virtual-time-budget=180000',
      ...extra,
      '--dump-dom',
      url,
    ],
    { encoding: 'utf8', timeout: 240000, maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Chromium failed (${result.status}): ${result.stderr?.slice(0, 500)}`);
  }
  return result.stdout;
}

function parseGlbJson(buffer) {
  // fs.readFileSync returns a Buffer, which is a Uint8Array view rather than a
  // raw ArrayBuffer; DataView needs the exact backing range.
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB');
  const total = view.getUint32(8, true);
  let offset = 12;
  while (offset + 8 <= total) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (type === 0x4e4f534a) {
      return JSON.parse(
        new TextDecoder().decode(
          new Uint8Array(bytes.buffer, bytes.byteOffset + offset + 8, length),
        ),
      );
    }
    offset += 8 + length;
  }
  throw new Error('GLB has no JSON chunk');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  start('python3', [path.join(here, 'server.py'), '--out', outDir, '--port', '5300']);
  start('npx', ['vite', '--config', path.join(here, 'vite.config.mjs')]);
  await waitFor('http://127.0.0.1:5199/export.html');
  await new Promise((resolve) => setTimeout(resolve, 500));

  const exportDom = runChromium('http://127.0.0.1:5199/export.html');
  assert(/exportWithRoom bytes=\d+/.test(exportDom), 'Export page did not report a room-included GLB');
  assert(/exportFurnitureOnly bytes=\d+/.test(exportDom), 'Export page did not report a furniture-only GLB');

  const withRoomPath = path.join(outDir, 'model-with-room.glb');
  const furniturePath = path.join(outDir, 'model-furniture-only.glb');
  const withRoom = fs.readFileSync(withRoomPath);
  const furnitureOnly = fs.readFileSync(furniturePath);
  assert(withRoom.length > 0 && furnitureOnly.length > 0, 'Exported GLB is empty');

  for (const [label, buffer] of [
    ['with-room', withRoom],
    ['furniture-only', furnitureOnly],
  ]) {
    const json = parseGlbJson(buffer);
    const root = json.nodes[json.scenes[0].nodes[0]];
    assert(Array.isArray(root.matrix), `${label}: root has no matrix`);
    assert(Math.abs(root.matrix[0] - 0.01) < 1e-9, `${label}: root is not centimetre-to-metre`);
    assert(json.meshes.length > 0, `${label}: no meshes`);
    const names = json.meshes.map((mesh) => mesh.name).filter(Boolean);
    assert(names.length === json.meshes.length, `${label}: unnamed meshes`);
    assert(new Set(names).size === names.length, `${label}: duplicate mesh names`);
  }

  const viewerDom = runChromium('http://127.0.0.1:5199/viewer.html', [
    '--window-size=1280,720',
    '--screenshot=' + path.join(outDir, 'render.png'),
  ]);
  assert(/parse=OK/.test(viewerDom), 'GLTFLoader could not parse the GLB');
  const counts = /reload meshes=(\d+) uniqueMaterials=(\d+) withMap=(\d+) transparent=(\d+)/.exec(
    viewerDom,
  );
  assert(counts, 'Viewer did not report mesh/material counts');
  const [, meshes, materials, withMap, transparent] = counts.map(Number);
  assert(meshes > 0, 'Reloaded scene has no meshes');
  assert(materials > 0, 'Reloaded scene has no materials');
  assert(withMap > 0, 'Reloaded scene has no textured material');

  const bbox = /bbox=([\d.]+)x([\d.]+)x([\d.]+)/.exec(viewerDom);
  assert(bbox, 'Viewer did not report a bounding box');
  const size = bbox.slice(1).map(Number);
  assert(size.every((value) => value > 0 && value < 100), 'Bounding box is not a valid metre-scale size');
  const pixels = /nonBackground=([\d.]+)%/.exec(viewerDom);
  assert(pixels && Number(pixels[1]) > 0, 'Reloaded scene rendered no non-background pixels');
  assert(fs.existsSync(path.join(outDir, 'render.png')), 'Viewer produced no screenshot');

  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        withRoomBytes: withRoom.length,
        furnitureOnlyBytes: furnitureOnly.length,
        reloadMeshes: meshes,
        materials,
        withMap,
        transparent,
        bboxM: size,
        nonBackgroundPercent: Number(pixels[1]),
      },
      null,
      2,
    ),
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  for (const child of children) stop(child);
  if (process.exitCode !== 1) {
    fs.rmSync(outDir, { recursive: true, force: true });
  } else {
    console.error(`Artifacts kept for diagnosis: ${outDir}`);
  }
}
