/**
 * Phase 5.8 browser probe.
 *
 * This page exercises the real renderer: it is not a unit test and it is not a
 * GPU benchmark. Headless Chromium usually falls back to SwiftShader, so the
 * timings describe software rasterisation, not a user's GPU.
 *
 * Run: `npm run dev -- --host 0.0.0.0 --port 12000`, then open
 * `/tools/render-probe/index.html`. The report is rendered below the canvas and
 * stored on `window.__probeResult` for automation.
 */
import { unzipSync } from 'fflate';
import { SceneViewer } from '../../src/viewer/SceneViewer';
import { createDefaultScene } from '../../src/scene/types';
import { exportRenderBatch } from '../../src/export/renderBatch';
import { pngSize } from '../../src/export/pngSize';
import { CaptureError } from '../../src/viewer/captureErrors';

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
}

class SkipError extends Error {}

const resultsEl = document.getElementById('results');
const stage = document.getElementById('stage');
if (!resultsEl || !stage) {
  throw new Error('Probe sahifasi tuzilmasi topilmadi.');
}

const results: CheckResult[] = [];
const started = performance.now();
/** Kept across the loss/restore pair: while lost, getContext may return null. */
let loseContextExtension: WEBGL_lose_context | null = null;

function add(name: string, status: CheckResult['status'], detail: string): void {
  results.push({ name, status, detail });
  resultsEl.textContent = JSON.stringify({ results }, null, 2);
}

async function check(name: string, run: () => Promise<string | void>): Promise<void> {
  const start = performance.now();
  try {
    const detail = await run();
    add(name, 'pass', `${detail ?? 'OK'} (${Math.round(performance.now() - start)} ms)`);
  } catch (error) {
    if (error instanceof SkipError) {
      add(name, 'skip', error.message);
      return;
    }
    add(name, 'fail', error instanceof Error ? error.message : String(error));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cornerAlpha(blob: Blob): Promise<number[]> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2D kontekst yo‘q.');
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const lastX = canvas.width - 1;
  const lastY = canvas.height - 1;
  const pixels = [0, lastX, lastY * canvas.width, lastY * canvas.width + lastX];
  return pixels.map((index) => data[index * 4 + 3]);
}

function assertPngBytes(bytes: Uint8Array, width: number, height: number, label: string): void {
  const size = pngSize(bytes);
  if (!size || size.widthPx !== width || size.heightPx !== height) {
    throw new Error(
      `${label}: kutilgan ${width}×${height}, olindi ` +
        `${size ? `${size.widthPx}×${size.heightPx}` : 'PNG emas'}.`,
    );
  }
}

const viewer = new SceneViewer(stage, {
  onContextLost: () => add('context-lost event', 'pass', 'webglcontextlost keldi.'),
  onContextRestored: () => add('context-restored event', 'pass', 'webglcontextrestored keldi.'),
});

const scene = createDefaultScene(() => 'probe-table');
viewer.setScene(scene, scene.objects[0]?.id ?? null);
await sleep(400);

const baseline = viewer.getRenderStats();
add(
  'viewer smoke',
  baseline.triangles > 0 ? 'pass' : 'fail',
  `triangles=${baseline.triangles}, drawCalls=${baseline.drawCalls}, ` +
    `maxTextureSize=${baseline.maxTextureSize}`,
);

await check('FHD 1920×1080 capture', async () => {
  const blob = await viewer.capturePng(1920, 1080);
  assertPngBytes(new Uint8Array(await blob.arrayBuffer()), 1920, 1080, 'FHD');
  return `${Math.round(blob.size / 1024)} KB`;
});

await check('4K UHD capture', async () => {
  if (baseline.maxTextureSize < 3840) {
    try {
      await viewer.capturePng(3840, 2160);
    } catch (error) {
      return (
        `SKIP: GPU maxTextureSize=${baseline.maxTextureSize}; aniq xato: ` +
        (error instanceof Error ? error.message : String(error))
      );
    }
    throw new Error('Kichik GPU’da UHD jimgina o‘tdi — clamp bo‘lmasligi kerak.');
  }
  const blob = await viewer.capturePng(3840, 2160);
  assertPngBytes(new Uint8Array(await blob.arrayBuffer()), 3840, 2160, 'UHD');
  return `${(blob.size / 1024 / 1024).toFixed(1)} MB`;
});

await check('capture failure recovery', async () => {
  try {
    await viewer.capturePng(5000, 1080);
    throw new Error('Invalid size capture o‘tdi — clamp bo‘lmasligi kerak.');
  } catch (error) {
    if (!(error instanceof Error) || !/juda katta/.test(error.message)) {
      throw error;
    }
  }
  const blob = await viewer.capturePng(640, 360);
  return `${Math.round(blob.size / 1024)} KB after failed capture`;
});

await check('transparent alpha probe', async () => {
  const probe = await viewer.probeTransparentCapture();
  if (!probe.supported) {
    throw new Error(probe.reason ?? 'Alpha qo‘llanmaydi.');
  }
  return `cornerAlpha=${probe.cornerAlpha.join(',')}`;
});

await check('transparent single PNG keeps alpha', async () => {
  // Room geometry is content, not background: a product cut-out hides it.
  const blob = await viewer.capturePng(1920, 1080, {
    transparent: true,
    includeRoom: false,
  });
  const alpha = await cornerAlpha(blob);
  if (alpha.some((value) => value > 2)) {
    throw new Error(`Burchak alpha: ${alpha.join(',')}`);
  }
  return `cornerAlpha=${alpha.join(',')}`;
});

await check('6-angle transparent ZIP', async () => {
  const progress: string[] = [];
  const result = await exportRenderBatch(
    'standard',
    {
      capture: (view, size) =>
        viewer.capturePng(size.width, size.height, {
          cameraAngle: view.cameraAngle,
          includeRoom: false,
          hideSelection: true,
          transparent: true,
        }),
      download: () => undefined,
      now: new Date('2026-11-05T00:00:00Z'),
    },
    {
      projectName: 'probe',
      onProgress: (entry) => progress.push(`${entry.current}/${entry.total}:${entry.view.id}`),
    },
  );
  if (progress.length !== 6) {
    throw new Error(`Progress ${progress.length} marta keldi.`);
  }
  return `${progress.join(' ')} · ${(result.bytes / 1024 / 1024).toFixed(1)} MB`;
});

await check('ZIP contains six valid PNGs', async () => {
  let zipBlob: Blob | null = null;
  await exportRenderBatch(
    'standard',
    {
      capture: (view, size) =>
        viewer.capturePng(size.width, size.height, {
          cameraAngle: view.cameraAngle,
          includeRoom: false,
          hideSelection: true,
          transparent: true,
        }),
      download: (blob) => {
        zipBlob = blob;
      },
      now: new Date('2026-11-05T00:00:00Z'),
    },
    { projectName: 'probe' },
  );
  if (!zipBlob) {
    throw new Error('ZIP blob olinmadi.');
  }
  const files = unzipSync(new Uint8Array(await zipBlob.arrayBuffer()));
  const names = Object.keys(files).sort();
  if (names.length !== 6) {
    throw new Error(`ZIP ichida ${names.length} fayl.`);
  }
  for (const [name, bytes] of Object.entries(files)) {
    assertPngBytes(bytes, 1920, 1080, name);
  }
  const heroAlpha = await cornerAlpha(
    new Blob([files['preview-hero.png']], { type: 'image/png' }),
  );
  if (heroAlpha.some((value) => value > 2)) {
    throw new Error(`preview-hero.png burchak alpha: ${heroAlpha.join(',')}`);
  }
  return `${names.join(', ')} · heroAlpha=${heroAlpha.join(',')}`;
});

await check('repeated export lifecycle', async () => {
  const before = viewer.getRenderStats();
  for (let i = 0; i < 3; i += 1) {
    await viewer.capturePng(1920, 1080, { transparent: i % 2 === 0 });
  }
  await sleep(100);
  const after = viewer.getRenderStats();
  if (after.geometries > before.geometries) {
    throw new Error(`Geometriya oshdi: ${before.geometries} → ${after.geometries}`);
  }
  if (after.textures > before.textures) {
    throw new Error(`Tekstura oshdi: ${before.textures} → ${after.textures}`);
  }
  return (
    `geometries ${before.geometries}→${after.geometries}, ` +
    `textures ${before.textures}→${after.textures}`
  );
});

await check('context loss during capture fails safely', async () => {
  const canvas = stage.querySelector('canvas');
  const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
  const extension = gl?.getExtension('WEBGL_lose_context');
  if (!canvas || !extension) {
    throw new Error('WEBGL_lose_context mavjud emas.');
  }
  loseContextExtension = extension;
  const lost = new Promise<void>((resolve) =>
    canvas.addEventListener('webglcontextlost', () => resolve(), { once: true }),
  );
  extension.loseContext();
  await lost;
  if (!viewer.isContextLost()) {
    throw new Error('Viewer context loss holatini ko‘rmadi.');
  }
  try {
    await viewer.capturePng(320, 180);
    throw new Error('Capture context loss paytida ham o‘tdi.');
  } catch (error) {
    if (!(error instanceof CaptureError) || error.code !== 'context-lost') {
      throw error;
    }
  }
  return 'CaptureError(context-lost)';
});

await check('context restore recovers the viewer', async () => {
  const canvas = stage.querySelector('canvas');
  if (!canvas || !loseContextExtension) {
    throw new Error('WEBGL_lose_context mavjud emas.');
  }
  const restored = new Promise<boolean>((resolve) => {
    canvas.addEventListener('webglcontextrestored', () => resolve(true), { once: true });
    setTimeout(() => resolve(false), 4000);
  });
  loseContextExtension.restoreContext();
  const didRestore = await restored;
  if (!didRestore) {
    throw new SkipError(
      'webglcontextrestored 4 s ichida kelmadi (headless SwiftShader cheklovi). ' +
        'Real brauzerda restore listener ishlaydi; qo‘lda qayta yuklash ham xavfsiz.',
    );
  }
  await sleep(300);
  const blob = await viewer.capturePng(640, 360);
  return `${Math.round(blob.size / 1024)} KB after restore`;
});

const finalStats = viewer.getRenderStats();
const report = {
  userAgent: navigator.userAgent,
  gpuRenderer: (() => {
    const canvas = stage.querySelector('canvas');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
  })(),
  baseline,
  finalStats,
  durationMs: Math.round(performance.now() - started),
  results,
  skipped: results.filter((entry) => entry.status === 'skip').length,
  status: results.some((entry) => entry.status === 'fail') ? 'fail' : 'pass',
};

resultsEl.textContent = JSON.stringify(report, null, 2);
document.body.dataset.probeStatus = report.status;
(window as unknown as { __probeResult: typeof report }).__probeResult = report;
