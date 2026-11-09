/**
 * Phase 9A.2.9 — headless interaction smoke test.
 *
 * Loads the real SceneViewer in Chromium (WebGL via SwiftShader), selects a
 * room, switches to the move gizmo, commits a simulated drag and checks the
 * furniture/hidden-room branches. The assertions target the viewer's real
 * selection/gizmo state, not a mocked panel.
 *
 * Run: npm run test:interaction
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const outDir = path.join(repoRoot, 'qa-output');

function findChromium() {
  for (const candidate of [
    process.env.CHROMIUM,
    'chromium',
    'chromium-browser',
    'google-chrome',
    'google-chrome-stable',
  ].filter(Boolean)) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (!result.error && result.status === 0) return candidate;
  }
  return null;
}

async function isListening(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

async function waitFor(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function check(name, actual, expected) {
  return {
    name,
    actual,
    expected,
    status: JSON.stringify(actual) === JSON.stringify(expected) ? 'PASS' : 'FAIL',
  };
}

async function main() {
  if (await isListening('http://127.0.0.1:5199/interaction.html')) {
    throw new Error('Port 5199 is already in use.');
  }
  const chromium = findChromium();
  if (!chromium) throw new Error('Chromium not found; set CHROMIUM.');

  const vite = spawn(
    'npx',
    ['vite', '--config', path.join(repoRoot, 'tools/glb-harness/vite.config.mjs')],
    { cwd: repoRoot, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  vite.stdout.on('data', (chunk) => { log += chunk.toString(); });
  vite.stderr.on('data', (chunk) => { log += chunk.toString(); });

  try {
    await waitFor('http://127.0.0.1:5199/interaction.html');
    const result = spawnSync(
      chromium,
      [
        '--headless=new',
        '--no-sandbox',
        '--enable-unsafe-swiftshader',
        '--use-gl=swiftshader',
        '--virtual-time-budget=30000',
        '--dump-dom',
        'http://127.0.0.1:5199/interaction.html',
      ],
      { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 },
    );
    if (result.error) throw result.error;
    const match = /INTERACTION_JSON:(\{.*?\})<\/pre>/s.exec(result.stdout);
    if (!match) {
      throw new Error(`Interaction page did not finish. ${log.slice(-2000)}`);
    }
    const data = JSON.parse(match[1]);
    const steps = Object.fromEntries(
      (data.steps ?? []).map((entry) => [entry.name, entry.value]),
    );
    const transformed = steps.transformCallback;
    const checks = [
      check('viewer.ok', data.ok, true),
      check('room gizmo attached', steps.gizmoAttached, 'room:room-a'),
      check('room gizmo visible', steps.gizmoVisible, true),
      check('room target kind', steps.targetKind, 'room'),
      check('centre pick returns the room', steps.pickCenter, 'room-instance:room-a'),
      check('no commit before pointer release', steps.callbackBeforeRelease, null),
      check('transform callback id', transformed?.id, 'room-instance:room-a'),
      check('transform position', transformed?.patch?.position, { x: 123, y: 0, z: -45 }),
      check('transform rotation', transformed?.patch?.rotation, { x: 0, y: 30, z: 0 }),
      check('transform scale', transformed?.patch?.scale, { x: 2, y: 1, z: 1 }),
      check('one commit per drag', steps.transformCallsAfterRelease, 1),
      check('second release commits nothing', steps.transformCallsAfterSecondRelease, 1),
      check('select mode hides gizmo', steps.gizmoHiddenInSelect, false),
      check('furniture target kind', steps.objectTargetKind, 'object'),
      check('furniture gizmo attached', steps.objectGizmoAttached, 'object:table-1'),
      check('hidden room target', steps.hiddenTarget, null),
      check('hidden room gizmo hidden', steps.hiddenGizmoVisible, false),
      check('focus room A', steps.focusRoomA, true),
      check('focus room A target', steps.focusRoomATargetX, 0),
      check('focus room B', steps.focusRoomB, true),
      check('focus room B target', steps.focusRoomBTargetX, 900),
      check('hidden room focus blocked', steps.focusHidden, false),
    ];
    const failed = checks.filter((entry) => entry.status === 'FAIL');
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      overall: failed.length === 0 ? 'PASS' : 'FAIL',
      checks,
      viewer: data,
    };
    await fs.mkdir(outDir, { recursive: true });
    const file = path.join(outDir, 'interaction-smoke.json');
    await fs.writeFile(file, JSON.stringify(report, null, 2));
    console.log(`Interaction smoke: ${report.overall}`);
    for (const entry of failed) {
      console.log(`FAIL ${entry.name}: ${JSON.stringify(entry.actual)}`);
    }
    console.log(`Report: ${file}`);
    return failed.length === 0 ? 0 : 1;
  } finally {
    try {
      process.kill(-vite.pid, 'SIGTERM');
    } catch {
      try { vite.kill('SIGTERM'); } catch { /* already stopped */ }
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
