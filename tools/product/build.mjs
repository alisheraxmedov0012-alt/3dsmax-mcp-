/**
 * Produce the Premium Office Desk product artifacts through the real browser
 * pipeline: one GLB, six preview PNGs and a metrics JSON.
 *
 *   npm run product:desk
 *
 * Reuses the existing artifact server and the shipped viewer/exporter. Chromium
 * is required for a real canvas and WebGL; when it is missing the runner exits
 * with code 2 (NOT VERIFIED) instead of inventing a preview.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTexturesFromGlb } from './glbTextures.mjs';
import { canonicalizeGlb, sha256 as glyphSha256 } from './canonicalGlb.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const outDir = path.join(repoRoot, 'product-output');
const METRICS_FILE = path.join(outDir, 'product-metrics.json');
const PRODUCT_PREVIEWS = ['hero', 'front', 'side', 'back', 'top', 'detail'];

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

async function waitFor(url, { timeoutMs = 30000, acceptAnyStatus = false, startedAt = Date.now() } = {}) {
  try {
    const response = await fetch(url);
    if (acceptAnyStatus || response.ok) return;
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
    if (!result.error && result.status === 0) return candidate;
  }
  return null;
}

function fail(message) {
  throw new Error(message);
}

function assertRange(label, value, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) {
    fail(`${label}: ${value} is outside ${min}–${max}.`);
  }
}

function assertClose(label, value, expected, tolerance) {
  if (!Number.isFinite(value) || Math.abs(value - expected) > tolerance) {
    fail(`${label}: ${value} is not within ${tolerance} of ${expected}.`);
  }
}

async function verifyArtifacts(metrics) {
  const glbPath = path.join(outDir, 'premium-office-desk.glb');
  if (!existsSync(glbPath)) fail(`Missing ${glbPath}.`);
  const glb = await fs.readFile(glbPath);
  if (glb.byteLength !== metrics.glb.bytes) {
    fail(`GLB size mismatch: file ${glb.byteLength}, metrics ${metrics.glb.bytes}.`);
  }
  const digest = createHash('sha256').update(glb).digest('hex');
  if (digest !== metrics.glb.sha256) {
    fail('GLB SHA-256 does not match the metrics JSON.');
  }

  assertRange('meshes', metrics.geometry.meshes, 20, 28);
  assertRange('triangles', metrics.geometry.triangles, 4500, 12000);
  assertRange('vertices', metrics.geometry.vertices, 1, 30000);
  assertClose('bbox.width', metrics.geometry.bounds.size[0], 160, 0.1);
  assertClose('bbox.height', metrics.geometry.bounds.size[1], 75, 0.1);
  assertClose('bbox.depth', metrics.geometry.bounds.size[2], 80, 0.1);
  assertClose('bbox.min.y', metrics.geometry.bounds.min[1], 0, 0.01);

  const materials = metrics.glb.summary.materials ?? [];
  assertRange('materials', materials.length, 4, 5);
  if (new Set(materials).size !== materials.length) {
    fail('GLB material names are not unique.');
  }

  const images = metrics.glb.summary.images ?? [];
  assertRange('GLB images', images.length, 4, 12);
  for (const image of images) {
    if (image.size?.widthPx !== 2048 || image.size?.heightPx !== 2048) {
      fail(
        `GLB image ${image.index} is ${image.size?.widthPx}x${image.size?.heightPx}, ` +
          'expected 2048x2048.',
      );
    }
  }

  const textureDir = path.join(outDir, 'textures');
  await fs.mkdir(textureDir, { recursive: true });
  const extracted = extractTexturesFromGlb(glb, textureDir, (dir, name, buffer) => {
    writeFileSync(path.join(dir, name), buffer);
  });
  if (extracted.manifest.length !== 16) {
    fail(`Expected 16 external PBR maps (4 materials x 4 roles), got ${extracted.manifest.length}.`);
  }
  for (const texture of extracted.manifest) {
    if (texture.width !== 2048 || texture.height !== 2048) {
      fail(`${texture.name}: ${texture.width}x${texture.height}, expected 2048x2048.`);
    }
    const file = path.join(textureDir, texture.name);
    if (!existsSync(file)) fail(`Missing ${file}.`);
    const bytes = await fs.readFile(file);
    if (bytes.byteLength !== texture.bytes) {
      fail(`${texture.name}: size mismatch (${bytes.byteLength} vs ${texture.bytes}).`);
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== texture.sha256) fail(`${texture.name}: SHA-256 mismatch.`);
  }

  if (!Array.isArray(metrics.previews) || metrics.previews.length !== 6) {
    fail(`Expected 6 previews, got ${metrics.previews?.length ?? 0}.`);
  }
  const hashes = new Set();
  for (const id of PRODUCT_PREVIEWS) {
    const preview = metrics.previews.find((entry) => entry.id === id);
    if (!preview) fail(`Missing preview ${id}.`);
    const file = path.join(outDir, `preview-${id}.png`);
    if (!existsSync(file)) fail(`Missing ${file}.`);
    const bytes = await fs.readFile(file);
    if (bytes.byteLength !== preview.bytes) {
      fail(`preview-${id}.png size mismatch (${bytes.byteLength} vs ${preview.bytes}).`);
    }
    if (bytes.byteLength < 10_000) fail(`preview-${id}.png is suspiciously small.`);
    if (hashes.has(preview.sha256)) fail(`preview-${id}.png duplicates another angle.`);
    hashes.add(preview.sha256);
    if (preview.nonBackgroundRatio !== null && preview.nonBackgroundRatio < 0.05) {
      fail(
        `preview-${id}.png is ${(preview.nonBackgroundRatio * 100).toFixed(1)}% non-background; ` +
          'the shot is effectively empty.',
      );
    }
  }
  return {
    glbBytes: glb.byteLength,
    materials,
    textures: extracted.manifest,
    ormChannels: extracted.ormChannels,
  };
}

async function main() {
  const browser = findChromium();
  if (!browser) {
    console.error(
      'Chromium not found. Set CHROMIUM to the browser executable; previews are NOT VERIFIED.',
    );
    process.exitCode = 2;
    return;
  }
  if (await isListening('http://127.0.0.1:5401/')) {
    throw new Error('Port 5401 is already in use; stop the other product harness first.');
  }
  if (await isListening('http://127.0.0.1:5299/desk-product.html')) {
    throw new Error('Port 5299 is already in use; stop the other product harness first.');
  }

  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  const children = [];
  try {
    children.push(
      start(
        'python3',
        [path.join(repoRoot, 'tools/glb-harness/server.py'), '--out', outDir, '--port', '5401'],
        repoRoot,
      ),
    );
    await waitFor('http://127.0.0.1:5401/', { acceptAnyStatus: true });

    children.push(
      start('npx', ['vite', '--config', path.join(here, 'vite.config.mjs')], repoRoot),
    );
    await waitFor('http://127.0.0.1:5299/desk-product.html');
    await new Promise((resolve) => setTimeout(resolve, 700));

    // The viewer intentionally keeps a requestAnimationFrame loop alive, so the
    // browser does not exit on its own. Completion is the metrics file the page
    // writes after the last preview; the browser is killed once it is valid.
    const browserChild = start(
      browser,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--enable-unsafe-swiftshader',
        '--use-gl=swiftshader',
        '--window-size=1920,1080',
        'http://127.0.0.1:5299/desk-product.html',
      ],
      repoRoot,
    );
    children.push(browserChild);

    const deadline = Date.now() + 900000;
    let metrics = null;
    while (Date.now() < deadline) {
      if (existsSync(METRICS_FILE)) {
        try {
          const parsed = JSON.parse(await fs.readFile(METRICS_FILE, 'utf8'));
          if (parsed.ok === true) {
            metrics = parsed;
            break;
          }
        } catch {
          // The file is still being written; retry.
        }
      }
      if (browserChild.exitCode !== null) {
        throw new Error(
          `Chromium exited before the product page finished (${browserChild.exitCode}): ` +
            tail(browserChild.log),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!metrics) {
      throw new Error(
        `Timed out waiting for product-metrics.json. Browser log:\n${tail(browserChild.log)}`,
      );
    }
    stop(browserChild);

    // Canonicalise the image/bufferView order before anything consumes the GLB.
    const glbPath = path.join(outDir, 'premium-office-desk.glb');
    const rawGlb = await fs.readFile(glbPath);
    const canonicalGlb = canonicalizeGlb(rawGlb);
    if (!canonicalGlb.equals(rawGlb)) {
      await fs.writeFile(glbPath, canonicalGlb);
    }
    metrics.glb.bytes = canonicalGlb.byteLength;
    metrics.glb.sha256 = glyphSha256(canonicalGlb);

    const verified = await verifyArtifacts(metrics);
    metrics.textures = verified.textures;
    metrics.textureChannels = verified.ormChannels;
    await fs.writeFile(METRICS_FILE, `${JSON.stringify(metrics, null, 2)}\n`);
    console.log('Product desk: PASS');
    console.log(
      `meshes=${metrics.geometry.meshes} triangles=${metrics.geometry.triangles} ` +
        `vertices=${metrics.geometry.vertices} glb=${verified.glbBytes} bytes`,
    );
    console.log(`materials=${verified.materials.join(', ')}`);
    console.log(
      `textures=${verified.textures.length} (2048×2048), GLB images=${metrics.glb.summary.images.length}`,
    );
    console.log(`previews=${metrics.previews.length} (1920×1080)`);
    for (const preview of metrics.previews) {
      const bounds = preview.contentBounds;
      const fraction = bounds
        ? `content=${(bounds.widthFraction * 100).toFixed(1)}%×${(bounds.heightFraction * 100).toFixed(1)}%`
        : 'content=unknown';
      console.log(`  ${preview.id}: ${fraction}`);
    }
    console.log(`metrics=${METRICS_FILE}`);
  } catch (error) {
    const logs = children
      .map((child) => tail(child.log, 1500))
      .filter(Boolean)
      .join('\n');
    const suffix = logs ? `\n--- harness output ---\n${logs}` : '';
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${suffix}`,
      { cause: error },
    );
  } finally {
    for (const child of children) stop(child);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
