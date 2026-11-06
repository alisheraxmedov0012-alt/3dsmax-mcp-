/**
 * Phase 6.2.4 — browser integration test for model import.
 *
 * Runs `tools/glb-harness/import.html` in headless Chromium: the real
 * `SceneViewer` renders an imported GLB in WebGL, the page clicks it, moves it,
 * hides it, deletes it, re-imports it and exports it in all four formats, then
 * times imports at 10k/100k/500k triangles.
 *
 *   node tools/glb-harness/import.mjs
 *
 * Like the export round trip, this is deliberately not part of `npm test`: it needs
 * Chromium and a software WebGL stack, and takes about a minute.
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
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

function runChromium(url) {
  const result = spawnSync(
    chromium,
    [
      '--headless=new',
      '--no-sandbox',
      '--enable-unsafe-swiftshader',
      '--use-gl=swiftshader',
      '--window-size=1280,720',
      '--virtual-time-budget=600000',
      '--dump-dom',
      url,
    ],
    { encoding: 'utf8', timeout: 420000, maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Chromium failed (${result.status}): ${result.stderr?.slice(0, 800)}`);
  }
  return result.stdout;
}

const shouldFail = (condition, message) => {
  if (condition) throw new Error(message);
};

async function main() {
  start('npx', ['vite', '--config', path.join(here, 'vite.config.mjs')]);
  try {
    await waitFor('http://127.0.0.1:5199/import.html');
    await new Promise((resolve) => setTimeout(resolve, 400));

    const dom = runChromium('http://127.0.0.1:5199/import.html');
    // The report is the only content of the <pre>, so it ends at the closing tag.
    const match = /RESULT (\{[\s\S]*?\})<\/pre>/.exec(dom);
    shouldFail(!match, 'Import page produced no RESULT payload');

    const report = JSON.parse(match[1]);
    shouldFail(report.errors.length > 0, `Import page reported: ${report.errors.join('; ')}`);
    shouldFail(!report.ok, 'Import page did not reach the end of the scenario');

    const steps = report.steps;
    shouldFail(!(steps.visibleContribution > 0.5), 'Rendered frame contains no imported geometry');
    shouldFail(!(steps.moveDelta > 0.5), 'Transform did not change the rendered frame');
    shouldFail(!(steps.hiddenDelta < 0.2), 'Hiding the object did not remove it from the frame');
    shouldFail(!Array.isArray(steps.selected) || !steps.selected.includes('imp-1'), 'Selection failed');
    shouldFail(steps.storeAfterReimport !== 2, 'Re-import was not registered');
    shouldFail(!(steps.twoObjectsContribution > steps.visibleContribution), 'Two imports are not both drawn');
    shouldFail(steps.storeAfterDelete !== 0, 'Store was not cleared after delete');
    shouldFail(
      steps.geometriesAfterCycles > steps.geometries.baseline,
      'Geometry count grew across add/delete cycles',
    );
    for (const format of ['glb', 'obj', 'stl', '3mf']) {
      shouldFail(!(steps.exports[format] > 0), `Export ${format} produced no bytes`);
    }

    console.log(
      JSON.stringify(
        {
          status: 'PASS',
          visibleContributionPercent: steps.visibleContribution,
          moveDeltaPercent: steps.moveDelta,
          hiddenDeltaPercent: steps.hiddenDelta,
          selected: steps.selected,
          geometries: steps.geometries,
          geometriesAfterCycles: steps.geometriesAfterCycles,
          exports: steps.exports,
        },
        null,
        2,
      ),
    );
  } finally {
    for (const child of children) stop(child);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
