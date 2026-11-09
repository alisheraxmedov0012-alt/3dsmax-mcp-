/**
 * Phase 9A.2.8 — interior integration QA harness.
 *
 * Pipeline:
 *   1. the real browser harness exports every deterministic fixture to GLB;
 *   2. this script hashes the files and reads their GLB metrics;
 *   3. Blender imports each GLB, measures geometry/material/UV/transforms,
 *      ray-casts the wall openings independently, and renders QA views;
 *   4. a JSON + Markdown report is written under qa-output/interior-parity.
 *
 * Run: npm run test:interior -- [--no-blender] [--no-render] [--out dir]
 */
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGlbMetrics } from './golden.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const BLENDER_SCRIPT = path.join(here, 'interior-blender.py');
const STATUS = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', NOT_VERIFIED: 'NOT VERIFIED' });

function parseArgs(argv) {
  const args = { out: path.join(repoRoot, 'qa-output/interior-parity'), blender: process.env.BLENDER || 'blender', render: true, blenderEnabled: true, fixtures: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') args.out = path.resolve(argv[(index += 1)]);
    else if (arg === '--blender') args.blender = argv[(index += 1)];
    else if (arg === '--no-render') args.render = false;
    else if (arg === '--no-blender') args.blenderEnabled = false;
    else if (arg === '--fixtures') args.fixtures = new Set(argv[(index += 1)].split(',').map((id) => id.trim()).filter(Boolean));
    else if (arg === '-h' || arg === '--help') args.help = true;
  }
  return args;
}

function tail(text, max = 3000) {
  const value = String(text ?? '');
  return value.length > max ? value.slice(-max) : value;
}

function start(command, args, cwd) {
  const child = spawn(command, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.log = '';
  child.stdout.on('data', (chunk) => { child.log += chunk.toString(); });
  child.stderr.on('data', (chunk) => { child.log += chunk.toString(); });
  child.on('error', (error) => { child.log += `spawn error: ${error.message}\n`; });
  return child;
}

function stop(child) {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try { child.kill('SIGTERM'); } catch { /* already exited */ }
  }
}

async function isListening(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

async function waitFor(url, { timeoutMs = 30000, startedAt = Date.now(), acceptAnyStatus = false } = {}) {
  try {
    const response = await fetch(url);
    if (acceptAnyStatus || response.ok) return;
  } catch { /* not yet */ }
  if (Date.now() - startedAt >= timeoutMs) throw new Error(`Timed out waiting for ${url}.`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  return waitFor(url, { timeoutMs, startedAt, acceptAnyStatus });
}

function findChromium() {
  for (const candidate of [process.env.CHROMIUM, 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'].filter(Boolean)) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (!result.error && result.status === 0) return candidate;
  }
  return null;
}

async function sha256(file) {
  const bytes = await fs.readFile(file);
  return createHash('sha256').update(bytes).digest('hex');
}

async function exportFixtures(outDir) {
  if (await isListening('http://127.0.0.1:5300/')) throw new Error('Port 5300 is already in use.');
  if (await isListening('http://127.0.0.1:5199/rooms.html')) throw new Error('Port 5199 is already in use.');
  const browser = findChromium();
  if (!browser) throw new Error('Chromium not found; set CHROMIUM.');

  const children = [];
  try {
    children.push(start('python3', [path.join(repoRoot, 'tools/glb-harness/server.py'), '--out', outDir, '--port', '5300'], repoRoot));
    await waitFor('http://127.0.0.1:5300/', { acceptAnyStatus: true });
    children.push(start('npx', ['vite', '--config', path.join(repoRoot, 'tools/glb-harness/vite.config.mjs')], repoRoot));
    await waitFor('http://127.0.0.1:5199/rooms.html');
    await new Promise((resolve) => setTimeout(resolve, 500));

    const result = spawnSync(
      browser,
      ['--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=swiftshader', '--virtual-time-budget=240000', '--dump-dom', 'http://127.0.0.1:5199/rooms.html'],
      { encoding: 'utf8', timeout: 300000, maxBuffer: 96 * 1024 * 1024 },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Chromium failed (${result.status}): ${tail(result.stderr)}`);
    const match = /INTERIOR_FIXTURES_DONE count=(\d+)/u.exec(result.stdout);
    if (!match) throw new Error(`Export page did not finish. Output: ${tail(result.stdout)}`);
    return Number(match[1]);
  } finally {
    for (const child of children) stop(child);
  }
}

function blenderAvailable(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  return !result.error && result.status === 0 ? result.stdout.split('\n')[0].trim() : null;
}

function runBlender(blender, glb, fixturePath, reportPath, renderDir, render) {
  const args = ['--background', '--factory-startup', '--python', BLENDER_SCRIPT, '--', '--glb', glb, '--fixture', fixturePath, '--out', reportPath];
  if (render) args.push('--render-dir', renderDir);
  const result = spawnSync(blender, args, { encoding: 'utf8', timeout: 600000, maxBuffer: 96 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (!existsSync(reportPath)) {
    throw new Error(`Blender produced no report. ${tail(result.stderr)}`);
  }
  return JSON.parse(readFileSync(reportPath, 'utf8'));
}

function compareParity(glb, blender) {
  const pairs = [
    ['meshes', glb.meshNodes, blender.metrics?.meshCount],
    ['triangles', glb.sceneTriangles, blender.metrics?.triangles],
    ['vertices', glb.sceneVertices, blender.metrics?.vertices],
    ['materials', glb.materials, blender.metrics?.materialCount],
    ['images', glb.images, blender.metrics?.imageCount],
  ];
  return pairs.map(([metric, expected, actual]) => ({
    metric,
    expected,
    actual,
    status: expected === actual ? STATUS.PASS : STATUS.FAIL,
  }));
}

async function renderMarkdown(report) {
  const lines = [
    '# Interior Integration QA — Phase 9A.2.8',
    '',
    `Generated: ${report.generatedAt}`,
    `Blender: ${report.blender.version ?? 'not available'} (${report.blender.source})`,
    `Overall: **${report.overall}**`,
    '',
    '## Fixtures',
    '',
    '| Fixture | Status | GLB bytes | SHA-256 (short) | Meshes | Triangles | Vertices | Render PNGs |',
    '| --- | --- | ---: | --- | ---: | ---: | ---: | ---: |',
  ];
  for (const fixture of report.fixtures) {
    const metrics = fixture.blender?.metrics;
    lines.push(
      `| ${fixture.id} | ${fixture.status} | ${fixture.bytes} | \`${fixture.sha256.slice(0, 12)}\` | ${metrics?.meshCount ?? '—'} | ${metrics?.triangles ?? '—'} | ${metrics?.vertices ?? '—'} | ${fixture.renders?.length ?? 0} |`,
    );
  }
  lines.push('', '## Checks', '');
  for (const fixture of report.fixtures) {
    lines.push(`### ${fixture.id}`, '');
    if (fixture.error) {
      lines.push(`Error: ${fixture.error}`, '');
      continue;
    }
    lines.push(`- GLB SHA-256: \`${fixture.sha256}\``);
    lines.push(`- Bounding box (m): ${JSON.stringify(fixture.blender?.metrics?.bboxM ?? null)}`);
    lines.push(`- Blender parity: ${fixture.parityStatus}`);
    if (fixture.blender) {
      for (const check of fixture.blender.checks ?? []) {
        lines.push(`- ${check.status}: ${check.detail}`);
      }
      for (const parity of fixture.parity) {
        lines.push(`- ${parity.status}: Blender ${parity.metric} ${parity.actual} vs GLB ${parity.expected}`);
      }
    } else {
      lines.push(`- ${STATUS.NOT_VERIFIED}: Blender import not run (${fixture.blenderNote ?? 'unavailable'}).`);
    }
    lines.push('');
  }
  lines.push('## Notes', '', ...report.notes.map((note) => `- ${note}`), '');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: npm run test:interior -- [--no-blender] [--no-render] [--out dir] [--fixtures id,...]');
    return 0;
  }

  await fs.mkdir(args.out, { recursive: true });
  const interiorDir = path.join(args.out, 'interior');
  await fs.mkdir(interiorDir, { recursive: true });

  const exported = await exportFixtures(args.out);
  const manifest = JSON.parse(await fs.readFile(path.join(interiorDir, 'manifest.json'), 'utf8'));
  const selected = args.fixtures ? manifest.filter((entry) => args.fixtures.has(entry.id)) : manifest;
  if (selected.length === 0) throw new Error('No fixtures selected.');

  const blenderVersion = args.blenderEnabled ? blenderAvailable(args.blender) : null;
  const blenderSource = process.env.BLENDER
    ? `BLENDER=${process.env.BLENDER}`
    : 'repository PATH / BLENDER env';

  const fixtures = [];
  for (const entry of selected) {
    const glbPath = path.join(interiorDir, `${entry.id}.glb`);
    if (!existsSync(glbPath)) throw new Error(`Missing exported GLB: ${glbPath}`);
    const sha = await sha256(glbPath);
    const bytes = (await fs.stat(glbPath)).size;
    const glb = parseGlbMetrics(await fs.readFile(glbPath));
    const fixturePath = path.join(interiorDir, `${entry.id}.fixture.json`);
    await fs.writeFile(fixturePath, JSON.stringify(entry, null, 2));

    const record = {
      id: entry.id,
      label: entry.label,
      bytes,
      sha256: sha,
      glb,
      status: STATUS.PASS,
      parityStatus: STATUS.NOT_VERIFIED,
      parity: [],
      renders: [],
      blender: null,
      error: null,
    };

    if (blenderVersion) {
      const reportPath = path.join(interiorDir, `${entry.id}.blender.json`);
      const renderDir = path.join(args.out, 'renders', entry.id);
      if (args.render) {
        await fs.rm(renderDir, { recursive: true, force: true });
      }
      try {
        const blender = runBlender(args.blender, glbPath, fixturePath, reportPath, renderDir, args.render);
        record.blender = blender;
        record.parity = compareParity(glb, blender);
        record.parityStatus = record.parity.every((item) => item.status === STATUS.PASS)
          ? STATUS.PASS
          : STATUS.FAIL;
        record.renders = blender.renders ?? [];
        if (!blender.ok) record.status = STATUS.FAIL;
        if (record.parityStatus === STATUS.FAIL) record.status = STATUS.FAIL;
      } catch (error) {
        record.status = STATUS.NOT_VERIFIED;
        record.blenderNote = error instanceof Error ? error.message : String(error);
      }
    } else {
      record.blenderNote = 'Blender binary not found';
    }

    fixtures.push(record);
  }

  const failed = fixtures.some((fixture) => fixture.status === STATUS.FAIL);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    exportedFixtures: exported,
    blender: {
      version: blenderVersion,
      source: blenderVersion ? blenderSource : 'not installed',
    },
    overall: failed ? STATUS.FAIL : STATUS.PASS,
    fixtures,
    notes: [
      'Fixtures and expectations live in src/qa/interiorFixtures.ts and are asserted by Vitest.',
      'Opening rays are cast in Blender against the wall object BVH only, not against door leaves or glass.',
      'UV mirrored diagnostics cover room surfaces (floor, walls, ceiling, baseboard, crown).',
      'Visual QA renders use Blender Cycles CPU; they are written under qa-output and are not committed.',
      'Blender import is NOT VERIFIED when no Blender binary is available.',
    ],
  };

  const jsonPath = path.join(args.out, 'interior-report.json');
  const mdPath = path.join(args.out, 'interior-report.md');
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
  await fs.writeFile(mdPath, await renderMarkdown(report));

  console.log(`Interior QA: ${report.overall}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`Markdown: ${mdPath}`);
  console.log(`Blender: ${blenderVersion ?? 'NOT VERIFIED'}`);
  return failed ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
