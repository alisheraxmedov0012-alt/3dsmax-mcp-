/**
 * Produce a real GLB through the existing tools/glb-harness export page.
 *
 * This deliberately reuses the shipped export pipeline and its Chromium
 * harness instead of copying geometry or exporter code. The two fixed ports are
 * the ones the harness already expects: 5300 for the artifact sink and 5199 for
 * Vite (the export page posts to `/artefakt/...`, proxied to 5300).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

function tail(text, max = 2000) {
  const value = String(text ?? '');
  return value.length > max ? value.slice(-max) : value;
}

function start(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.log = '';
  child.stdout.on('data', (chunk) => {
    child.log += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    child.log += chunk.toString();
  });
  child.on('error', (error) => {
    child.log += `spawn error: ${error.message}\n`;
  });
  return child;
}

function stop(child) {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // The process already exited; nothing to release.
    }
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

async function waitFor(
  url,
  { timeoutMs = 30000, acceptAnyStatus = false, startedAt = Date.now() } = {},
) {
  try {
    const response = await fetch(url);
    if (acceptAnyStatus || response.ok) {
      return;
    }
  } catch {
    // Not listening yet.
  }
  if (Date.now() - startedAt >= timeoutMs) {
    throw new Error(`Timed out waiting for ${url}.`);
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  return waitFor(url, { timeoutMs, acceptAnyStatus, startedAt });
}

function findChromium() {
  const candidates = [
    process.env.CHROMIUM,
    'chromium',
    'chromium-browser',
    'google-chrome',
    'google-chrome-stable',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (!result.error && result.status === 0) {
      return candidate;
    }
  }
  return null;
}

export async function exportGlb({
  outDir,
  chromium,
  python = 'python3',
  root = repoRoot,
} = {}) {
  if (!outDir) {
    throw new Error('exportGlb requires an output directory.');
  }
  if (await isListening('http://127.0.0.1:5300/')) {
    throw new Error('Port 5300 is already in use; stop the other GLB harness first.');
  }
  if (await isListening('http://127.0.0.1:5199/export.html')) {
    throw new Error('Port 5199 is already in use; stop the other GLB harness first.');
  }

  await fs.mkdir(outDir, { recursive: true });
  const browser = chromium || findChromium();
  if (!browser) {
    throw new Error('Chromium not found; set CHROMIUM to the browser executable.');
  }

  const children = [];
  try {
    children.push(
      start(
        python,
        [path.join(root, 'tools/glb-harness/server.py'), '--out', outDir, '--port', '5300'],
        root,
      ),
    );
    await waitFor('http://127.0.0.1:5300/', { acceptAnyStatus: true });

    children.push(
      start(
        'npx',
        ['vite', '--config', path.join(root, 'tools/glb-harness/vite.config.mjs')],
        root,
      ),
    );
    await waitFor('http://127.0.0.1:5199/export.html');
    // Give Vite's first dependency optimization a moment before Chromium opens
    // the page; the existing roundtrip harness does the same.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const result = spawnSync(
      browser,
      [
        '--headless=new',
        '--no-sandbox',
        '--enable-unsafe-swiftshader',
        '--use-gl=swiftshader',
        '--virtual-time-budget=180000',
        '--dump-dom',
        'http://127.0.0.1:5199/export.html',
      ],
      { encoding: 'utf8', timeout: 240000, maxBuffer: 64 * 1024 * 1024 },
    );
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`Chromium failed (${result.status}): ${tail(result.stderr)}`);
    }

    const match = /exportWithRoom bytes=(\d+)/u.exec(result.stdout);
    if (!match) {
      throw new Error('The export page did not report exportWithRoom bytes.');
    }
    const reportedBytes = Number(match[1]);
    const glbPath = path.join(outDir, 'model-with-room.glb');
    if (!existsSync(glbPath)) {
      throw new Error(`The export page reported success but ${glbPath} is missing.`);
    }
    const stat = await fs.stat(glbPath);
    if (stat.size !== reportedBytes) {
      throw new Error(
        `GLB size mismatch: the page reported ${reportedBytes} bytes, the file is ${stat.size}.`,
      );
    }
    return { path: glbPath, bytes: stat.size, reportedBytes };
  } catch (error) {
    const logs = children
      .map((child) => tail(child.log, 1200))
      .filter(Boolean)
      .join('\n');
    const suffix = logs ? `\n--- harness output ---\n${logs}` : '';
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${suffix}`,
      { cause: error },
    );
  } finally {
    for (const child of children) {
      stop(child);
    }
  }
}
